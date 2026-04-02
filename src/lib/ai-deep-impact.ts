import type { Session } from "next-auth";
import { deepCodeImpact } from "@/lib/ai";
import type { AiPlan } from "@/lib/ai-plan";
import {
  getGitHubTokenWithSource,
  type GitHubTokenSource,
} from "@/lib/github-auth";

function ghHeaders(token?: string | null): HeadersInit {
  return {
    Accept: "application/vnd.github.v3+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function rawHeaders(token?: string | null): HeadersInit {
  return {
    Accept: "text/plain",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function isTextLike(contentType: string): boolean {
  const value = contentType.toLowerCase();
  return (
    value.startsWith("text/") ||
    value.includes("json") ||
    value.includes("javascript") ||
    value.includes("typescript") ||
    value.includes("xml") ||
    value.includes("yaml") ||
    value.includes("toml")
  );
}

async function fetchCodeSnippet(
  rawUrl: string,
  token: string | null
): Promise<string | undefined> {
  try {
    const res = await fetch(rawUrl, {
      headers: rawHeaders(token),
      next: { revalidate: 60 },
    });
    if (!res.ok) return undefined;

    const contentType = res.headers.get("content-type") ?? "text/plain";
    if (!isTextLike(contentType)) return undefined;

    const text = await res.text();
    if (!text) return undefined;

    const lines = text.split("\n").slice(0, 120).join("\n");
    return lines.slice(0, 6000);
  } catch {
    return undefined;
  }
}

export class DeepImpactError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RunDeepImpactInput {
  repo: string;
  prNumber: number;
  plan: AiPlan;
  maxFiles: number;
  allowEnvFallback: boolean;
  session?: Session | null;
  userId?: string;
}

export async function runDeepImpactScan(input: RunDeepImpactInput) {
  const { token, source } = await getGitHubTokenWithSource({
    allowEnvFallback: input.allowEnvFallback,
    session: input.session,
    userId: input.userId,
  });

  const [detailRes, filesRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${input.repo}/pulls/${input.prNumber}`, {
      headers: ghHeaders(token),
    }),
    fetch(
      `https://api.github.com/repos/${input.repo}/pulls/${input.prNumber}/files?per_page=100`,
      { headers: ghHeaders(token) }
    ),
  ]);

  if (!detailRes.ok) {
    throw new DeepImpactError("PR not found", detailRes.status);
  }

  type GHFile = {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
    raw_url?: string;
  };

  const [detail, files] = await Promise.all([
    detailRes.json(),
    filesRes.ok ? (filesRes.json() as Promise<GHFile[]>) : Promise.resolve([]),
  ]);

  const sortedFiles = [...files]
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    .slice(0, input.maxFiles);

  const snippetCandidates = sortedFiles
    .filter((f) => Boolean(f.raw_url))
    .slice(0, Math.min(8, input.maxFiles));
  const snippetEntries = await Promise.all(
    snippetCandidates.map(async (f) => {
      const snippet = f.raw_url
        ? await fetchCodeSnippet(f.raw_url, token)
        : undefined;
      return [f.filename, snippet] as const;
    })
  );
  const snippetMap = new Map<string, string | undefined>(snippetEntries);

  const report = await deepCodeImpact(
    {
      prNumber: input.prNumber,
      title: detail.title ?? "",
      body: detail.body ?? "",
      author: detail.user?.login ?? "unknown",
      additions: detail.additions ?? 0,
      deletions: detail.deletions ?? 0,
      files: sortedFiles.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
        snippet: snippetMap.get(f.filename),
      })),
    },
    {
      plan: input.plan,
      maxFiles: input.maxFiles,
    }
  );

  return {
    report,
    tokenSource: source as GitHubTokenSource,
    maxFilesAnalyzed: input.maxFiles,
    githubCalls: 2 + snippetCandidates.length,
  };
}
