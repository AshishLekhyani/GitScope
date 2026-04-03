import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { getGithubHeaders } from "@/lib/github";
import { sanitizeRepoList } from "@/lib/validate-repo";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getCapabilitiesForPlan, resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { trackUsageEvent } from "@/lib/ai-usage";

/** Manifest files to check per language ecosystem. */
const MANIFESTS = [
  { file: "package.json", parse: parseNodeManifest },
  { file: "requirements.txt", parse: parsePythonManifest },
  { file: "Cargo.toml", parse: parseCargoManifest },
  { file: "go.mod", parse: parseGoManifest },
  { file: "pom.xml", parse: parseMavenManifest },
  { file: "Gemfile", parse: parseGemfileManifest },
];

function parseNodeManifest(content: string): string[] {
  try {
    const pkg = JSON.parse(content);
    return Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  } catch { return []; }
}

function parsePythonManifest(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.trim().split(/[>=<!]/)[0].trim())
    .filter((l) => l && !l.startsWith("#"));
}

function parseCargoManifest(content: string): string[] {
  const deps: string[] = [];
  const section = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
  if (section) {
    section[1].split("\n").forEach((line) => {
      const m = line.match(/^(\w[\w-]*)\s*=/);
      if (m) deps.push(m[1]);
    });
  }
  return deps;
}

function parseGoManifest(content: string): string[] {
  return content
    .split("\n")
    .filter((l) => l.trim().startsWith("require") || /^\s+\S+\s+v/.test(l))
    .map((l) => l.trim().split(/\s+/)[0].replace(/^require\s+/, "").replace(/^"/, "").replace(/"$/, ""))
    .filter((l) => l && !l.startsWith("(") && !l.startsWith(")"));
}

function parseMavenManifest(content: string): string[] {
  const ids: string[] = [];
  const re = /<artifactId>([\w.-]+)<\/artifactId>/g;
  let m;
  while ((m = re.exec(content)) !== null) ids.push(m[1]);
  return ids.slice(0, 30); // cap at 30
}

function parseGemfileManifest(content: string): string[] {
  return content
    .split("\n")
    .filter((l) => l.trim().startsWith("gem "))
    .map((l) => l.trim().replace(/^gem\s+['"]/, "").split(/['"]/)[0]);
}

async function fetchManifest(
  fullName: string,
  headers: HeadersInit
): Promise<{ deps: string[]; file: string } | null> {
  for (const { file, parse } of MANIFESTS) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${fullName}/contents/${file}`,
        { headers, next: { revalidate: 300 } }
      );
      if (!res.ok) continue;
      const data = await res.json() as { content?: string };
      if (!data.content) continue;
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      const deps = parse(content);
      if (deps.length > 0) return { deps: deps.slice(0, 40), file };
    } catch { continue; }
  }
  return null;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  const { searchParams } = new URL(req.url);
  const reposParam = searchParams.get("repos");
  if (!reposParam) {
    return NextResponse.json({ error: "No repositories specified" }, { status: 400 });
  }

  const repoList = sanitizeRepoList(reposParam, caps.maxReposPerRequest);
  if (!repoList) return NextResponse.json({ error: "Invalid repository format" }, { status: 400 });

  const { token: userToken, source: tokenSource } = await getGitHubTokenWithSource({
    allowEnvFallback: caps.allowSharedTokenFallback,
    session,
  });

  const headers = getGithubHeaders(userToken, {
    allowEnvFallback: caps.allowSharedTokenFallback,
  });

  try {
    const results = await Promise.all(
      repoList.map(async (fullName) => {
        const result = await fetchManifest(fullName, headers);
        return { name: fullName, deps: result?.deps ?? [], file: result?.file ?? null };
      })
    );

    const nodes: { id: string; type: "repo" | "library"; group: number }[] = [];
    const links: { source: string; target: string; value: number }[] = [];
    const seenLibs = new Set<string>();

    for (const { name, deps } of results) {
      nodes.push({ id: name, type: "repo", group: 1 });
      for (const dep of deps) {
        if (!seenLibs.has(dep)) {
          seenLibs.add(dep);
          nodes.push({ id: dep, type: "library", group: 2 });
        }
        links.push({ source: name, target: dep, value: 1 });
      }
    }

    const estimatedGithubCalls = repoList.length * MANIFESTS.length;
    await trackUsageEvent({
      userId: session.user.id,
      feature: "dependency-map",
      plan,
      metadata: {
        repoCount: repoList.length,
        githubCalls: estimatedGithubCalls,
      },
    });

    return NextResponse.json({
      nodes,
      links,
      meta: {
        plan,
        repoLimit: caps.maxReposPerRequest,
        tokenSource,
        githubCalls: estimatedGithubCalls,
      },
    });
  } catch (error) {
    // Log error only in development
    if (process.env.NODE_ENV !== "production") {
      console.error("Dependency Map Error:", error);
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
