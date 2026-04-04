import { NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGitHubToken } from "@/lib/github-auth";

/** Proxy for "trending" via search with time-based filtering. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get("time") || "today";
    
    const userToken = await getGitHubToken();
    
    // Build date-based query with appropriate star threshold for the time period
    // Shorter periods need lower star thresholds to get meaningful results
    const now = new Date();
    let query = "";
    
    if (timeRange === "today") {
      // For today: repos pushed in last 24h with >10 stars (more lenient)
      const dateStr = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      query = `pushed:>${dateStr}+stars:>10`;
    } else if (timeRange === "week") {
      // For week: repos pushed in last 7 days with >50 stars
      const dateStr = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      query = `pushed:>${dateStr}+stars:>50`;
    } else if (timeRange === "month") {
      // For month: repos pushed in last 30 days with >100 stars
      const dateStr = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      query = `pushed:>${dateStr}+stars:>100`;
    }
    
    const { data, rateLimitRemaining } = await githubFetch<{
      items: unknown[];
      total_count: number;
    }>(`/search/repositories?q=${query}&sort=stars&order=desc&per_page=30`, {
      userToken,
    });
    
    return NextResponse.json({ ...data, rateLimitRemaining }, { status: 200 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message },
      { status: err.status ?? 500 }
    );
  }
}
