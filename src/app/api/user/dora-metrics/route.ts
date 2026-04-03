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

  const pullWindow = plan === "free" ? 15 : plan === "professional" ? 30 : 50;
  const commitWindow = plan === "free" ? 30 : 60;
  const leadSamples = plan === "free" ? 2 : plan === "professional" ? 5 : plan === "team" ? 8 : 10;

  try {
    const metricsMap = await Promise.all(
      repoList.map(async (fullName) => {
        try {
          const pullsRes = await fetch(
            `https://api.github.com/repos/${fullName}/pulls?state=closed&per_page=${pullWindow}`,
            { headers: ghHeaders(token), next: { revalidate: 120 } }
          );

          if (!pullsRes.ok) return { name: fullName, metrics: null };

          const pulls: { number: number; merged_at: string | null; created_at: string }[] = await pullsRes.json();
          const mergedPulls = pulls.filter((p) => p.merged_at);

          const commitsRes = await fetch(`https://api.github.com/repos/${fullName}/commits?per_page=${commitWindow}`, {
            headers: ghHeaders(token),
            next: { revalidate: 120 },
          });

          const commits: { author?: { login?: string } }[] = commitsRes.ok ? await commitsRes.json() : [];
          const contributors = new Set(commits.map((c) => c.author?.login).filter(Boolean));
          const busFactor = contributors.size;

          if (mergedPulls.length === 0) {
            return {
              name: fullName,
              metrics: { leadTime: 0, cycleTime: 0, freq: 0, count: 0, busFactor },
            };
          }

          const totalCycleMs = mergedPulls.reduce((acc, p) => {
            return acc + (new Date(p.merged_at!).getTime() - new Date(p.created_at).getTime());
          }, 0);
          const cycleTime = totalCycleMs / mergedPulls.length / (1000 * 60 * 60);

          let totalLeadMs = 0;
          let leadCount = 0;
          for (const pr of mergedPulls.slice(0, leadSamples)) {
            try {
              const prCommitsRes = await fetch(
                `https://api.github.com/repos/${fullName}/pulls/${pr.number}/commits?per_page=100`,
                { headers: ghHeaders(token), next: { revalidate: 120 } }
              );
              if (!prCommitsRes.ok) continue;

              const prCommits: { commit: { committer: { date: string } } }[] = await prCommitsRes.json();
              if (prCommits.length === 0) continue;

              const firstCommitDate = prCommits.reduce((minDate, commit) => {
                const candidate = commit.commit.committer.date;
                return candidate < minDate ? candidate : minDate;
              }, prCommits[0].commit.committer.date);

              totalLeadMs += new Date(pr.merged_at!).getTime() - new Date(firstCommitDate).getTime();
              leadCount += 1;
            } catch {
              // Skip noisy PR commit errors
            }
          }

          const leadTime = leadCount > 0 ? totalLeadMs / leadCount / (1000 * 60 * 60) : cycleTime * 1.3;
          const frequencyPerDay = mergedPulls.length / 30;

          return {
            name: fullName,
            metrics: {
              leadTime: Math.round(leadTime * 10) / 10,
              cycleTime: Math.round(cycleTime * 10) / 10,
              freq: Math.round(frequencyPerDay * 10) / 10,
              count: mergedPulls.length,
              busFactor,
            },
          };
        } catch {
          return { name: fullName, metrics: null };
        }
      })
    );

    const estimatedGithubCalls = repoList.length * (2 + leadSamples);
    await trackUsageEvent({
      userId: session.user.id,
      feature: "dora-metrics",
      plan,
      metadata: {
        repoCount: repoList.length,
        githubCalls: estimatedGithubCalls,
      },
    });

    return NextResponse.json({
      items: metricsMap,
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
      console.error("DORA Metrics Error:", error);
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
