import { getGitHubToken } from "@/lib/github-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sanitizeRepoList } from "@/lib/validate-repo";
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
  const reposParam = searchParams.get("repos");
  if (!reposParam) return NextResponse.json({ error: "No repositories specified" }, { status: 400 });

  const repoList = sanitizeRepoList(reposParam);
  if (!repoList) return NextResponse.json({ error: "Invalid repository format" }, { status: 400 });

  try {
    const metricsMap = await Promise.all(
      repoList.map(async (fullName) => {
        try {
          // Fetch last 30 closed pull requests
          const res = await fetch(`https://api.github.com/repos/${fullName}/pulls?state=closed&per_page=30`, {
            headers: {
              Authorization: `Bearer ${token}`,
              "Accept": "application/vnd.github.v3+json",
            },
          });

          if (!res.ok) return { name: fullName, metrics: null };

          const pulls: { number: number; merged_at: string | null; created_at: string }[] = await res.json();
          const mergedPulls = pulls.filter((p) => p.merged_at);

          // 2. Fetch contributor diversity for Bus Factor
          const commRes = await fetch(`https://api.github.com/repos/${fullName}/commits?per_page=50`, {
            headers: {
              Authorization: `Bearer ${token}`,
              "Accept": "application/vnd.github.v3+json",
            },
          });
          const commits: { author?: { login?: string } }[] = await commRes.json();
          const contributors = new Set(commits.map((c) => c.author?.login).filter(Boolean));
          const busFactor = contributors.size;

          if (mergedPulls.length === 0) return { name: fullName, metrics: { leadTime: 0, cycleTime: 0, freq: 0, busFactor } };

          // Cycle time = PR open → merge (real data)
          const totalCycleMs = mergedPulls.reduce((acc: number, p) => {
            return acc + (new Date(p.merged_at!).getTime() - new Date(p.created_at).getTime());
          }, 0);
          const cycleTime = totalCycleMs / mergedPulls.length / (1000 * 60 * 60); // hours

          // Lead time = first commit → merge (sample 5 PRs to limit API calls)
          let totalLeadMs = 0;
          let leadSamples = 0;
          const samplePRs = mergedPulls.slice(0, 5);
          for (const pr of samplePRs) {
            try {
              const prCommitsRes = await fetch(
                `https://api.github.com/repos/${fullName}/pulls/${pr.number}/commits?per_page=100`,
                { headers: { Authorization: `Bearer ${token}`, "Accept": "application/vnd.github.v3+json" } }
              );
              if (prCommitsRes.ok) {
                const prCommits: { commit: { committer: { date: string } } }[] = await prCommitsRes.json();
                if (prCommits.length > 0) {
                  const earliest = prCommits.reduce((min, c) => {
                    const d = c.commit.committer.date;
                    return d < min ? d : min;
                  }, prCommits[0].commit.committer.date);
                  totalLeadMs += new Date(pr.merged_at!).getTime() - new Date(earliest).getTime();
                  leadSamples++;
                }
              }
            } catch { /* skip */ }
          }
          const leadTime = leadSamples > 0
            ? totalLeadMs / leadSamples / (1000 * 60 * 60)
            : cycleTime * 1.4; // fallback if commits unavailable

          const freq = mergedPulls.length / 30; // Merges per day (rough estimate)

          return {
            name: fullName,
            metrics: {
              leadTime: Math.round(leadTime * 10) / 10,
              cycleTime: Math.round(cycleTime * 10) / 10,
              freq: Math.round(freq * 10) / 10,
              count: mergedPulls.length,
              busFactor
            }
          };
        } catch {
          return { name: fullName, metrics: null };
        }
      })
    );

    return NextResponse.json(metricsMap);
  } catch (error) {
    console.error("DORA Metrics Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
