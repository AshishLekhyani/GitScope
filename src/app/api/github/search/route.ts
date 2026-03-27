import { NextRequest, NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGitHubToken } from "@/lib/github-auth";

type GithubRepoItem = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  default_branch: string;
  language: string | null;
  owner: {
    login: string;
    avatar_url: string;
    html_url: string;
  };
  html_url: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
};

type GithubUserItem = {
  login: string;
  avatar_url: string;
  type: string;
  html_url: string;
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing q" }, { status: 400 });
  }

  try {
    const userToken = await getGitHubToken();
    const query = q.startsWith("@") ? q.slice(1) : q;
    const encoded = encodeURIComponent(query);

    const extraHeaders = userToken ? { Authorization: `Bearer ${userToken}` } : undefined;

    // Parallel search for Repos and Users
    const [reposRes, usersRes] = await Promise.all([
      githubFetch<{ total_count: number; items: GithubRepoItem[] }>(
        `/search/repositories?q=${encoded}&per_page=10`,
        { headers: extraHeaders }
      ),
      githubFetch<{ items: GithubUserItem[] }>(
        `/search/users?q=${encoded}&per_page=5`,
        { headers: extraHeaders }
      ),
    ]);

    return NextResponse.json({
      // TopNav-friendly simplified format
      repos: reposRes.data.items.map((repo) => ({
        owner: repo.owner.login,
        repo: repo.name,
        stars:
          repo.stargazers_count > 1000
            ? `${(repo.stargazers_count / 1000).toFixed(1)}k`
            : repo.stargazers_count,
        desc: repo.description,
        avatar: repo.owner.avatar_url,
      })),
      users: usersRes.data.items.map((user) => ({
        name: user.login,
        avatar: user.avatar_url,
        type: user.type,
        html_url: user.html_url,
      })),
      // SearchRepositoriesResponse-compatible format for repo-search.tsx
      total_count: reposRes.data.total_count,
      items: reposRes.data.items,
      rateLimitRemaining: reposRes.rateLimitRemaining,
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message },
      { status: err.status ?? 500 }
    );
  }
}
// GitHub search API route
