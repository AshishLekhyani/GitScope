export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";

const GH_API = "https://api.github.com";

async function ghFetchText(path: string, token: string | null): Promise<string | null> {
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3.raw" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(`${GH_API}${path}`, { headers, next: { revalidate: 0 } });
    return res.ok ? res.text() : null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  if (plan !== "developer") {
    return NextResponse.json({ error: "SBOM export requires Developer plan." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  const branch = searchParams.get("branch") ?? undefined;

  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "Invalid repo format. Use owner/repo" }, { status: 400 });
  }

  const { token: ghToken } = await getGitHubTokenWithSource({ session });

  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const pkgRaw = await ghFetchText(`/repos/${repo}/contents/package.json${ref}`, ghToken);

  if (!pkgRaw) {
    return NextResponse.json({ error: "package.json not found in repository." }, { status: 404 });
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(pkgRaw);
  } catch {
    return NextResponse.json({ error: "Failed to parse package.json." }, { status: 422 });
  }

  const deps: Record<string, string> = (pkg.dependencies as Record<string, string>) ?? {};
  const devDeps: Record<string, string> = (pkg.devDependencies as Record<string, string>) ?? {};

  const toComponent = (name: string, version: string, scope: "required" | "optional") => ({
    type: "library",
    name,
    version: version.replace(/^[\^~>=<]/, ""),
    scope,
    purl: `pkg:npm/${name}@${version.replace(/^[\^~>=<]/, "")}`,
  });

  const components = [
    ...Object.entries(deps).map(([n, v]) => toComponent(n, v, "required")),
    ...Object.entries(devDeps).map(([n, v]) => toComponent(n, v, "optional")),
  ];

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.4",
    version: 1,
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "GitScope", name: "GitScope SBOM Exporter", version: "1.0" }],
      component: {
        type: "application",
        name: typeof pkg.name === "string" ? pkg.name : repo,
        version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
      },
    },
    components,
  };

  return new NextResponse(JSON.stringify(sbom, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="sbom-${repo.replace("/", "-")}${branch ? `-${branch}` : ""}.cdx.json"`,
    },
  });
}
