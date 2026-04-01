export const ROUTES = {
  home: "/",
  overview: "/overview",
  search: "/search",
  dashboard: (owner: string, repo: string) => `/dashboard/${owner}/${repo}`,
  analytics: (owner: string, repo: string) =>
    `/dashboard/${owner}/${repo}/analytics`,
  contributors: (owner: string, repo: string) =>
    `/dashboard/${owner}/${repo}/contributors`,
  code: (owner: string, repo: string) => `/dashboard/${owner}/${repo}/code`,
  commits: (owner: string, repo: string) => `/dashboard/${owner}/${repo}/commits`,
  source: (owner: string, repo: string, path?: string) =>
    `/dashboard/${owner}/${repo}/source${path ? '/' + path : ''}`,
  compare: "/compare",
  trending: "/trending",
  settings: "/settings",
  docs: "/docs",
  pricing: "/pricing",
  activity: "/activity",
  organizations: "/organizations",
  features: "/features",
  changelog: "/changelog",
  login: "/login",
  signup: "/login?mode=signup",
  // New dashboard pages
  notifications: "/notifications",
  bookmarks: "/bookmarks",
  releases: "/releases",
  leaderboard: "/leaderboard",
  languages: "/languages",
  topics: "/topics",
  // Feature Detail Pages
  feature: (slug: string) => `/features/${slug}`,
  // Legal & Resources
  privacy: "/privacy",
  terms: "/terms",
  security: "/security",
  status: "/status",
  api: "/api-reference",
  blog: "/blog",
} as const;

// ROUTES constants v1
