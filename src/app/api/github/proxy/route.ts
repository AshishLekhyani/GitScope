import { NextRequest, NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGitHubTokenWithSource } from "@/lib/github-auth";

/**
 * Generic GitHub API proxy.
 * Usage: GET /api/github/proxy?path=repos/owner/repo
 * Forwards the request to the GitHub API with auth token if available.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  // Prevent SSRF — only allow github.com API paths
  if (path.startsWith("http") || path.includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const { token: userToken } = await getGitHubTokenWithSource({
      allowEnvFallback: false,
    });

    const apiPath = path.startsWith("/") ? path : `/${path}`;
    const { data } = await githubFetch<unknown>(apiPath, {
      userToken,
      allowEnvFallback: false,
    });

    return NextResponse.json(data);
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message },
      { status: err.status ?? 500 }
    );
  }
}
