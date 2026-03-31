import { getGitHubToken } from "@/lib/github-auth";
import { getGithubHeaders } from "@/lib/github";
import { NextResponse } from "next/server";

export async function GET() {
  const userToken = await getGitHubToken();

  try {
    const res = await fetch("https://api.github.com/rate_limit", {
      headers: getGithubHeaders(userToken),
      next: { revalidate: 0 }, // No cache for rate limit
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch from GitHub" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({
      limit: data.rate.limit,
      remaining: data.rate.remaining,
      reset: data.rate.reset
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
