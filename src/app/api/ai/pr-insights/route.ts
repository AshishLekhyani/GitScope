export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/ai/pr-insights?repo=owner/name
 *
 * Returns engineering insight data:
 *  - openPRs with complexity scores, risk levels, and review wait times
 *  - workDistribution: commit/PR counts per contributor over last 90 days
 *  - cycleTime: median time from PR open to merge over last 30 PRs
 *  - reviewerLoad: how many open PRs each reviewer is requested on
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubTokenWithSource } from "@/lib/github-auth";

interface GHPRItem {
  number: number;
  title: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  closed_at?: string | null;
  state: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changed_files: number;
  requested_reviewers: Array<{ login: string }>;
  labels: Array<{ name: string; color: string }>;
  html_url: string;
  base: { ref: string };
  head: { ref: string };
  _links?: { commits?: { href: string }; comments?: { href: string }; review_comments?: { href: string } };
}

interface GHCommit {
  commit: { author: { name: string; date: string }; message: string };
  author?: { login: string } | null;
  sha: string;
}

async function ghFetch<T>(url: string, token: string): Promise<T> {
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    next: { revalidate: 300 },
  });
  if (!resp.ok) throw new Error(`GitHub API ${url}: ${resp.status} ${resp.statusText}`);
  return resp.json() as Promise<T>;
}

function prComplexityScore(pr: GHPRItem): { score: number; risk: "low" | "medium" | "high" | "critical"; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  // Lines changed
  const totalLines = pr.additions + pr.deletions;
  if (totalLines > 1000) { score += 40; factors.push(`${totalLines} lines changed`); }
  else if (totalLines > 400) { score += 25; factors.push(`${totalLines} lines changed`); }
  else if (totalLines > 100) { score += 10; }

  // Files changed
  if (pr.changed_files > 30) { score += 30; factors.push(`${pr.changed_files} files touched`); }
  else if (pr.changed_files > 15) { score += 18; factors.push(`${pr.changed_files} files touched`); }
  else if (pr.changed_files > 5) { score += 8; }

  // Age (stale PRs are high risk)
  const ageDays = (Date.now() - new Date(pr.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > 14) { score += 20; factors.push(`${Math.round(ageDays)}d old (stale)`); }
  else if (ageDays > 7) { score += 10; factors.push(`${Math.round(ageDays)}d old`); }

  // Draft
  if (pr.draft) { score -= 10; }

  // No reviewers assigned
  if (pr.requested_reviewers.length === 0) { score += 10; factors.push("no reviewer assigned"); }

  // High-risk labels
  const riskyLabels = pr.labels.filter((l) => /security|breaking|urgent|critical|hotfix/i.test(l.name));
  if (riskyLabels.length > 0) { score += 25; factors.push(`labels: ${riskyLabels.map((l) => l.name).join(", ")}`); }

  const clamped = Math.min(100, Math.max(0, score));
  const risk = clamped >= 70 ? "critical" : clamped >= 45 ? "high" : clamped >= 20 ? "medium" : "low";
  return { score: clamped, risk, factors };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repo = req.nextUrl.searchParams.get("repo");
  if (!repo || !repo.includes("/")) {
    return NextResponse.json({ error: "repo param required (owner/name)" }, { status: 400 });
  }

  const { token: ghToken } = await getGitHubTokenWithSource({ session });
  if (!ghToken) {
    return NextResponse.json({ error: "GitHub token required for PR insights" }, { status: 403 });
  }

  try {
    // Fetch open PRs (up to 30) + last 30 merged PRs in parallel
    const [openPRsRaw, mergedPRsRaw] = await Promise.all([
      ghFetch<GHPRItem[]>(
        `https://api.github.com/repos/${repo}/pulls?state=open&per_page=30&sort=updated&direction=desc`,
        ghToken
      ),
      ghFetch<GHPRItem[]>(
        `https://api.github.com/repos/${repo}/pulls?state=closed&per_page=30&sort=updated&direction=desc`,
        ghToken
      ),
    ]);

    // Fetch detailed stats for open PRs (additions/deletions/changed_files are not in list endpoint)
    const openPRsDetailed = await Promise.all(
      openPRsRaw.slice(0, 15).map((pr) =>
        ghFetch<GHPRItem>(`https://api.github.com/repos/${repo}/pulls/${pr.number}`, ghToken).catch(() => pr)
      )
    );

    // Score and enrich open PRs
    const openPRs = openPRsDetailed.map((pr) => {
      const { score, risk, factors } = prComplexityScore(pr);
      const waitDays = parseFloat(
        ((Date.now() - new Date(pr.created_at).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1)
      );
      return {
        number: pr.number,
        title: pr.title,
        author: pr.user.login,
        url: pr.html_url,
        base: pr.base.ref,
        head: pr.head.ref,
        draft: pr.draft,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        waitDays,
        reviewers: pr.requested_reviewers.map((r) => r.login),
        labels: pr.labels.map((l) => ({ name: l.name, color: l.color })),
        complexityScore: score,
        risk,
        complexityFactors: factors,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
      };
    });

    // Cycle time: time from PR open → merge for merged PRs
    const mergedPRs = mergedPRsRaw.filter((pr) => pr.merged_at);
    const cycleTimes = mergedPRs.map((pr) => {
      const openMs = new Date(pr.merged_at!).getTime() - new Date(pr.created_at).getTime();
      return openMs / (1000 * 60 * 60); // hours
    });
    const medianCycleHours =
      cycleTimes.length > 0
        ? cycleTimes.sort((a, b) => a - b)[Math.floor(cycleTimes.length / 2)]
        : null;
    const avgCycleHours =
      cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : null;

    // Work distribution: commits by author in last 90 days
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const commitsRaw = await ghFetch<GHCommit[]>(
      `https://api.github.com/repos/${repo}/commits?since=${since}&per_page=100`,
      ghToken
    ).catch(() => [] as GHCommit[]);

    const authorMap: Record<string, { commits: number; linesEst: number; lastCommit: string }> = {};
    for (const c of commitsRaw) {
      const login = c.author?.login ?? c.commit.author.name ?? "unknown";
      if (!authorMap[login]) authorMap[login] = { commits: 0, linesEst: 0, lastCommit: "" };
      authorMap[login].commits++;
      if (!authorMap[login].lastCommit || c.commit.author.date > authorMap[login].lastCommit) {
        authorMap[login].lastCommit = c.commit.author.date;
      }
    }

    // PR distribution per author
    const prAuthorMap: Record<string, number> = {};
    for (const pr of [...openPRsRaw, ...mergedPRsRaw]) {
      const login = pr.user.login;
      prAuthorMap[login] = (prAuthorMap[login] ?? 0) + 1;
    }

    const workDistribution = Object.entries(authorMap)
      .map(([login, stats]) => ({
        login,
        commits: stats.commits,
        prs: prAuthorMap[login] ?? 0,
        lastCommit: stats.lastCommit,
        share: 0, // filled below
      }))
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 15);

    const totalCommits = workDistribution.reduce((sum, a) => sum + a.commits, 0);
    for (const d of workDistribution) {
      d.share = totalCommits > 0 ? parseFloat(((d.commits / totalCommits) * 100).toFixed(1)) : 0;
    }

    // Reviewer load: how many open PRs each reviewer is assigned
    const reviewerLoad: Record<string, number> = {};
    for (const pr of openPRsRaw) {
      for (const r of pr.requested_reviewers) {
        reviewerLoad[r.login] = (reviewerLoad[r.login] ?? 0) + 1;
      }
    }
    const reviewerLoadList = Object.entries(reviewerLoad)
      .map(([login, count]) => ({ login, pendingReviews: count }))
      .sort((a, b) => b.pendingReviews - a.pendingReviews);

    // PR size distribution
    const sizeBuckets = { xs: 0, s: 0, m: 0, l: 0, xl: 0 };
    for (const pr of openPRsDetailed) {
      const t = pr.additions + pr.deletions;
      if (t <= 10) sizeBuckets.xs++;
      else if (t <= 50) sizeBuckets.s++;
      else if (t <= 250) sizeBuckets.m++;
      else if (t <= 1000) sizeBuckets.l++;
      else sizeBuckets.xl++;
    }

    return NextResponse.json({
      repo,
      generatedAt: new Date().toISOString(),
      openPRs,
      cycleTime: {
        medianHours: medianCycleHours,
        avgHours: avgCycleHours,
        sampleSize: mergedPRs.length,
        doraRating:
          medianCycleHours === null ? "unknown"
          : medianCycleHours < 24 ? "elite"
          : medianCycleHours < 72 ? "high"
          : medianCycleHours < 168 ? "medium"
          : "low",
      },
      workDistribution,
      reviewerLoad: reviewerLoadList,
      sizeBuckets,
      summary: {
        openCount: openPRsRaw.length,
        criticalCount: openPRs.filter((p) => p.risk === "critical").length,
        highRiskCount: openPRs.filter((p) => p.risk === "high").length,
        stalePRs: openPRs.filter((p) => p.waitDays > 7).length,
        noReviewerCount: openPRs.filter((p) => p.reviewers.length === 0).length,
        avgComplexity:
          openPRs.length > 0
            ? parseFloat((openPRs.reduce((s, p) => s + p.complexityScore, 0) / openPRs.length).toFixed(1))
            : 0,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
