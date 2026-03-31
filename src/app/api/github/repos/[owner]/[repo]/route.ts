import { NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGitHubToken } from "@/lib/github-auth";

type Params = { owner: string; repo: string };

export async function GET(
  _req: Request,
  context: { params: Promise<Params> }
) {
  const { owner, repo } = await context.params;
  try {
    const userToken = await getGitHubToken();
    const { data, rateLimitRemaining } = await githubFetch<
      Record<string, unknown>
    >(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { userToken }
    );
    return NextResponse.json({ ...data, rateLimitRemaining }, { status: 200 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message },
      { status: err.status ?? 500 }
    );
  }
}
