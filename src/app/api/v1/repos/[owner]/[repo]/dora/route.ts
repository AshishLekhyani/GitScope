export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { getGitHubTokenWithSource } from "@/lib/github-auth";

// GET /api/v1/repos/{owner}/{repo}/dora
// Returns DORA metrics for the given repo using the API key owner's GitHub token (scope: dora:read)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const auth = await authenticateApiKey(req, "dora:read");
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }

  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // Get the user's GitHub token directly — avoids session dependency
  const { token } = await getGitHubTokenWithSource({ userId: auth.userId, allowEnvFallback: false });

  // Proxy to DORA computation as a server-internal fetch using a Bearer auth header
  // that bypasses the normal NextAuth session (the internal route supports x-api-key-user-id)
  // Instead, we call the GitHub API directly with the user's token
  if (!token) {
    return NextResponse.json({ error: "No GitHub token available for this account" }, { status: 403 });
  }

  function ghHeaders(): HeadersInit {
    return { Accept: "application/vnd.github.v3+json", Authorization: `Bearer ${token}` };
  }

  async function ghGet<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url, { headers: ghHeaders(), next: { revalidate: 120 } });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch { return null; }
  }

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const windowDays = 30;

  const [pulls, deployments, workflowRunsRaw, bugIssues, repoMeta] = await Promise.all([
    ghGet<{ number: number; merged_at: string | null; created_at: string; title: string }[]>(
      `https://api.github.com/repos/${fullName}/pulls?state=closed&per_page=30&sort=updated&direction=desc`
    ),
    ghGet<{ id: number; created_at: string }[]>(
      `https://api.github.com/repos/${fullName}/deployments?per_page=30`
    ),
    ghGet<{ workflow_runs: { head_branch: string; conclusion: string | null; event: string; created_at: string; run_started_at: string; updated_at: string }[] }>(
      `https://api.github.com/repos/${fullName}/actions/runs?per_page=60&created=>${since30d}`
    ),
    ghGet<{ created_at: string; closed_at: string | null; pull_request?: object }[]>(
      `https://api.github.com/repos/${fullName}/issues?state=closed&labels=bug&per_page=20&sort=updated&direction=desc`
    ),
    ghGet<{ default_branch: string }>(
      `https://api.github.com/repos/${fullName}`
    ),
  ]);

  if (!pulls) {
    return NextResponse.json({ error: "Repository not found or no access" }, { status: 404 });
  }

  const defaultBranch = repoMeta?.default_branch ?? "main";
  const mergedPulls = pulls.filter((p) => p.merged_at);

  const totalCycleMs = mergedPulls.reduce(
    (acc, p) => acc + (new Date(p.merged_at!).getTime() - new Date(p.created_at).getTime()), 0
  );
  const cycleTime = mergedPulls.length > 0 ? totalCycleMs / mergedPulls.length / 3_600_000 : 0;

  let deployFreq: number;
  let deploySource: string;
  if (deployments && deployments.length > 0) {
    const recent = deployments.filter((d) => new Date(d.created_at) >= new Date(since30d));
    deployFreq = recent.length / windowDays;
    deploySource = "github-deployments";
  } else if (workflowRunsRaw?.workflow_runs?.length) {
    const prodRuns = workflowRunsRaw.workflow_runs.filter(
      (r) => r.head_branch === defaultBranch && r.conclusion === "success" && (r.event === "push" || r.event === "workflow_dispatch")
    );
    deployFreq = prodRuns.length / windowDays;
    deploySource = "actions-workflows";
  } else {
    deployFreq = mergedPulls.length / windowDays;
    deploySource = "pr-merges";
  }

  const workflowRuns = workflowRunsRaw?.workflow_runs ?? [];
  const mainRuns = workflowRuns.filter(
    (r) => r.head_branch === defaultBranch && r.conclusion !== null && r.event === "push"
  );
  let cfr = 0;
  if (mainRuns.length > 0) {
    cfr = mainRuns.filter((r) => r.conclusion === "failure").length / mainRuns.length;
  } else {
    const HOTFIX_RE = /\b(hotfix|revert|rollback|fix[_-]?deploy|emergency|incident|patch)\b/i;
    cfr = mergedPulls.length > 0 ? mergedPulls.filter((p) => HOTFIX_RE.test(p.title)).length / mergedPulls.length : 0;
  }

  let mttr = 0;
  if (mainRuns.length >= 2) {
    const sorted = [...mainRuns].sort((a, b) => new Date(a.run_started_at ?? a.created_at).getTime() - new Date(b.run_started_at ?? b.created_at).getTime());
    const recoveries: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].conclusion === "failure" && sorted[i + 1].conclusion === "success") {
        recoveries.push(new Date(sorted[i + 1].updated_at).getTime() - new Date(sorted[i].updated_at).getTime());
      }
    }
    if (recoveries.length > 0) mttr = recoveries.reduce((a, b) => a + b, 0) / recoveries.length / 3_600_000;
  }
  if (mttr === 0 && bugIssues) {
    const closed = bugIssues.filter((i) => i.closed_at && !i.pull_request);
    if (closed.length > 0) {
      mttr = closed.reduce((acc, i) => acc + (new Date(i.closed_at!).getTime() - new Date(i.created_at).getTime()), 0) / closed.length / 3_600_000;
    }
  }

  return NextResponse.json({
    object: "dora_metrics",
    repo: fullName,
    data: {
      leadTime: Math.round(cycleTime * 1.3 * 10) / 10,
      deployFreq: Math.round(deployFreq * 100) / 100,
      cfr: Math.round(cfr * 1000) / 1000,
      mttr: Math.round(mttr * 10) / 10,
      cycleTime: Math.round(cycleTime * 10) / 10,
      count: mergedPulls.length,
      deploySource,
      windowDays,
    },
  });
}
