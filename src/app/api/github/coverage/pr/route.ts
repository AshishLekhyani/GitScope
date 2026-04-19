export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

async function ghJson<T>(url: string, token: string | null, accept = "application/vnd.github+json"): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch { return null; }
}

export interface PrCoverageResult {
  prNumber: number;
  baseCoverage: number | null;
  headCoverage: number | null;
  delta: number | null;
  status: "improved" | "degraded" | "unchanged" | "unknown";
  source: "codecov" | "estimated" | "none";
  filesChanged: { filename: string; additions: number; deletions: number; isTestFile: boolean }[];
  testFilesCount: number;
  totalFilesChanged: number;
}

async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = req.nextUrl.searchParams.get("repo");
  const prParam = req.nextUrl.searchParams.get("pr");
  if (!repo || !repo.includes("/") || !prParam) {
    return NextResponse.json({ error: "repo and pr params required" }, { status: 400 });
  }
  const prNumber = parseInt(prParam, 10);
  if (isNaN(prNumber) || prNumber < 1) {
    return NextResponse.json({ error: "Invalid PR number" }, { status: 400 });
  }

  const [owner, repoName] = repo.split("/");
  const token = await getGitHubToken();

  const result: PrCoverageResult = {
    prNumber,
    baseCoverage: null,
    headCoverage: null,
    delta: null,
    status: "unknown",
    source: "none",
    filesChanged: [],
    testFilesCount: 0,
    totalFilesChanged: 0,
  };

  // ── 1. Fetch PR files from GitHub ────────────────────────────────────────────
  const prFiles = await ghJson<{ filename: string; additions: number; deletions: number; status: string }[]>(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100`,
    token
  );

  if (prFiles) {
    const TEST_RE = /\.(test|spec)\.[tj]sx?$|__tests__|\/test\//i;
    result.filesChanged = prFiles.map((f) => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      isTestFile: TEST_RE.test(f.filename),
    }));
    result.totalFilesChanged = prFiles.length;
    result.testFilesCount = result.filesChanged.filter((f) => f.isTestFile).length;
  }

  // ── 2. Codecov PR comparison (primary signal) ────────────────────────────────
  try {
    const codecovPr = await fetch(
      `https://codecov.io/api/v2/github/${owner}/repos/${repoName}/pulls/${prNumber}/`,
      { headers: { Accept: "application/json" }, next: { revalidate: 300 } }
    );
    if (codecovPr.ok) {
      const data = await codecovPr.json() as {
        head?: { totals?: { coverage?: string | number } };
        base?: { totals?: { coverage?: string | number } };
      };
      const head = data?.head?.totals?.coverage;
      const base = data?.base?.totals?.coverage;
      if (head !== undefined && head !== null) {
        result.headCoverage = Math.round(parseFloat(String(head)) * 10) / 10;
        result.source = "codecov";
      }
      if (base !== undefined && base !== null) {
        result.baseCoverage = Math.round(parseFloat(String(base)) * 10) / 10;
        result.source = "codecov";
      }
    }
  } catch { /* codecov unavailable */ }

  // ── 3. Fallback: estimate from repo-level coverage + test file ratio ─────────
  if (result.source === "none" || result.headCoverage === null) {
    try {
      const codecovRepo = await fetch(
        `https://codecov.io/api/v2/github/${owner}/repos/${repoName}/`,
        { headers: { Accept: "application/json" }, next: { revalidate: 3600 } }
      );
      if (codecovRepo.ok) {
        const repoData = await codecovRepo.json() as { totals?: { coverage?: string | number } };
        const cov = repoData?.totals?.coverage;
        if (cov !== undefined && cov !== null) {
          result.baseCoverage = Math.round(parseFloat(String(cov)) * 10) / 10;
          // Estimate head coverage based on test file ratio in PR
          if (result.totalFilesChanged > 0) {
            const testRatio = result.testFilesCount / result.totalFilesChanged;
            // More test files = likely coverage improvement; more source-only = likely neutral/drop
            const estimatedDelta = testRatio > 0.3 ? +(testRatio * 2).toFixed(1) : testRatio > 0 ? 0 : -0.5;
            result.headCoverage = Math.round((result.baseCoverage + estimatedDelta) * 10) / 10;
            result.source = "estimated";
          }
        }
      }
    } catch { /* no coverage data available */ }
  }

  // ── 4. Compute delta + status ────────────────────────────────────────────────
  if (result.headCoverage !== null && result.baseCoverage !== null) {
    result.delta = Math.round((result.headCoverage - result.baseCoverage) * 10) / 10;
    if (result.delta > 0.1) result.status = "improved";
    else if (result.delta < -0.1) result.status = "degraded";
    else result.status = "unchanged";
  }

  return NextResponse.json(result);
}

export const GET = withRouteSecurity(handler, SecurityPresets.standard);
