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

  const pullWindow  = plan === "free" ? 20  : plan === "professional" ? 40  : 60;
  const issueWindow = plan === "free" ? 20  : plan === "professional" ? 40  : 60;
  const leadSamples = plan === "free" ? 3   : plan === "professional" ? 6   : 10;

  try {
    const metricsMap = await Promise.all(
      repoList.map(async (fullName): Promise<DoraRepoResult> => {
        try {
          // ── 1. Merged PRs ─────────────────────────────────────────────────
          const pulls = await ghGet<{ number: number; merged_at: string | null; created_at: string; title: string }[]>(
            `https://api.github.com/repos/${fullName}/pulls?state=closed&per_page=${pullWindow}&sort=updated&direction=desc`,
            token
          );
          if (!pulls) return { name: fullName, metrics: null };

          const mergedPulls = pulls.filter((p) => p.merged_at);
          const windowDays  = pullWindow; // treat the PR count as covering ~windowDays days

          // ── 2. Commits for bus factor ─────────────────────────────────────
          const commits = await ghGet<{ author?: { login?: string } }[]>(
            `https://api.github.com/repos/${fullName}/commits?per_page=60`,
            token
          );
          const contributors = new Set((commits ?? []).map((c) => c.author?.login).filter(Boolean));
          const busFactor = Math.max(1, contributors.size);

          if (mergedPulls.length === 0) {
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

          // ── 3. Cycle time = avg(merged_at - created_at) in hours ──────────
          const totalCycleMs = mergedPulls.reduce(
            (acc, p) => acc + (new Date(p.merged_at!).getTime() - new Date(p.created_at).getTime()), 0
          );
          const cycleTime = totalCycleMs / mergedPulls.length / 3_600_000;

          // ── 4. Lead time = avg first-commit → merge for sampled PRs ───────
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

          // ── 5. Deployment Frequency ───────────────────────────────────────
          // Proxy: merged PR rate. If repo has GitHub Actions workflows we
          // could check workflow runs, but PR merge rate is a solid proxy.
          const deployFreq = mergedPulls.length / windowDays; // per day

          // ── 6. Change Failure Rate (CFR) ──────────────────────────────────
          // Detect hotfix/revert PRs by title keywords
          const HOTFIX_RE = /\b(hotfix|hot[_-]fix|revert|rollback|fix[_-]?deploy|emergency|incident|patch)\b/i;
          const revertPulls = mergedPulls.filter((p) => HOTFIX_RE.test(p.title));
          const revertCount = revertPulls.length;
          const cfr = mergedPulls.length > 0 ? revertCount / mergedPulls.length : 0;

          // ── 7. MTTR — avg bug issue close time ────────────────────────────
          let mttr = 0;
          const bugIssues = await ghGet<{ created_at: string; closed_at: string | null; pull_request?: object }[]>(
            `https://api.github.com/repos/${fullName}/issues?state=closed&labels=bug&per_page=${issueWindow}&sort=updated&direction=desc`,
            token
          );
          if (bugIssues && bugIssues.length > 0) {
            const closedBugs = bugIssues.filter((i) => i.closed_at && !i.pull_request);
            if (closedBugs.length > 0) {
              const totalMs = closedBugs.reduce(
                (acc, i) => acc + (new Date(i.closed_at!).getTime() - new Date(i.created_at).getTime()), 0
              );
              mttr = totalMs / closedBugs.length / 3_600_000;
            }
          }
          // Fallback: if no bug issues, estimate MTTR from cycle time of revert PRs
          if (mttr === 0 && revertPulls.length > 0) {
            const revertCycleMs = revertPulls.reduce(
              (acc, p) => acc + (new Date(p.merged_at!).getTime() - new Date(p.created_at).getTime()), 0
            );
            mttr = revertCycleMs / revertPulls.length / 3_600_000;
          }

          // ── 8. Tier classification ────────────────────────────────────────
          const leadTimeTier  = classifyLeadTime(leadTime);
          const deployFreqTier = classifyDeployFreq(deployFreq);
          const cfrTier       = classifyCFR(cfr);
          const mttrTier      = classifyMTTR(mttr || 0.5); // 0 → assume elite
          const overall       = overallDoraTier([leadTimeTier, deployFreqTier, cfrTier, mttrTier]);

          return {
            name: fullName,
            metrics: {
              leadTime:   Math.round(leadTime   * 10) / 10,
              leadTimeTier,
              deployFreq: Math.round(deployFreq * 100) / 100,
              deployFreqTier,
              cfr:        Math.round(cfr * 1000) / 1000,
              cfrTier,
              mttr:       Math.round(mttr * 10) / 10,
              mttrTier,
              overallTier: overall,
              cycleTime:  Math.round(cycleTime  * 10) / 10,
              freq:       Math.round(deployFreq * 100) / 100,
              count:      mergedPulls.length,
              busFactor,
              revertCount,
            },
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
