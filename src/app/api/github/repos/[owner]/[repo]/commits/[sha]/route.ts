import { NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGitHubToken } from "@/lib/github-auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ owner: string; repo: string; sha: string }> }
) {
  const { owner, repo, sha } = await params;
  try {
    const userToken = await getGitHubToken();
    
    // Fetch commit details with file changes
    const { data } = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`,
      { userToken }
    );
    
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    const err = e as Error & { status?: number };
    console.error("Commit detail fetch error:", err.message);
    return NextResponse.json(
      { error: err.message },
      { status: err.status ?? 500 }
    );
  }
}
