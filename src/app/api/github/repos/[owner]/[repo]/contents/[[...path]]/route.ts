import { NextRequest, NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGitHubToken } from "@/lib/github-auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string; path?: string[] }> }
) {
  const p = await params;
  try {
    const userToken = await getGitHubToken();
    const gitPath = p.path ? p.path.map((segment) => encodeURIComponent(segment)).join("/") : "";
    const endpoint = `/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(
      p.repo
    )}/contents${gitPath ? `/${gitPath}` : ""}`;

    const { data } = await githubFetch<unknown>(endpoint, { userToken });
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message },
      { status: err.status ?? 500 }
    );
  }
}
