export interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: "dir" | "file" | "symlink" | "submodule";
  content?: string;
  encoding?: string;
}

import type {
  CommitActivityWeek,
  GitHubContributor,
  GitHubRepo,
  SearchRepositoriesResponse,
} from "@/types/github";

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return JSON.parse(text) as T;
}

export async function searchRepositories(
  q: string
): Promise<SearchRepositoriesResponse> {
  const res = await fetch(
    `/api/github/search?q=${encodeURIComponent(q)}`,
    { method: "GET", cache: "no-store" }
  );
  return parseJson<SearchRepositoriesResponse>(res);
}

export async function getRepoDetails(
  owner: string,
  repo: string
): Promise<GitHubRepo & { rateLimitRemaining?: string }> {
  const res = await fetch(
    `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { method: "GET", cache: "no-store" }
  );
  return parseJson(res);
}

export async function getContributors(
  owner: string,
  repo: string
): Promise<{ data: GitHubContributor[]; rateLimitRemaining?: string }> {
  const res = await fetch(
    `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors`,
    { method: "GET", cache: "no-store" }
  );
  return parseJson(res);
}

export async function getLanguages(
  owner: string,
  repo: string
): Promise<{ data: Record<string, number>; rateLimitRemaining?: string }> {
  const res = await fetch(
    `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`,
    { method: "GET", cache: "no-store" }
  );
  return parseJson(res);
}

export async function getCommitActivity(
  owner: string,
  repo: string
): Promise<{ data: CommitActivityWeek[]; rateLimitRemaining?: string }> {
  const res = await fetch(
    `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/commit_activity`,
    { method: "GET", cache: "no-store" }
  );
  return parseJson(res);
}

export interface GitHubPull {
  id: number;
  state: string;
  merged_at: string | null;
  created_at: string;
  closed_at: string | null;
  user: { login: string } | null;
}

export async function getPullRequests(
  owner: string,
  repo: string
): Promise<{ data: GitHubPull[]; rateLimitRemaining?: string }> {
  const res = await fetch(
    `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    { method: "GET", cache: "no-store" }
  );
  return parseJson(res);
}

export async function getTrendingRepos(): Promise<SearchRepositoriesResponse> {
  const res = await fetch("/api/github/trending", { method: "GET", cache: "no-store" });
  return parseJson<SearchRepositoriesResponse>(res);
}

export async function getRepoContents(
  owner: string,
  repo: string,
  path: string = ""
): Promise<GitHubFile | GitHubFile[]> {
  const p = path ? `/${encodeURIComponent(path)}` : "";
  const res = await fetch(`/api/github/repos/${owner}/${repo}/contents${p}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<GitHubFile | GitHubFile[]>(res);
}
