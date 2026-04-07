import { NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGitHubToken } from "@/lib/github-auth";
import { requireApiAuth } from "@/lib/api-auth";

type Params = { owner: string; repo: string };

export async function GET(
  _req: Request,
  context: { params: Promise<Params> }
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const { owner, repo } = await context.params;
  try {
    const userToken = await getGitHubToken();
    const { data, rateLimitRemaining } = await githubFetch<Record<string, number>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`,
      { userToken }
    );
    return NextResponse.json({ data, rateLimitRemaining }, { status: 200 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message },
      { status: err.status ?? 500 }
    );
  }
}
