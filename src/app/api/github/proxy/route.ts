import { NextRequest, NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

/**
 * Generic GitHub API proxy.
 * Usage: GET /api/github/proxy?path=repos/owner/repo
 * Forwards the request to the GitHub API with auth token if available.
 */
async function getHandler(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  // Keep this public proxy narrow: repo endpoints only. Other GitHub data has
  // dedicated API routes with their own auth/rate-limit behavior.
  const apiPath = path.startsWith("/") ? path : `/${path}`;
  // Strip query string for path validation
  const pathWithoutQuery = apiPath.split("?")[0];
  if (path.startsWith("http") || path.includes("..") || !/^\/repos\/[\w.-]+\/[\w.-]+/.test(pathWithoutQuery)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const { token: userToken } = await getGitHubTokenWithSource({
      allowEnvFallback: false,
    });

    const { data } = await githubFetch<unknown>(apiPath, {
      userToken,
      allowEnvFallback: false,
    });

    return NextResponse.json(data);
  } catch (e) {
    const err = e as Error & { status?: number };
    // Log full details server-side; send only a generic message to the client
    // to prevent leaking GitHub token status, internal paths, or API internals.
    if (process.env.NODE_ENV !== "production") console.error("[github/proxy]", err.message);
    return NextResponse.json(
      { error: "Unable to fetch from GitHub" },
      { status: err.status ?? 500 }
    );
  }
}

// Apply security middleware - GET is read-only but rate limited to prevent abuse
export const GET = withRouteSecurity(getHandler, { ...SecurityPresets.public, csrf: false });
