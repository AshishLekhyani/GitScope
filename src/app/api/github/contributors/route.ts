export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = req.nextUrl.searchParams.get("repo");
  if (!repo || !repo.includes("/")) {
    return NextResponse.json({ error: "repo param required (owner/name)" }, { status: 400 });
  }

  const token = await getGitHubToken({ session, allowEnvFallback: true });
  if (!token) {
    return NextResponse.json({ noToken: true, error: "Connect GitHub to view contributor data" }, { status: 200 });
  }
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${token}` };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    // Fetch detailed stats (top 100 contributors with weekly breakdown)
    const statsRes = await fetch(`https://api.github.com/repos/${repo}/stats/contributors?per_page=100`, {
      headers,
      next: { revalidate: 0 },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (statsRes.status === 202) {
      // GitHub is computing — tell the client to retry
      return NextResponse.json({ computing: true }, { status: 202 });
    }
    if (statsRes.status === 404 || statsRes.status === 403) {
      return NextResponse.json({ error: "Repo not found or access denied" }, { status: statsRes.status });
    }
    if (!statsRes.ok) {
      return NextResponse.json({ error: "GitHub API error" }, { status: 502 });
    }

    const statsData = (await statsRes.json()) as Array<{
      author?: { login: string; avatar_url: string };
      total: number;
      weeks: Array<{ w: number; a: number; d: number; c: number }>;
    }>;

    // If we got 100, there might be more - fetch additional contributors via paginated endpoint
    let allContributors = [...statsData];
    if (statsData.length >= 100) {
      const extraContributors = await fetchAllContributors(repo, headers, statsData);
      // Merge: statsData has detailed weeks, extraContributors has commit counts only
      // Create entries for extra contributors without weekly breakdown
      const existingLogins = new Set(statsData.map((s) => s.author?.login).filter(Boolean));
      for (const extra of extraContributors) {
        if (!existingLogins.has(extra.login)) {
          allContributors.push({
            author: { login: extra.login, avatar_url: extra.avatar_url },
            total: extra.contributions,
            weeks: [], // No weekly data available from this endpoint
          });
        }
      }
    }

    return NextResponse.json(allContributors);
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "GitHub API timeout — try again shortly" }, { status: 504 });
    }
    return NextResponse.json({ error: "Failed to reach GitHub" }, { status: 502 });
  }
}

/** Fetch all contributors via paginated /contributors endpoint (no weekly stats, just commit counts) */
async function fetchAllContributors(
  repo: string,
  headers: Record<string, string>,
  statsData: Array<{ author?: { login: string } }>,
  maxPages = 5
): Promise<Array<{ login: string; avatar_url: string; contributions: number }>> {
  const existingLogins = new Set(statsData.map((s) => s.author?.login).filter(Boolean));
  const allContributors: Array<{ login: string; avatar_url: string; contributions: number }> = [];

  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contributors?per_page=100&page=${page}&anon=false`,
      { headers, next: { revalidate: 0 } }
    );
    if (!res.ok) break;

    const data = (await res.json()) as Array<{ login: string; avatar_url: string; contributions: number }>;
    if (!Array.isArray(data) || data.length === 0) break;

    // Add contributors not already in statsData
    for (const c of data) {
      if (!existingLogins.has(c.login)) {
        allContributors.push(c);
      }
    }

    // Stop if we got less than 100 (last page)
    if (data.length < 100) break;
  }

  return allContributors;
}

export const GET = withRouteSecurity(handler, SecurityPresets.standard);
