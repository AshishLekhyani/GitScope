export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubTokenWithSource } from "@/lib/github-auth";

export interface MyRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
    avatar_url: string;
    type: "User" | "Organization";
  };
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  size: number;
  default_branch: string;
  pushed_at: string;
  created_at: string;
  updated_at: string;
  topics: string[];
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  visibility: "public" | "private" | "internal";
  license: { spdx_id: string; name: string } | null;
  permissions?: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
  // Derived fields
  isOwned: boolean;
  isContributor: boolean;
  accessLevel: "admin" | "write" | "read" | "none";
}

async function fetchAllPages<T>(
  baseUrl: string,
  token: string | null,
  maxPages = 5
): Promise<{ data: T[]; status: number }> {
  const results: T[] = [];
  let url: string | null = baseUrl;
  let page = 0;
  let firstStatus = 200;

  while (url && page < maxPages) {
    page++;
    try {
      const res: Response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: "no-store", // never cache — response varies per Authorization header
      });
      if (page === 1) firstStatus = res.status;
      if (!res.ok) break;
      const data = (await res.json()) as T[];
      results.push(...data);

      // Parse Link header for next page
      const link: string | null = res.headers.get("link");
      const nextMatch: RegExpMatchArray | null = link?.match(/<([^>]+)>;\s*rel="next"/) ?? null;
      url = nextMatch ? nextMatch[1] : null;
    } catch {
      break;
    }
  }

  return { data: results, status: firstStatus };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { token, source } = await getGitHubTokenWithSource({ session });

  if (!token) {
    return NextResponse.json({
      repos: [],
      meta: {
        total: 0,
        source: "none",
        message: "Connect your GitHub account in Settings to see your repositories.",
      },
    });
  }

  const url = req.nextUrl;
  const type = url.searchParams.get("type") ?? "all"; // all | owner | member
  const sort = url.searchParams.get("sort") ?? "updated"; // updated | created | pushed | full_name
  const visibility = url.searchParams.get("visibility") ?? "all"; // all | public | private

  try {
    // Fetch the authenticated user's GitHub login (username) and all repos in parallel
    const authHeaders = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
    };

    // Fetch user identity — no caching so we always get fresh x-oauth-scopes header
    const githubUserRes = await fetch("https://api.github.com/user", { headers: authHeaders, cache: "no-store" });

    // Determine GitHub login: prefer API response, fall back to session name
    let githubLogin: string = session.user?.name ?? "";
    let grantedScopes = "";
    if (githubUserRes.ok) {
      const ghUser = (await githubUserRes.json()) as { login: string };
      githubLogin = ghUser.login;
      grantedScopes = githubUserRes.headers.get("x-oauth-scopes") ?? "";
    }
    const hasRepoScope = grantedScopes.split(",").map((s) => s.trim()).some((s) => s === "repo" || s === "public_repo");

    // GitHub API: `type` and `visibility` are mutually exclusive — sending both causes a 422.
    // Strategy: when we have repo scope, use visibility param (more expressive). When we don't,
    // use type param only (which limits to public repos without erroring).
    const repoListUrl = hasRepoScope
      ? `https://api.github.com/user/repos?visibility=${visibility}&sort=${sort}&per_page=100`
      : `https://api.github.com/user/repos?type=${type}&sort=${sort}&per_page=100`;

    const firstFetch = await fetchAllPages<MyRepo>(repoListUrl, token);

    let rawRepos = firstFetch.data;
    const scopeLimited = !hasRepoScope;

    if (rawRepos.length === 0 && firstFetch.status !== 200) {
      // Non-200 (expired/revoked token, 422, etc.) — log status and return empty gracefully
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[my-repos] GitHub API returned status ${firstFetch.status}`);
      }
      rawRepos = [];
    } else if (rawRepos.length === 0 && hasRepoScope) {
      // Got 200 but empty — retry without any filter (GitHub default: all accessible repos)
      const retryFetch = await fetchAllPages<MyRepo>(
        `https://api.github.com/user/repos?sort=${sort}&per_page=100`,
        token
      );
      rawRepos = retryFetch.data;
    }

    const repos: MyRepo[] = rawRepos.map((r) => {
      const perms = r.permissions;
      const accessLevel: MyRepo["accessLevel"] =
        perms?.admin ? "admin" :
        perms?.push ? "write" :
        perms?.pull ? "read" : "none";

      return {
        ...r,
        isOwned: r.owner.login === githubLogin,
        isContributor: !!(perms?.push || perms?.maintain) && r.owner.type === "User",
        accessLevel,
      };
    });

    // Sort: owned first, then by pushed_at
    repos.sort((a, b) => {
      if (a.isOwned && !b.isOwned) return -1;
      if (!a.isOwned && b.isOwned) return 1;
      return new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime();
    });

    return NextResponse.json(
      {
        repos,
        meta: {
          total: repos.length,
          private: repos.filter((r) => r.private).length,
          public: repos.filter((r) => !r.private).length,
          owned: repos.filter((r) => r.isOwned).length,
          source,
          githubUser: githubLogin,
          scopeLimited,
          grantedScopes: process.env.NODE_ENV !== "production" ? grantedScopes : undefined,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[my-repos]", err);
    }
    return NextResponse.json({ error: "Failed to fetch repositories" }, { status: 500 });
  }
}
