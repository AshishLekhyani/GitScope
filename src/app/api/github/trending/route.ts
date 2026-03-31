import { NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGitHubToken } from "@/lib/github-auth";

/** Proxy for "trending" via search sorted by stars. */
export async function GET() {
  try {
    const userToken = await getGitHubToken();
    const { data, rateLimitRemaining } = await githubFetch<{
      items: unknown[];
      total_count: number;
    }>("/search/repositories?q=stars:>1000&sort=stars&order=desc&per_page=12", {
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
