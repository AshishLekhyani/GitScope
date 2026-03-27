export interface GitHubRepo {
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
}

export interface GitHubContributor {
  login: string;
  id: number;
  avatar_url: string;
  contributions: number;
  html_url: string;
}

export interface SearchRepositoriesResponse {
  total_count: number;
  items: GitHubRepo[];
  rateLimitRemaining?: string;
}

export interface RepoWithRateLimit extends GitHubRepo {
  rateLimitRemaining?: string;
}

/** Weekly buckets from GET /repos/{owner}/{repo}/stats/commit_activity */
export interface CommitActivityWeek {
  days: number[];
  total: number;
  week: number;
}
