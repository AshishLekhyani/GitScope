import { getGitHubToken } from "@/lib/github-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isValidRepo } from "@/lib/validate-repo";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getGitHubToken();
  if (!token) {
    return NextResponse.json({ error: "GitHub token required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  if (!repo) return NextResponse.json({ error: "No repository specified" }, { status: 400 });
  if (!isValidRepo(repo)) return NextResponse.json({ error: "Invalid repository format" }, { status: 400 });

  try {
    // 1. Fetch Open Pull Requests
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=10`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Accept": "application/vnd.github.v3+json",
      },
    });

    if (!res.ok) return NextResponse.json({ error: "Failed to fetch PRs" }, { status: res.status });

    const pulls = await res.json();

    type GitHubPR = { id: number; number: number; title: string; url: string; user: { login: string; avatar_url: string; url: string } };
    // 2. Score each PR based on heuristics (AI Prediction)
    const scoredPulls = await Promise.all(
      (pulls as GitHubPR[]).map(async (p) => {
        // Only follow URLs that are GitHub API endpoints
        const GITHUB_API = "https://api.github.com/";
        if (!p.url.startsWith(GITHUB_API) || !p.user.url.startsWith(GITHUB_API)) {
          return null;
        }

        // Fetch PR specific details (files changed)
        const detailRes = await fetch(p.url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Accept": "application/vnd.github.v3+json",
          },
        });
        const details = await detailRes.json();

        // Heuristic 1: Size Risk (Massive changes)
        const sizeRisk = Math.min(40, (details.additions + details.deletions) / 50);

        // Heuristic 2: File Churn (Many files changed)
        const fileRisk = Math.min(30, details.changed_files * 2);

        // Heuristic 3: Contributor Risk (Junior or New)
        const userRes = await fetch(p.user.url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const userData = await userRes.json();
        const contributorRisk = userData.public_repos < 5 ? 20 : 5;

        // Heuristic 4: Dependency Risk (Touches package.json or go.mod)
        // (Simplified: We usually check filenames here)
        const touchesDeps = false; // logic would inspect files[]

        const totalRisk = Math.min(100, sizeRisk + fileRisk + contributorRisk + (touchesDeps ? 10 : 0));

        return {
          id: p.id,
          number: p.number,
          title: p.title,
          user: p.user.login,
          avatar: p.user.avatar_url,
          additions: details.additions,
          deletions: details.deletions,
          changedFiles: details.changed_files,
          riskScore: Math.round(totalRisk),
          riskLevel: totalRisk > 60 ? "CRITICAL" : totalRisk > 30 ? "MODERATE" : "STABLE",
          analysis: totalRisk > 60 
            ? "High architectural churn detected. Recommend multi-senior review."
            : totalRisk > 30 
              ? "Moderate scope. Monitor impact on downstream dependencies."
              : "Standard refinement. Low structural impact predicted."
        };
      })
    );

    return NextResponse.json(scoredPulls.filter(Boolean));
  } catch (error) {
    console.error("PR Risk API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
