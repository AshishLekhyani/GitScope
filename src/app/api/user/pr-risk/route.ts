import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isValidRepo } from "@/lib/validate-repo";
import { analyzePRBatch, hasAIProvider, PRSummary } from "@/lib/ai";
import { getCapabilitiesForPlan, resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { consumeUsageBudget } from "@/lib/ai-usage";

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
  const repo = searchParams.get("repo");
  if (!repo) return NextResponse.json({ error: "No repository specified" }, { status: 400 });
  if (!isValidRepo(repo)) return NextResponse.json({ error: "Invalid repository format" }, { status: 400 });

  const aiBudget = await consumeUsageBudget({
    userId: session.user.id,
    feature: "pr-risk",
    plan,
    limit: caps.aiRequestsPerHour,
    metadata: { endpoint: "/api/user/pr-risk" },
  });
  if (!aiBudget.allowed) {
    return NextResponse.json(
      {
        error: "AI analysis rate limit reached for your current plan.",
        upgradeHint: "Upgrade your AI tier or wait for hourly reset.",
      },
      { status: 429 }
    );
  }

  const { token, source: tokenSource } = await getGitHubTokenWithSource({
    allowEnvFallback: caps.allowSharedTokenFallback,
    session,
  });

  try {
    const pullsRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls?state=open&per_page=${caps.maxOpenPRsPerRepo}`,
      { headers: ghHeaders(token) }
    );

    if (!pullsRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch PRs", githubStatus: pullsRes.status },
        { status: pullsRes.status }
      );
    }

    type RawPR = {
      id: number;
      number: number;
      title: string;
      body: string | null;
      url: string;
      user: { login: string; avatar_url: string; url: string };
    };

    type PRDetails = {
      additions?: number;
      deletions?: number;
      changed_files?: number;
    };

    type GitHubUserProfile = {
      public_repos?: number;
    };

    const pulls: RawPR[] = await pullsRes.json();
    const githubApiPrefix = "https://api.github.com/";

    const enriched = await Promise.all(
      pulls.map(async (pull) => {
        if (!pull.url.startsWith(githubApiPrefix) || !pull.user.url.startsWith(githubApiPrefix)) {
          return null;
        }

        const [detailRes, filesRes, userRes] = await Promise.all([
          fetch(pull.url, { headers: ghHeaders(token) }),
          fetch(`${pull.url}/files?per_page=50`, { headers: ghHeaders(token) }),
          fetch(pull.user.url, { headers: ghHeaders(token) }),
        ]);

        const [details, filesData, userData] = await Promise.all([
          detailRes.ok
            ? (detailRes.json() as Promise<PRDetails>)
            : Promise.resolve({} as PRDetails),
          filesRes.ok ? filesRes.json() : Promise.resolve([]),
          userRes.ok
            ? (userRes.json() as Promise<GitHubUserProfile>)
            : Promise.resolve({} as GitHubUserProfile),
        ]);

        const fileNames: string[] = Array.isArray(filesData)
          ? filesData
              .map((f: { filename?: string }) => f.filename)
              .filter((f): f is string => Boolean(f))
          : [];

        const additions = details.additions ?? 0;
        const deletions = details.deletions ?? 0;
        const changedFiles = details.changed_files ?? 0;

        const sizeRisk = Math.min(40, (additions + deletions) / 50);
        const fileRisk = Math.min(30, changedFiles * 2);
        const contributorRisk = (userData.public_repos ?? 0) < 5 ? 20 : 5;
        const depRisk = fileNames.some((f) =>
          /package\.json|go\.mod|requirements\.txt|Cargo\.toml|pom\.xml|Gemfile/i.test(f)
        )
          ? 10
          : 0;

        const riskScore = Math.round(Math.min(100, sizeRisk + fileRisk + contributorRisk + depRisk));

        return {
          id: pull.id,
          number: pull.number,
          title: pull.title,
          body: pull.body ?? "",
          user: pull.user.login,
          avatar: pull.user.avatar_url,
          additions,
          deletions,
          changedFiles,
          fileNames,
          userRepos: userData.public_repos ?? 0,
          riskScore,
          riskLevel:
            riskScore > 80 ? "CRITICAL" : riskScore > 60 ? "HIGH" : riskScore > 35 ? "MODERATE" : "STABLE",
        };
      })
    );

    const validPRs = enriched.filter(Boolean) as NonNullable<(typeof enriched)[0]>[];

    const summaries: PRSummary[] = validPRs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body,
      user: pr.user,
      userRepos: pr.userRepos,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changedFiles,
      fileNames: pr.fileNames,
      riskScore: pr.riskScore,
    }));

    const analysisMap = await analyzePRBatch(summaries, { plan });

    const items = validPRs.map((pr) => {
      const ai = analysisMap.get(pr.number);
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        user: pr.user,
        avatar: pr.avatar,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changedFiles,
        riskScore: pr.riskScore,
        riskLevel: pr.riskLevel as "CRITICAL" | "HIGH" | "MODERATE" | "STABLE",
        headline: ai?.headline ?? "",
        analysis: ai?.analysis ?? "",
        flags: ai?.flags ?? [],
        hotFiles: ai?.hotFiles ?? [],
      };
    });

    const aiMode: "heuristic" | "single-pass" | "multi-agent" = !hasAIProvider()
      ? "heuristic"
      : caps.aiAgentDepth >= 2
      ? "multi-agent"
      : "single-pass";

    const estimatedGithubCalls = 1 + validPRs.length * 3;

    return NextResponse.json({
      items,
      meta: {
        plan,
        aiMode,
        tokenSource,
        prLimit: caps.maxOpenPRsPerRepo,
        rateRemaining: aiBudget.remaining,
        githubCalls: estimatedGithubCalls,
      },
    });
  } catch (error) {
    // Log error only in development
    if (process.env.NODE_ENV !== "production") {
      console.error("PR Risk API Error:", error);
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
