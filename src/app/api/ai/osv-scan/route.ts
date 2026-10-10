export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";
import { LOCKFILE } from "@/lib/repo-archive";
import { groupVulnerabilities, scanDependencies } from "@/lib/osv";

const MANIFEST = /(?:^|\/)(?:package\.json|pyproject\.toml|go\.mod|requirements(?:[-_.][\w-]+)?\.txt)$/;
const SKIP = /(?:^|\/)(?:node_modules|vendor|\.git|dist|build|fixtures?|__fixtures__|test-?data|examples?)\//i;

function githubHeaders(token: string | null, accept: string): Record<string, string> {
  return {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { repo?: string; branch?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { repo } = body;
  if (!repo || typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "repo is required (owner/name)" }, { status: 400 });
  }
  const ref = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : "HEAD";

  const token = await getGitHubToken();
  const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
    headers: githubHeaders(token, "application/vnd.github+json"),
    cache: "no-store",
  });
  if (!treeRes.ok) {
    const hint =
      treeRes.status === 403 || treeRes.status === 404 ? "Repository not found or private — connect your GitHub account to scan private repos." :
      "GitHub API error reading the repository tree.";
    return NextResponse.json({ error: hint }, { status: treeRes.status === 404 ? 404 : 422 });
  }
  const tree = (await treeRes.json()) as { tree?: Array<{ path: string; type: string }> };
  const candidates = (tree.tree ?? [])
    .filter((t) => t.type === "blob" && !SKIP.test(t.path) && (LOCKFILE.test(t.path) || MANIFEST.test(t.path)))
    .map((t) => t.path)
    .sort((a, b) => a.split("/").length - b.split("/").length || Number(!LOCKFILE.test(a)) - Number(!LOCKFILE.test(b)))
    .slice(0, 16);

  if (candidates.length === 0) {
    return NextResponse.json({
      error: "No supported dependency manifest found (package-lock.json, yarn.lock, pnpm-lock.yaml, poetry.lock, Pipfile.lock, Cargo.lock, Gemfile.lock, composer.lock, go.mod, requirements.txt, package.json or pyproject.toml).",
    }, { status: 404 });
  }

  const files = new Map<string, string>();
  await Promise.all(candidates.map(async (path) => {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
        headers: githubHeaders(token, "application/vnd.github.raw+json"),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) files.set(path, await res.text());
    } catch {
      return;
    }
  }));

  const scan = await scanDependencies(files, { timeoutMs: 40_000 });
  if (scan.scanned === 0) {
    return NextResponse.json({ repo, total: 0, findings: [], scannedPackages: 0, ecosystems: [], lockfiles: scan.lockfiles, complete: true, packages: [] });
  }

  const findings = scan.vulnerabilities.map((v) => ({
    id: v.id,
    aliases: v.aliases,
    package: v.package,
    version: v.version,
    ecosystem: v.ecosystem,
    summary: v.summary,
    severity: v.severity,
    cvss: v.cvss,
    fixedIn: v.fixedIn,
    url: v.url,
    dev: v.dev,
    direct: v.direct,
    approximate: v.approximate,
    source: v.source,
  }));

  return NextResponse.json({
    repo,
    total: findings.length,
    findings,
    scannedPackages: scan.scanned,
    ecosystems: [...new Set(scan.packages.map((p) => p.ecosystem))],
    lockfiles: scan.lockfiles,
    complete: scan.complete,
    packages: groupVulnerabilities(scan.vulnerabilities).map((p) => ({
      name: p.name, version: p.version, ecosystem: p.ecosystem, severity: p.severity, counts: p.counts,
      advisories: p.ids.length, fixTarget: p.fixTarget, unfixed: p.unfixed, dev: p.dev, direct: p.direct,
    })),
  });
}

export const POST = withRouteSecurity(handler, SecurityPresets.ai);
