import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { sanitizeRepoList } from "@/lib/validate-repo";
import { getCapabilitiesForPlan, resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { trackUsageEvent } from "@/lib/ai-usage";

function ghHeaders(token?: string | null): HeadersInit {
  return {
    Accept: "application/vnd.github.v3+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function ghGet<T>(url: string, token?: string | null): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: ghHeaders(token),
      next: { revalidate: 120 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ── DORA tier classification ───────────────────────────────────────────────────
export type DoraTier = "elite" | "high" | "medium" | "low";

export function classifyLeadTime(hours: number): DoraTier {
  if (hours <= 24)    return "elite";   // < 1 day
  if (hours <= 168)   return "high";    // < 1 week
  if (hours <= 720)   return "medium";  // < 1 month
  return "low";
}

export function classifyDeployFreq(perDay: number): DoraTier {
  if (perDay >= 1)    return "elite";   // multiple per day / on-demand
  if (perDay >= 1/7)  return "high";    // once per week
  if (perDay >= 1/30) return "medium";  // once per month
  return "low";
}

export function classifyCFR(rate: number): DoraTier {
  if (rate <= 0.05)   return "elite";   // 0–5%
  if (rate <= 0.10)   return "high";    // 5–10%
  if (rate <= 0.15)   return "medium";  // 10–15%
  return "low";
}

export function classifyMTTR(hours: number): DoraTier {
  if (hours <= 1)     return "elite";   // < 1 hour
  if (hours <= 24)    return "high";    // < 1 day
  if (hours <= 168)   return "medium";  // < 1 week
  return "low";
}

// Overall DORA tier = worst of the four
export function overallDoraTier(tiers: DoraTier[]): DoraTier {
  if (tiers.includes("low"))    return "low";
  if (tiers.includes("medium")) return "medium";
  if (tiers.includes("high"))   return "high";
  return "elite";
}

export interface DoraMetrics {
  // Lead Time for Changes — time from first commit to deploy/merge (hours)
  leadTime: number;
  leadTimeTier: DoraTier;
  // Deployment Frequency — merges/deploys per day over the window
  deployFreq: number;
  deployFreqTier: DoraTier;
  // Change Failure Rate — % of merges that triggered a hotfix/revert (0–1)
  cfr: number;
  cfrTier: DoraTier;
  // Mean Time to Restore — avg hours to close bug/incident issues
  mttr: number;
  mttrTier: DoraTier;
  // Derived / extra
  overallTier: DoraTier;
  cycleTime: number;    // PR open→merge (hours) — for chart compat
  freq: number;         // alias for deployFreq (backwards compat)
  count: number;        // merged PRs in window
  busFactor: number;    // unique contributors in commit window
  revertCount: number;  // hotfix / revert PRs detected
  // CI signal metadata (optional — absent when using PR-merge fallback)
  deploySource?: "github-deployments" | "actions-workflows" | "pr-merges";
  workflowPassRate?: number | null;    // % of main-branch CI runs that passed
  githubDeploymentCount?: number;      // raw GitHub Deployments API count
}

export interface DoraRepoResult {
  name: string;
  metrics: DoraMetrics | null;
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
  if (!repoList) {
    return NextResponse.json({ error: "Invalid repository format" }, { status: 400 });
  }

  const { token, source: tokenSource } = await getGitHubTokenWithSource({
    allowEnvFallback: caps.allowSharedTokenFallback,
    session,
  });

  const pullWindow  = plan === "free" ? 20  : 60;
  const issueWindow = plan === "free" ? 20  : 60;
  const leadSamples = plan === "free" ? 3   : 10;

  try {
    const metricsMap = await Promise.all(
      repoList.map(async (fullName): Promise<DoraRepoResult> => {
        try {
          // ── Parallel fetch all signals ────────────────────────────────────
          const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const [pulls, commits, deployments, workflowRunsRaw, bugIssues, repoMeta] = await Promise.all([
            ghGet<{ number: number; merged_at: string | null; created_at: string; title: string }[]>(
              `https://api.github.com/repos/${fullName}/pulls?state=closed&per_page=${pullWindow}&sort=updated&direction=desc`,
              token
            ),
            ghGet<{ author?: { login?: string } }[]>(
              `https://api.github.com/repos/${fullName}/commits?per_page=60`,
              token
            ),
            // GitHub Deployments API — real CI/CD events (empty if repo doesn't use GitHub Deployments)
            ghGet<{ id: number; created_at: string; environment: string; statuses_url: string }[]>(
              `https://api.github.com/repos/${fullName}/deployments?per_page=30`,
              token
            ),
            // GitHub Actions workflow runs — production deployments on default branch
            ghGet<{ workflow_runs: { id: number; status: string; conclusion: string | null; created_at: string; head_branch: string; event: string; run_started_at: string; updated_at: string }[] }>(
              `https://api.github.com/repos/${fullName}/actions/runs?per_page=60&created=>=${since30d}`,
              token
            ),
            ghGet<{ created_at: string; closed_at: string | null; pull_request?: object }[]>(
              `https://api.github.com/repos/${fullName}/issues?state=closed&labels=bug&per_page=${issueWindow}&sort=updated&direction=desc`,
              token
            ),
            ghGet<{ default_branch: string; private: boolean }>(
              `https://api.github.com/repos/${fullName}`,
              token
            ),
          ]);

          if (!pulls) return { name: fullName, metrics: null };

          const defaultBranch = repoMeta?.default_branch ?? "main";
          const mergedPulls   = pulls.filter((p) => p.merged_at);
          const windowDays    = 30;

          // ── Bus factor ────────────────────────────────────────────────────
          const contributors = new Set((commits ?? []).map((c) => c.author?.login).filter(Boolean));
          const busFactor = Math.max(1, contributors.size);

          if (mergedPulls.length === 0 && !deployments?.length) {
            return {
              name: fullName,
              metrics: {
                leadTime: 0, leadTimeTier: "low",
                deployFreq: 0, deployFreqTier: "low",
                cfr: 0, cfrTier: "elite",
                mttr: 0, mttrTier: "elite",
                overallTier: "low",
                cycleTime: 0, freq: 0, count: 0, busFactor, revertCount: 0,
              },
            };
          }

          // ── Cycle time = avg(merged_at - created_at) ──────────────────────
          const totalCycleMs = mergedPulls.reduce(
            (acc, p) => acc + (new Date(p.merged_at!).getTime() - new Date(p.created_at).getTime()), 0
          );
          const cycleTime = mergedPulls.length > 0 ? totalCycleMs / mergedPulls.length / 3_600_000 : 0;

          // ── Lead Time — first commit in PR → merge/deploy ─────────────────
          let totalLeadMs = 0;
          let leadCount   = 0;
          for (const pr of mergedPulls.slice(0, leadSamples)) {
            const prCommits = await ghGet<{ commit: { committer: { date: string } } }[]>(
              `https://api.github.com/repos/${fullName}/pulls/${pr.number}/commits?per_page=100`,
              token
            );
            if (!prCommits || prCommits.length === 0) continue;
            const firstCommit = prCommits.reduce((min, c) =>
              c.commit.committer.date < min ? c.commit.committer.date : min,
              prCommits[0].commit.committer.date
            );
            totalLeadMs += new Date(pr.merged_at!).getTime() - new Date(firstCommit).getTime();
            leadCount++;
          }
          const leadTime = leadCount > 0 ? totalLeadMs / leadCount / 3_600_000 : cycleTime * 1.3;

          // ── Deployment Frequency ──────────────────────────────────────────
          // Priority: GitHub Deployments API > Actions workflow runs > PR merge rate
          let deployFreq: number;
          let deploySource: "github-deployments" | "actions-workflows" | "pr-merges" = "pr-merges";

          if (deployments && deployments.length > 0) {
            // Real GitHub Deployments (GitHub Actions, Heroku, Vercel, etc. that use the API)
            const recentDeploys = deployments.filter((d) => new Date(d.created_at) >= new Date(since30d));
            deployFreq = recentDeploys.length / windowDays;
            deploySource = "github-deployments";
          } else if (workflowRunsRaw?.workflow_runs?.length) {
            // GitHub Actions — count successful runs on the default branch
            const prodRuns = workflowRunsRaw.workflow_runs.filter(
              (r) => r.head_branch === defaultBranch &&
                     r.conclusion === "success" &&
                     (r.event === "push" || r.event === "workflow_dispatch")
            );
            deployFreq = prodRuns.length / windowDays;
            deploySource = "actions-workflows";
          } else {
            // Fallback: merged PR rate as proxy
            deployFreq = mergedPulls.length / windowDays;
          }

          // ── Change Failure Rate ───────────────────────────────────────────
          // Signal 1: workflow failures on default branch
          let cfr = 0;
          const workflowRuns = workflowRunsRaw?.workflow_runs ?? [];
          const mainRuns = workflowRuns.filter(
            (r) => r.head_branch === defaultBranch && r.conclusion !== null && r.event === "push"
          );
          if (mainRuns.length > 0) {
            const failures = mainRuns.filter((r) => r.conclusion === "failure");
            cfr = failures.length / mainRuns.length;
          } else {
            // Fallback: detect hotfix/revert PRs by title
            const HOTFIX_RE = /\b(hotfix|hot[_-]fix|revert|rollback|fix[_-]?deploy|emergency|incident|patch)\b/i;
            const revertCount2 = mergedPulls.filter((p) => HOTFIX_RE.test(p.title)).length;
            cfr = mergedPulls.length > 0 ? revertCount2 / mergedPulls.length : 0;
          }

          // ── Revert / hotfix PR count ──────────────────────────────────────
          const HOTFIX_RE = /\b(hotfix|hot[_-]fix|revert|rollback|fix[_-]?deploy|emergency|incident|patch)\b/i;
          const revertPulls = mergedPulls.filter((p) => HOTFIX_RE.test(p.title));
          const revertCount = revertPulls.length;

          // ── MTTR ─────────────────────────────────────────────────────────
          // Signal 1: workflow failure → next success on default branch
          let mttr = 0;
          if (mainRuns.length >= 2) {
            const sorted = [...mainRuns].sort((a, b) => new Date(a.run_started_at ?? a.created_at).getTime() - new Date(b.run_started_at ?? b.created_at).getTime());
            const recoveryTimes: number[] = [];
            for (let i = 0; i < sorted.length - 1; i++) {
              if (sorted[i].conclusion === "failure" && sorted[i + 1].conclusion === "success") {
                recoveryTimes.push(new Date(sorted[i + 1].updated_at).getTime() - new Date(sorted[i].updated_at).getTime());
              }
            }
            if (recoveryTimes.length > 0) {
              mttr = recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length / 3_600_000;
            }
          }
          // Signal 2: avg bug issue close time
          if (mttr === 0 && bugIssues && bugIssues.length > 0) {
            const closedBugs = bugIssues.filter((i) => i.closed_at && !i.pull_request);
            if (closedBugs.length > 0) {
              const totalMs = closedBugs.reduce(
                (acc, i) => acc + (new Date(i.closed_at!).getTime() - new Date(i.created_at).getTime()), 0
              );
              mttr = totalMs / closedBugs.length / 3_600_000;
            }
          }
          // Signal 3: revert PR cycle time
          if (mttr === 0 && revertPulls.length > 0) {
            const revertCycleMs = revertPulls.reduce(
              (acc, p) => acc + (new Date(p.merged_at!).getTime() - new Date(p.created_at).getTime()), 0
            );
            mttr = revertCycleMs / revertPulls.length / 3_600_000;
          }

          // ── Tier classification ───────────────────────────────────────────
          const leadTimeTier   = classifyLeadTime(leadTime);
          const deployFreqTier = classifyDeployFreq(deployFreq);
          const cfrTier        = classifyCFR(cfr);
          const mttrTier       = classifyMTTR(mttr || 0.5);
          const overall        = overallDoraTier([leadTimeTier, deployFreqTier, cfrTier, mttrTier]);

          return {
            name: fullName,
            metrics: {
              leadTime:    Math.round(leadTime   * 10) / 10,
              leadTimeTier,
              deployFreq:  Math.round(deployFreq * 100) / 100,
              deployFreqTier,
              cfr:         Math.round(cfr * 1000) / 1000,
              cfrTier,
              mttr:        Math.round(mttr * 10) / 10,
              mttrTier,
              overallTier: overall,
              cycleTime:   Math.round(cycleTime * 10) / 10,
              freq:        Math.round(deployFreq * 100) / 100,
              count:       mergedPulls.length,
              busFactor,
              revertCount,
              // Extra signals surfaced to UI
              deploySource,
              workflowPassRate: mainRuns.length > 0
                ? Math.round((mainRuns.filter((r) => r.conclusion === "success").length / mainRuns.length) * 100)
                : null,
              githubDeploymentCount: deployments?.length ?? 0,
            } as DoraMetrics,
          };
        } catch {
          return { name: fullName, metrics: null };
        }
      })
    );

    const estimatedGithubCalls = repoList.length * (3 + leadSamples);
    await trackUsageEvent({
      userId: session.user.id,
      feature: "dora-metrics",
      plan,
      metadata: { repoCount: repoList.length, githubCalls: estimatedGithubCalls },
    });

    return NextResponse.json({
      items: metricsMap,
      meta: { plan, repoLimit: caps.maxReposPerRequest, tokenSource, githubCalls: estimatedGithubCalls },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.error("DORA Metrics Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
