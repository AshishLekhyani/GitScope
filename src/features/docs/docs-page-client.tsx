"use client";

import { MaterialIcon } from "@/components/material-icon";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

type Section =
  | "getting-started"
  | "authentication"
  | "repository-analysis"
  | "intelligence-hub"
  | "integrations"
  | "organization-analytics"
  | "activity-notifications"
  | "api-rate-limits"
  | "keyboard-shortcuts"
  | "troubleshooting"
  | "privacy-data"
  | "security-features";

const sections: { id: Section; label: string; icon: string }[] = [
  { id: "getting-started",        label: "Getting Started",            icon: "rocket_launch"    },
  { id: "authentication",         label: "Authentication & Accounts",  icon: "lock"             },
  { id: "repository-analysis",    label: "Repository Analysis",        icon: "source"           },
  { id: "intelligence-hub",       label: "Intelligence Hub",           icon: "psychology"       },
  { id: "integrations",           label: "Slack, Discord & Alerts",    icon: "notifications_active" },
  { id: "organization-analytics", label: "Organization Analytics",     icon: "corporate_fare"   },
  { id: "activity-notifications", label: "Activity & Notifications",   icon: "notifications"    },
  { id: "api-rate-limits",        label: "API & Rate Limits",          icon: "api"              },
  { id: "keyboard-shortcuts",     label: "Keyboard Shortcuts",         icon: "keyboard"         },
  { id: "troubleshooting",        label: "Troubleshooting",            icon: "build"            },
  { id: "privacy-data",           label: "Privacy & Data",             icon: "shield"           },
  { id: "security-features",      label: "Security Features",          icon: "security"         },
];

// ---------------------------------------------------------------------------
// Content definitions — each section has title, subtitle, blocks, and links.
// "blocks" is an array of typed content items for richer rendering.
// ---------------------------------------------------------------------------

type TextBlock    = { type: "paragraph"; text: string };
type BulletBlock  = { type: "bullets";   heading?: string; items: string[] };
type CodeBlock    = { type: "code";      label: string; code: string };
type TableBlock   = { type: "table";     heading?: string; headers: string[]; rows: string[][] };
type NoteBlock    = { type: "note";      text: string };

type ContentBlock = TextBlock | BulletBlock | CodeBlock | TableBlock | NoteBlock;

interface SectionContent {
  title: string;
  subtitle: string;
  blocks: ContentBlock[];
  links?: { label: string; href: string }[];
}

const content: Record<Section, SectionContent> = {
  // -------------------------------------------------------------------------
  "getting-started": {
    title:    "Getting Started with GitScope",
    subtitle: "Everything you need to go from zero to your first repository analysis in under five minutes.",
    blocks: [
      {
        type: "paragraph",
        text: "GitScope is a GitHub analytics dashboard that lets any engineer analyze public repositories in depth. No installation is required — open the app in your browser, create a free account (or continue as a guest), and immediately start exploring repositories, comparing projects side-by-side, and reading AI-generated health reports.",
      },
      {
        type: "bullets",
        heading: "What you can do on your first visit",
        items: [
          "Search any public GitHub repository by owner/name (e.g. vercel/next.js) and view its star history, contributor graph, language breakdown, and recent commits.",
          "Compare up to two repositories simultaneously using the Compare tool — see relative growth, language overlap, and contributor diversity at a glance.",
          "Browse trending repositories filtered by language, time window (daily / weekly / monthly), and star growth velocity.",
          "View organization-level analytics for any GitHub org — aggregate stars, top repos, language footprint, and contributor heatmaps.",
          "Access the Intelligence Hub for AI-powered velocity metrics, PR risk scores, dependency radar, and code health analysis (requires GitHub OAuth sign-in).",
        ],
      },
      {
        type: "paragraph",
        text: "Guest access is intentionally generous — you can read star histories, browse contributors, and explore trending repos without signing in. However, several features (the Intelligence Hub, saved preferences, Activity Log, and higher API rate limits) require an account. Signing in with GitHub OAuth unlocks the full feature set, including the Intelligence Hub and your personal GitHub activity feed.",
      },
      {
        type: "paragraph",
        text: "To get the most out of GitScope, connect a GitHub Personal Access Token (PAT) from your Settings page. A PAT raises your GitHub API quota from 60 requests per hour (unauthenticated) to 5,000 requests per hour, which is critical for heavy analysis sessions involving many repositories or large organizations. See the Authentication & Accounts section for step-by-step PAT setup instructions.",
      },
      {
        type: "bullets",
        heading: "Recommended first steps",
        items: [
          "Sign in with GitHub OAuth to unlock all features and connect your activity feed.",
          "Navigate to Settings > Account Security and add a GitHub Personal Access Token with the repo and read:user scopes.",
          "Search for a repository you care about (try your company's main repo or a popular open-source project) to get a feel for the analytics dashboard.",
          "Use the Command Palette (Ctrl+K / Cmd+K) to quickly jump between any view.",
          "Visit the Intelligence Hub to run a code health analysis on a repository of your choice.",
        ],
      },
      {
        type: "note",
        text: "GitScope only analyzes public repositories. Private repository analysis is not supported in any tier, and no read access to your private repos is ever requested or stored.",
      },
    ],
    links: [
      { label: "Sign In",           href: "/auth/signin"   },
      { label: "Browse Trending",   href: "/trending"      },
      { label: "Open Settings",     href: "/settings"      },
    ],
  },

  // -------------------------------------------------------------------------
  "authentication": {
    title:    "Authentication & Accounts",
    subtitle: "Sign-in options, GitHub token setup, and account security management.",
    blocks: [
      {
        type: "paragraph",
        text: "GitScope supports three authentication methods: email and password, Google OAuth, and GitHub OAuth. All three create a full GitScope account with saved preferences and access to your Activity Log. GitHub OAuth is the recommended method because it automatically provides the permissions needed for the Intelligence Hub and your personal event feed — no separate token configuration required for most features.",
      },
      {
        type: "bullets",
        heading: "Sign-in methods compared",
        items: [
          "Email / Password — Create an account with any email address. Password resets are handled via a secure email link. Works for all standard features. You will still need to add a GitHub PAT manually to raise API rate limits.",
          "Google OAuth — One-click sign-in via your Google account. Same feature set as email/password. Add a GitHub PAT in Settings if needed.",
          "GitHub OAuth (recommended) — Authenticates through GitHub and automatically grants GitScope access to your public profile and activity feed. Enables the Intelligence Hub without a separate PAT for most operations. This is the fastest path to full feature access.",
        ],
      },
      {
        type: "paragraph",
        text: "Regardless of how you sign in, you can always add a GitHub Personal Access Token from Settings > Account Security. A classic PAT with the repo and read:user scopes is sufficient for all GitScope operations. Fine-grained PATs are also supported but must include read access to repository metadata, issues, and pull requests for all public repositories.",
      },
      {
        type: "bullets",
        heading: "Creating a GitHub Personal Access Token (classic)",
        items: [
          "Go to github.com and sign in to your GitHub account.",
          "Navigate to Settings > Developer settings > Personal access tokens > Tokens (classic).",
          "Click Generate new token (classic).",
          "Give the token a descriptive name, e.g. GitScope analytics.",
          "Set an expiration — 90 days is a reasonable balance between security and convenience.",
          "Check the repo scope (read access to public and private repos) and read:user scope.",
          "Click Generate token and copy the token immediately — it will not be shown again.",
          "Paste the token into Settings > Account Security > GitHub Personal Access Token in GitScope.",
        ],
      },
      {
        type: "code",
        label: "Required PAT scopes",
        code: `# Minimum required scopes for a GitHub Classic PAT
repo          — Read-only access to public repository data
              (stars, issues, pull requests, code, commits)
read:user     — Read your public GitHub profile and activity

# Optional — only needed if you want to analyze
# repositories within private GitHub organizations
read:org      — Read organization membership and public repos`,
      },
      {
        type: "paragraph",
        text: "Your token is stored encrypted in the database and is only used server-side when proxying GitHub API requests on your behalf. It is never exposed to the browser after submission. You can revoke and replace your token at any time from the Settings page or directly from your GitHub account settings.",
      },
      {
        type: "bullets",
        heading: "Account security best practices",
        items: [
          "Use a token expiration of 90 days or less and rotate it regularly.",
          "If you signed in with email/password, enable a strong, unique password and update it periodically from Settings > Account Security.",
          "Signing in with GitHub OAuth is the most secure option because GitHub handles the credential lifecycle.",
          "If you believe your PAT has been compromised, revoke it immediately on GitHub and generate a new one.",
        ],
      },
    ],
    links: [
      { label: "Account Settings", href: "/settings" },
      { label: "Sign In",          href: "/auth/signin" },
    ],
  },

  // -------------------------------------------------------------------------
  "repository-analysis": {
    title:    "Repository Analysis",
    subtitle: "Deep-dive analytics for any public GitHub repository — stars, contributors, code, commits, and more.",
    blocks: [
      {
        type: "paragraph",
        text: "The repository analysis view is the core of GitScope. Navigate to any repository by typing its full owner/name (e.g. facebook/react) into the search bar on the Explore page, or by clicking any repository card from the Trending feed or your Recent History. The analysis view is organized into tabs: Overview, Code, Commits, Contributors, Issues, and Pull Requests.",
      },
      {
        type: "bullets",
        heading: "Overview tab",
        items: [
          "Star History — an interactive line chart showing cumulative stars over the lifetime of the repository, with tooltips displaying the star count at any date.",
          "Language Breakdown — a donut chart of the repository's language composition by byte count, with exact percentages.",
          "Key Metrics — watchers, forks, open issues, open pull requests, license, and default branch at a glance.",
          "Repository Health Score — a composite score derived from commit frequency, issue closure rate, PR merge time, and contributor diversity.",
          "README preview — the first several hundred characters of the repository README rendered as plain text.",
        ],
      },
      {
        type: "bullets",
        heading: "Commits tab",
        items: [
          "A chronological list of the most recent commits with author, date, message, and SHA hash.",
          "Commit frequency chart — a weekly heatmap showing activity density over the past 52 weeks, similar to a GitHub contribution graph but focused on a single repository.",
          "Each commit entry links directly to the commit on GitHub for full diff review.",
        ],
      },
      {
        type: "bullets",
        heading: "Contributors tab",
        items: [
          "Ranked list of all contributors by total commit count, with their GitHub avatar, username, and contribution percentage.",
          "Contributor diversity score — higher scores indicate a healthier spread of contributions rather than dependence on a single author.",
          "Clicking a contributor opens their GitHub profile in a new tab.",
        ],
      },
      {
        type: "paragraph",
        text: "The Compare view lets you load two repositories side-by-side on the same screen. Metrics are aligned in parallel columns so you can directly compare star growth trajectories, language overlaps, contributor counts, and health scores. Navigate to /compare or use the Compare button on any repository card.",
      },
      {
        type: "bullets",
        heading: "Searching repositories",
        items: [
          "On the Explore page, type a full owner/repo (e.g. torvalds/linux) to go directly to that repository.",
          "Type a plain keyword or topic (e.g. machine learning python) to search all public GitHub repositories and browse ranked results.",
          "Filter results by language, star count range, and sort order (Best match, Most stars, Recently updated, Most forks).",
          "Your recent searches and recently viewed repositories are saved in your session and accessible from the top navigation search bar.",
        ],
      },
    ],
    links: [
      { label: "Explore Repositories", href: "/search"   },
      { label: "Compare Repos",         href: "/compare" },
      { label: "View Trending",         href: "/trending" },
    ],
  },

  // -------------------------------------------------------------------------
  "intelligence-hub": {
    title:    "Intelligence Hub",
    subtitle: "AI-powered repository intelligence across 12 tools: health scans, CVE detection, code ownership, CI/CD, test coverage, PR review, bulk PR queue, and AI writing.",
    blocks: [
      {
        type: "paragraph",
        text: "The Intelligence Hub is GitScope's AI analysis layer. It has two levels of tabs: outer tabs (Code Lens, Org Health, Ownership, CI/CD, Radar, Velocity, AI Risk) and inner Code Lens sub-tabs (PR Review, Commit Inspector, Repo Scan, CVE Scanner, PR Description, AI Generators, Test Coverage, PR Queue). Add one or more repositories to your workspace using the search bar, then switch between tools freely.",
      },
      {
        type: "note",
        text: "AI features are tier-gated. Free accounts can run scans with limited depth. Professional and above have deeper analysis. Bring your own Anthropic or OpenAI API key (Settings → BYOK) to unlock AI features on any tier. OSV CVE scans, Code Ownership, CI/CD, and Test Coverage do not consume AI quota.",
      },
      {
        type: "bullets",
        heading: "Code Lens — Repo Health Scan",
        items: [
          "Produces a 0–100 health score covering security, code quality, documentation, dependency freshness, and maintenance activity.",
          "Findings ranked Critical → Low, each with a remediation suggestion and optional diff fix.",
          "Save any finding as an Action Item; escalate to a GitHub Issue with one click.",
          "Scan history retained so you can track score changes over time (30d Pro, 90d Team, unlimited Enterprise).",
        ],
      },
      {
        type: "bullets",
        heading: "Code Lens — OSV CVE Scanner",
        items: [
          "Queries Google's Open Source Vulnerability database for CVEs in the repo's dependencies.",
          "Each result shows: CVE ID, severity, CVSS score, affected version range, and fixed version.",
          "Supports npm (package.json), PyPI (requirements.txt), and Go (go.mod).",
          "No AI quota consumed.",
        ],
      },
      {
        type: "bullets",
        heading: "Code Lens — PR Review & PR Queue",
        items: [
          "PR Review: paste a PR number or branch name to get an AI verdict (Approve / Request Changes / Discuss), risk level, and per-file findings.",
          "PR Queue (bulk): load all open PRs for a repo, select any subset, and run AI reviews sequentially — results appear inline per PR with size badge (XS–XL), verdict, and top findings.",
          "Both use the same AI review pipeline; PR Queue requires Professional tier.",
        ],
      },
      {
        type: "bullets",
        heading: "Code Lens — Test Coverage",
        items: [
          "Pulls live coverage percentage from Codecov's public API (no Codecov account required for public repos).",
          "Displays a ring gauge with A+–F grade, 10-commit trend bar chart, and pass/fail trend delta.",
          "Auto-detects test frameworks from package.json devDependencies and requirements.txt: Jest, Vitest, Mocha, pytest, coverage.py, nyc, c8, Go test.",
          "Shows all detected config files (jest.config.ts, codecov.yml, .coveragerc, etc.).",
        ],
      },
      {
        type: "bullets",
        heading: "Ownership tab — Code Ownership Maps",
        items: [
          "Shows per-contributor commit percentage, additions, deletions, and a stacked ownership bar across the top contributors.",
          "Bus Factor score: the minimum number of developers who together own ≥ 80% of all commits.",
          "Bus Factor risk levels: CRITICAL (1 person), HIGH (2 people), MEDIUM (3–4 people), HEALTHY (5+).",
          "Works for public repos without authentication; private repos use your connected OAuth token automatically.",
        ],
      },
      {
        type: "bullets",
        heading: "CI/CD tab — Workflow Status",
        items: [
          "Lists all GitHub Actions workflows for the selected repo with their latest run status.",
          "Per-workflow: color-coded run streak dots (green = success, red = failure, blue = running), pass rate %, and average build duration.",
          "Overall fleet pass rate shown in the summary strip.",
          "Supports private repos via server-side token proxy.",
        ],
      },
      {
        type: "bullets",
        heading: "Code Lens — PR Description & AI Generators",
        items: [
          "PR Description: fetches diff from GitHub (by PR number or branch) and generates a structured Markdown description with Summary, Changes, and Testing sections.",
          "README Generator: generates a full README from repo metadata; adjustable verbosity.",
          "Changelog Generator: converts recent commits to Keep-a-Changelog, Conventional Commits, or Narrative format.",
        ],
      },
      {
        type: "bullets",
        heading: "Action Items & Scheduled Scans",
        items: [
          "Save any scan finding as a persistent Action Item (visible in Bookmarks).",
          "Schedule daily, weekly, or monthly automated re-scans from Settings → Scheduled Scans (Professional+).",
          "Score drop alerts sent to your Slack and/or Discord webhooks automatically.",
        ],
      },
    ],
    links: [
      { label: "Open Intelligence Hub", href: "/intelligence" },
      { label: "Action Items",          href: "/bookmarks"    },
      { label: "Settings",              href: "/settings"     },
    ],
  },

  // -------------------------------------------------------------------------
  "integrations": {
    title:    "Slack, Discord & Alerts",
    subtitle: "Connect your communication tools to get real-time scan alerts and weekly digest summaries.",
    blocks: [
      {
        type: "paragraph",
        text: "GitScope can push notifications to Slack and Discord when repository health drops, and send a Monday-morning weekly digest summarizing your fleet's health. Both integrations use simple incoming webhook URLs — no OAuth or app installation required on the communication platform side.",
      },
      {
        type: "bullets",
        heading: "Setting up Slack",
        items: [
          "Go to api.slack.com/apps and create a new Slack App (or use an existing one).",
          "Enable Incoming Webhooks under the Features section.",
          "Click 'Add New Webhook to Workspace', choose your channel, and copy the webhook URL.",
          "Paste the URL into GitScope Settings → Integrations → Slack Webhook URL.",
          "Click 'Test' to send a test message and confirm the connection.",
          "Requires Professional tier or above.",
        ],
      },
      {
        type: "bullets",
        heading: "Setting up Discord",
        items: [
          "In Discord, open the channel where you want GitScope notifications.",
          "Click Edit Channel → Integrations → Webhooks → New Webhook.",
          "Give it a name (e.g. 'GitScope') and copy the webhook URL.",
          "Paste the URL into GitScope Settings → Integrations → Discord Webhook URL.",
          "Click 'Test' to verify the connection.",
          "Requires Professional tier or above.",
        ],
      },
      {
        type: "bullets",
        heading: "What triggers an alert",
        items: [
          "A manual or scheduled repo scan that detects a health score drop of 10+ points vs. the previous scan.",
          "A scan that surfaces a new Critical or High severity finding.",
          "The alert includes: repo name, previous score, new score, number of critical/high findings, and a link to the full scan report.",
        ],
      },
      {
        type: "bullets",
        heading: "Weekly Digest",
        items: [
          "Enable the Weekly Digest from Settings → Notifications.",
          "Every Monday at 08:00 UTC, GitScope sends a summary to your email + configured Slack/Discord channels.",
          "The digest includes: total repos scanned, average health score, week-over-week delta, top 3 healthiest repos, and up to 3 at-risk repos (score < 50).",
          "Requires at least one repo scan in the past 30 days to generate meaningful data.",
        ],
      },
      {
        type: "bullets",
        heading: "Health Badge",
        items: [
          "Embed a live health-score badge in any README or documentation.",
          "Badge URL format: https://git-scope-pi.vercel.app/api/badge?repo={owner/repo}",
          "The badge updates after each new scan and shows the current score with a color indicator (green ≥ 70, yellow 40–69, red < 40).",
          "Available to all tiers — no authentication required to display the badge.",
        ],
      },
    ],
    links: [
      { label: "Open Settings → Integrations", href: "/settings" },
    ],
  },

  // -------------------------------------------------------------------------
  "organization-analytics": {
    title:    "Organization Analytics",
    subtitle: "Macro-level engineering intelligence for any GitHub organization.",
    blocks: [
      {
        type: "paragraph",
        text: "The Organization Analytics view lets you analyze any public GitHub organization as a whole — not just individual repositories. Enter an organization name (e.g. microsoft, vercel, or your own company's GitHub org) to see aggregated statistics across all of its public repositories.",
      },
      {
        type: "bullets",
        heading: "Organization overview metrics",
        items: [
          "Total public repositories, total stars, total forks, and total open issues across the entire organization.",
          "Aggregate language footprint — which programming languages dominate across all repos, weighted by repository size.",
          "Top repositories by stars, by recent commit activity, and by contributor count.",
          "Organization member count and external contributor count (contributors who are not org members).",
          "Average repository health score across the organization's top 20 most active repos.",
        ],
      },
      {
        type: "bullets",
        heading: "Repository breakdown",
        items: [
          "A sortable table of all public repositories with columns for stars, forks, open issues, last push date, primary language, and health score.",
          "Filter repositories by language, activity level (active / stale / archived), and star range.",
          "Click any repository row to navigate directly to its full analysis view.",
          "Starred repositories are visually distinguished from unstarred ones so you can quickly spot the org's flagship projects.",
        ],
      },
      {
        type: "paragraph",
        text: "Organization analytics are particularly useful for competitive intelligence and technical due diligence. For example, before evaluating an open-source dependency, you can check the health of the entire organization maintaining it — not just the one package you plan to use. If the org has many stale repos and low contributor diversity, that context matters.",
      },
      {
        type: "bullets",
        heading: "Contributor heatmap",
        items: [
          "Shows the distribution of commits across contributors at the organization level.",
          "Identifies the most active contributors across all repos, not just within a single project.",
          "Highlights potential key-person risk: if a single contributor accounts for the majority of commits across many repos, a departure would be high-impact.",
        ],
      },
      {
        type: "note",
        text: "Large organizations (500+ public repositories) may take longer to load due to GitHub API pagination. GitScope fetches up to 100 repositories per page and will automatically paginate to retrieve the full list, but this can consume a significant portion of your hourly rate limit. A GitHub PAT is strongly recommended for organization analysis.",
      },
    ],
    links: [
      { label: "Analyze an Organization", href: "/organizations" },
    ],
  },

  // -------------------------------------------------------------------------
  "activity-notifications": {
    title:    "Activity & Notifications",
    subtitle: "Your personal GitHub event feed and notification center, surfaced inside GitScope.",
    blocks: [
      {
        type: "paragraph",
        text: "The Activity page streams your personal GitHub event feed directly into GitScope. It shows every public event associated with your GitHub account — pushes, pull request actions, issue comments, stars you have given, forks you have created, and more. This gives you a single place to review your own recent GitHub activity without switching to github.com.",
      },
      {
        type: "bullets",
        heading: "Supported event types",
        items: [
          "PushEvent — commits you have pushed to any repository.",
          "PullRequestEvent — pull requests you have opened, closed, merged, or reviewed.",
          "IssuesEvent — issues you have opened or closed.",
          "IssueCommentEvent — comments you have posted on issues or pull requests.",
          "WatchEvent — repositories you have starred.",
          "ForkEvent — repositories you have forked.",
          "CreateEvent — branches or tags you have created.",
          "DeleteEvent — branches or tags you have deleted.",
        ],
      },
      {
        type: "paragraph",
        text: "Events are fetched from GitHub's Events API, which returns your 300 most recent public events. GitHub retains public events for approximately 90 days. The Activity page does not show events from private repositories — only public actions are included, consistent with GitScope's read-only, public-only data model.",
      },
      {
        type: "bullets",
        heading: "Filtering and navigation",
        items: [
          "Filter events by type using the event-type dropdown at the top of the Activity page.",
          "Filter by repository — type a repository name to show only events associated with that repo.",
          "Each event card shows the event type, the repository it belongs to, a human-readable description of the action, and a relative timestamp.",
          "Click any repository name in the event feed to navigate directly to its GitScope analysis page.",
        ],
      },
      {
        type: "paragraph",
        text: "The Activity page requires GitHub OAuth sign-in or a GitHub PAT configured in Settings. Without GitHub authentication, GitScope cannot fetch your personal event feed.",
      },
      {
        type: "note",
        text: "The Activity page shows only your own public GitHub events. It does not show notifications from repositories you watch (those would require the notifications:read OAuth scope, which GitScope does not request). For notification management, continue using github.com or the GitHub mobile app.",
      },
    ],
    links: [
      { label: "View Activity Feed", href: "/activity" },
      { label: "Account Settings",   href: "/settings" },
    ],
  },

  // -------------------------------------------------------------------------
  "api-rate-limits": {
    title:    "API & Rate Limits",
    subtitle: "How GitScope uses the GitHub API, what the rate limits are, and how to stay within them.",
    blocks: [
      {
        type: "paragraph",
        text: "GitScope is entirely powered by the GitHub REST API. Every piece of data you see — repository metadata, star counts, contributor lists, commit histories, pull requests, and organization details — is fetched live from GitHub's servers at request time. There is no separate GitScope database of repository data; everything comes directly from GitHub.",
      },
      {
        type: "table",
        heading: "GitHub API rate limits by authentication type",
        headers: ["Auth Method", "Requests / Hour", "Notes"],
        rows: [
          ["Unauthenticated (guest)",         "60",    "Shared limit across all GitScope guests on the same server IP. May be exhausted quickly."],
          ["GitHub PAT (Classic or Fine-grained)", "5,000", "Per-token limit. Strongly recommended for any serious usage."],
          ["GitHub OAuth App token",           "5,000", "Used when you sign in via GitHub OAuth. Same limit as a PAT."],
          ["GitHub App installation token",    "5,000–15,000", "Not currently used by GitScope."],
        ],
      },
      {
        type: "paragraph",
        text: "When you are signed in with GitHub OAuth, GitScope uses your OAuth access token for all GitHub API requests, giving you the full 5,000 requests/hour quota. When you add a personal access token in Settings, that token is used server-side for API calls. If both an OAuth token and a PAT are present, GitScope prefers the PAT (since it is explicitly configured and scoped for this purpose).",
      },
      {
        type: "code",
        label: "Typical request budget for common operations",
        code: `# Approximate GitHub API requests consumed per operation

Repository overview page load:     ~4–6 requests
  (metadata, languages, contributors, recent commits)

Commit history (full, 100 commits): ~2–3 requests

Star history chart:                 ~1–5 requests
  (depends on repo age; older repos require more pages)

Organization analysis (50 repos):  ~5–15 requests

Intelligence Hub — full analysis:  ~10–20 requests
  (velocity, PR risk, dependency radar, health score)

Trending page load:                 ~3–5 requests`,
      },
      {
        type: "bullets",
        heading: "Rate limit best practices",
        items: [
          "Always configure a GitHub PAT in Settings if you plan to analyze more than a handful of repositories in a session.",
          "Organization analysis of large orgs (100+ repos) consumes many requests. Use it sparingly on a guest or unauthenticated session.",
          "The Intelligence Hub is the most API-intensive feature. Avoid running full Hub analyses in rapid succession.",
          "If you hit the rate limit, GitScope will show a clear error message indicating when your quota resets (GitHub resets limits every 60 minutes on a rolling window).",
          "The rate limit display in Settings > Account Security shows your current remaining quota and reset time.",
        ],
      },
      {
        type: "code",
        label: "GitHub API rate limit response headers",
        code: `# GitHub includes these headers on every API response.
# GitScope reads them to track your remaining quota.

X-RateLimit-Limit:     5000
X-RateLimit-Remaining: 4823
X-RateLimit-Reset:     1712182800   # Unix timestamp of reset
X-RateLimit-Used:      177
X-RateLimit-Resource:  core`,
      },
    ],
    links: [
      { label: "Add a GitHub PAT",              href: "/settings"                                                              },
      { label: "GitHub Docs — Rate Limiting",   href: "https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api" },
    ],
  },

  // -------------------------------------------------------------------------
  "keyboard-shortcuts": {
    title:    "Keyboard Shortcuts",
    subtitle: "Navigate GitScope faster with these keyboard shortcuts.",
    blocks: [
      {
        type: "paragraph",
        text: "GitScope supports a comprehensive set of keyboard shortcuts for power users. Shortcuts are active on any page and do not require any special mode to be activated. The Command Palette (Ctrl+K / Cmd+K) provides an searchable shortcut to any feature or page in the app.",
      },
      {
        type: "table",
        heading: "Navigation shortcuts",
        headers: ["Shortcut", "Action"],
        rows: [
          ["G  then  O",    "Go to Overview (your personal dashboard)"],
          ["G  then  E",    "Go to Explore (repository search)"],
          ["G  then  T",    "Go to Trending repositories"],
          ["G  then  A",    "Go to Activity feed"],
          ["G  then  I",    "Go to Intelligence Hub"],
          ["G  then  R",    "Go to Organizations"],
          ["G  then  S",    "Go to Settings"],
          ["G  then  D",    "Go to Documentation (this page)"],
        ],
      },
      {
        type: "table",
        heading: "Global shortcuts",
        headers: ["Shortcut", "Action"],
        rows: [
          ["Ctrl+K  /  Cmd+K",     "Open the Command Palette — search pages, features, and recent repos"],
          ["/",                    "Focus the search bar on the current page"],
          ["T",                    "Toggle between light and dark theme"],
          ["F",                    "Toggle fullscreen mode"],
          ["Escape",               "Close any open modal, dropdown, or Command Palette"],
          ["?",                    "Show this keyboard shortcuts reference"],
        ],
      },
      {
        type: "table",
        heading: "Repository analysis shortcuts",
        headers: ["Shortcut", "Action"],
        rows: [
          ["1",          "Switch to Overview tab"],
          ["2",          "Switch to Commits tab"],
          ["3",          "Switch to Contributors tab"],
          ["4",          "Switch to Issues tab"],
          ["5",          "Switch to Pull Requests tab"],
          ["R",          "Refresh current repository data"],
          ["C",          "Open Compare — add this repo as the left-hand side of a comparison"],
        ],
      },
      {
        type: "note",
        text: "Chord shortcuts (G then O, G then E, etc.) require both keys to be pressed within 1 second of each other. If you press G and wait more than 1 second, the chord is cancelled. Single-key shortcuts (T, F, /, ?) are disabled when focus is inside a text input to avoid interfering with typing.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  "troubleshooting": {
    title:    "Troubleshooting",
    subtitle: "Solutions for common problems with authentication, rate limits, missing data, and display issues.",
    blocks: [
      {
        type: "bullets",
        heading: "Authentication issues",
        items: [
          'Problem: "Sign in with GitHub" does not redirect or shows an error. — Check that your browser allows third-party cookies and is not blocking the OAuth redirect. Try in an incognito window to isolate extension interference.',
          'Problem: After signing in, the page shows a session error or logs you back out. — Clear your browser cookies for this domain and try signing in again. If the problem persists, try a different browser.',
          'Problem: Email/password sign-in says "Invalid credentials" but you are sure of your password. — Use the "Forgot password" link on the sign-in page to receive a reset email. Check your spam folder if the email does not arrive within 2 minutes.',
          'Problem: Your GitHub PAT is rejected when saving in Settings. — Verify the token is a classic PAT (not a fine-grained PAT with insufficient scopes) and has the repo and read:user scopes checked. Also confirm the token has not expired on GitHub.',
        ],
      },
      {
        type: "bullets",
        heading: "Rate limit errors",
        items: [
          'Problem: "API rate limit exceeded" error on the Explore or repository pages. — This means your GitHub API quota for the hour is exhausted. Add a GitHub PAT in Settings if you have not already. If you have a PAT, it may have expired — check Settings > Account Security.',
          "Problem: Rate limit errors appear even with a PAT configured. — Confirm the PAT was saved successfully by going to Settings > Account Security and checking if the token is shown as configured. If the PAT has expired, generate a new one on GitHub.",
          "Problem: Rate limit resets but errors reappear quickly. — You may be sharing an IP with many other unauthenticated GitScope users. Adding your own PAT gives you a per-token quota that is completely isolated from other users.",
        ],
      },
      {
        type: "bullets",
        heading: "Missing or incorrect data",
        items: [
          "Problem: A repository's star count or contributor list appears outdated. — All data is fetched live from GitHub on every page load. If GitHub's API is returning stale data, it usually self-corrects within a few minutes. Try refreshing the page (R shortcut on the repository view).",
          "Problem: A repository cannot be found by owner/name. — Verify the exact capitalization of owner and repo. GitHub repository names are case-insensitive for lookups but display exactly as entered. Also confirm the repository is public — GitScope cannot access private repositories.",
          "Problem: The star history chart shows a flat line or no data. — This can happen for very new repositories (fewer than a few hundred stars) where the timeline chart has insufficient data points. This is expected behavior, not a bug.",
          "Problem: The Dependency Radar shows no results. — The Dependency Radar reads package.json from the repository root. If the repository uses a different package manager or no package.json exists at the root, no results will be shown.",
        ],
      },
      {
        type: "bullets",
        heading: "Intelligence Hub issues",
        items: [
          "Problem: Intelligence Hub features are greyed out or show a sign-in prompt. — The Hub requires GitHub OAuth or a GitHub PAT. Sign in with GitHub or add a PAT in Settings.",
          "Problem: PR Risk Predictor shows no pull requests. — The repository may have no open pull requests, or the repository owner may have disabled pull requests. The predictor only analyzes open, non-draft PRs.",
          "Problem: Velocity Metrics shows a flat line for a recently updated repository. — Velocity is calculated from GitHub's commit activity endpoint, which can have up to a 24-hour delay for freshly updated repositories.",
        ],
      },
      {
        type: "bullets",
        heading: "Display and UI issues",
        items: [
          "Problem: Charts are not rendering or appear blank. — GitScope uses canvas-based charts. Ensure your browser is up to date and hardware acceleration is enabled. Try clearing the browser cache (Ctrl+Shift+R / Cmd+Shift+R).",
          "Problem: The layout looks broken on mobile. — GitScope is responsive but optimized for screens 375px and wider. If you are on an older device, try the desktop site toggle in your mobile browser.",
          "Problem: Dark mode preference is not being saved. — Theme preferences are stored in your browser's local storage. If you are in private/incognito mode, preferences will reset on each session. Sign in to sync preferences to your account.",
        ],
      },
    ],
    links: [
      { label: "Account Settings", href: "/settings" },
    ],
  },

  // -------------------------------------------------------------------------
  "privacy-data": {
    title:    "Privacy & Data",
    subtitle: "What data GitScope collects, how it is stored, and how to delete your account.",
    blocks: [
      {
        type: "paragraph",
        text: "GitScope is designed with a minimal-data philosophy. We collect only what is necessary to provide the service, and we do not store GitHub repository data at all — every repository analysis is a live, on-demand fetch from the GitHub API. When you navigate away from a repository page, that data is gone from GitScope's memory.",
      },
      {
        type: "bullets",
        heading: "What GitScope stores in its database",
        items: [
          "Your account credentials (email and bcrypt-hashed password for email/password accounts; OAuth provider ID and email for OAuth accounts).",
          "Your GitHub Personal Access Token, if you provide one — stored encrypted at rest using AES-256.",
          "Your display name and avatar URL (synced from your OAuth provider or set manually).",
          "Your theme and appearance preferences.",
          "Your recently viewed repositories list (stored as a list of owner/repo strings, not the repository data itself).",
          "NextAuth.js session tokens (stored as secure, httpOnly cookies with a configurable expiration).",
        ],
      },
      {
        type: "bullets",
        heading: "What GitScope does NOT store",
        items: [
          "Repository data, star histories, commit histories, contributor lists, or any other GitHub content. This is always fetched live.",
          "Your GitHub OAuth access token in plain text — OAuth tokens are used in-memory during a request and are managed by NextAuth.js session handling.",
          "Analytics or tracking data about which repositories you view. GitScope does not have a repository-view log tied to your account.",
          "Any data from your private GitHub repositories. GitScope only reads public data and never requests private repository access.",
        ],
      },
      {
        type: "paragraph",
        text: "When you authenticate with GitHub OAuth, GitScope receives a limited OAuth access token from GitHub. This token has the scopes you approved during the OAuth flow (read:user and public repo access). It is not possible for GitScope to access your private repositories, send messages on your behalf, or perform any write operations on GitHub through this token.",
      },
      {
        type: "bullets",
        heading: "Data deletion and account removal",
        items: [
          "You can delete your GitScope account at any time from Settings > Account Security > Delete Account.",
          "Deleting your account removes all data associated with it from GitScope's database: credentials, preferences, session data, and your stored GitHub PAT.",
          "Account deletion is permanent and cannot be undone. You will need to create a new account to use GitScope again.",
          "If you authenticated via GitHub OAuth, deleting your GitScope account does not revoke GitScope's OAuth authorization on GitHub. You can revoke it separately at github.com > Settings > Applications > Authorized OAuth Apps.",
        ],
      },
      {
        type: "bullets",
        heading: "Third-party services",
        items: [
          "GitHub — All repository data is sourced from the GitHub REST API. GitHub's Privacy Policy applies to data returned by their API.",
          "Google OAuth — If you sign in with Google, Google's OAuth infrastructure handles authentication. GitScope receives only your email address and display name from Google.",
          "Database — GitScope uses PostgreSQL (via Prisma) to store account data. The database is hosted in a private, network-isolated environment.",
        ],
      },
      {
        type: "note",
        text: "GitScope is an independent project and is not affiliated with or endorsed by GitHub, Inc. or Google LLC.",
      },
    ],
    links: [
      { label: "Account Settings", href: "/settings" },
    ],
  },

  // -------------------------------------------------------------------------
  // SECURITY FEATURES
  // -------------------------------------------------------------------------
  "security-features": {
    title:    "Security Features",
    subtitle: "Enterprise-grade security measures protecting your data and platform access.",
    blocks: [
      {
        type: "paragraph",
        text: "GitScope implements comprehensive security measures to protect user data and platform integrity. All security features are active by default and require no additional configuration for standard usage.",
      },
      {
        type: "bullets",
        heading: "Authentication Security",
        items: [
          "bcrypt password hashing with 12 salt rounds — industry standard for secure password storage",
          "GitHub OAuth with email verification via GitHub API — ensures email ownership before account linking",
          "Google OAuth with verified email enforcement — only accepts emails verified by Google",
          "Automatic account linking with audit logging — tracks when OAuth accounts connect to existing users",
          "Instant session invalidation — deleted users are immediately logged out across all sessions",
          "Brute-force protection — 10 login attempts per 15 minutes per email address",
        ],
      },
      {
        type: "bullets",
        heading: "CSRF Protection",
        items: [
          "Double Submit Cookie pattern — prevents cross-site request forgery attacks",
          "HMAC-SHA256 token validation — cryptographically secure token hashing",
          "Constant-time comparison — prevents timing attacks on token validation",
          "__Host- prefix cookies — browser-enforced secure cookie settings",
          "SameSite=Strict — cookies only sent for same-origin requests",
        ],
      },
      {
        type: "bullets",
        heading: "Rate Limiting & Abuse Prevention",
        items: [
          "IP-based rate limiting with reputation tracking — tracks repeat violators",
          "Exponential backoff — increasing block durations for repeat offenders (up to 1 hour)",
          "Multiple rate limit presets — auth (5/min), sensitive (10/min), standard (60/min), AI (10/min)",
          "Rate limit headers — X-RateLimit-Remaining, X-RateLimit-Reset exposed to clients",
        ],
      },
      {
        type: "bullets",
        heading: "Data Protection",
        items: [
          "AES-256-GCM encryption for GitHub PATs at rest — includes random IV and authentication tag",
          "TLS 1.3 for data in transit — latest transport security standard",
          "No source code storage — GitScope never stores repository contents",
          "Secure session cookies — httpOnly, secure, SameSite=Strict with configurable expiration",
        ],
      },
      {
        type: "bullets",
        heading: "Audit & Monitoring",
        items: [
          "34 security event types logged — authentication, authorization, CSRF, rate limiting",
          "Batched writes with immediate flush — critical events saved immediately",
          "IP, user agent, and metadata captured — comprehensive audit trail",
          "Database persistence with retry logic — reliable audit log storage",
        ],
      },
      {
        type: "bullets",
        heading: "Input Validation & SSRF Protection",
        items: [
          "Strict validation on all API endpoints — email format, password complexity, length limits",
          "GitHub repo format validation — owner/name pattern enforcement",
          "Avatar URL allowlist — only trusted image hosts permitted",
          "SSRF protection — GitHub proxy blocks http:// and path traversal attempts",
        ],
      },
      {
        type: "table",
        heading: "Security Headers",
        headers: ["Header", "Purpose"],
        rows: [
          ["Cache-Control", "Prevents caching of authenticated content"],
          ["X-RateLimit-*", "Informs clients of rate limit status"],
          ["Secure Cookie Attributes", "httpOnly, secure, SameSite=Strict"],
        ],
      },
      {
        type: "note",
        text: "For production deployments, ensure GITHUB_PAT_ENCRYPTION_KEY and NEXTAUTH_SECRET are set with cryptographically secure random values (openssl rand -base64 32).",
      },
    ],
    links: [
      { label: "Security Policy", href: "/security" },
      { label: "Privacy Policy", href: "/privacy" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Block renderer helpers
// ---------------------------------------------------------------------------

function RenderBlocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="space-y-6">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "paragraph":
            return (
              <p key={i} className="text-sm leading-relaxed text-foreground/80 font-medium">
                {block.text}
              </p>
            );

          case "bullets":
            return (
              <div key={i} className="space-y-2">
                {block.heading && (
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">
                    {block.heading}
                  </p>
                )}
                <ul className="space-y-2.5">
                  {block.items.map((item, j) => {
                    const colonIdx = item.indexOf(" — ");
                    const hasTerm = colonIdx !== -1;
                    return (
                      <li key={j} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
                        <span className="mt-1.5 shrink-0 size-1.5 rounded-full bg-indigo-500/50" />
                        <span>
                          {hasTerm ? (
                            <>
                              <span className="font-bold text-foreground/90">{item.slice(0, colonIdx)}</span>
                              <span>{item.slice(colonIdx)}</span>
                            </>
                          ) : (
                            item
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );

          case "code":
            return (
              <div key={i} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <div className="size-2 rounded-full bg-indigo-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    {block.label}
                  </span>
                </div>
                <pre className="overflow-x-auto rounded-2xl border border-border bg-[#0d152a] dark:bg-[#0d152a] p-6 font-mono text-xs leading-relaxed text-emerald-400/90 shadow-2xl">
                  <code>{block.code}</code>
                </pre>
              </div>
            );

          case "table":
            return (
              <div key={i} className="space-y-3">
                {block.heading && (
                  <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                    {block.heading}
                  </p>
                )}
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-indigo-500/10 border-b border-border">
                        {block.headers.map((h, j) => (
                          <th
                            key={j}
                            className="px-4 py-3 text-left font-black uppercase tracking-widest text-indigo-400 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, j) => (
                        <tr
                          key={j}
                          className={cn(
                            "border-b border-border last:border-0",
                            j % 2 === 0 ? "bg-muted/20" : "bg-muted/40"
                          )}
                        >
                          {row.map((cell, k) => (
                            <td
                              key={k}
                              className={cn(
                                "px-4 py-3 leading-relaxed",
                                k === 0
                                  ? "font-mono font-bold text-foreground/90 whitespace-nowrap"
                                  : "text-muted-foreground"
                              )}
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );

          case "note":
            return (
              <div
                key={i}
                className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-4"
              >
                <MaterialIcon name="info" size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed text-amber-300/80 font-medium">{block.text}</p>
              </div>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export interface DocsPageClientProps {
  variant?: "marketing" | "dashboard";
}

export function DocsPageClient({ variant = "marketing" }: DocsPageClientProps) {
  const [active, setActive] = useState<Section>("getting-started");
  const [searchQuery, setSearchQuery] = useState("");
  const isDashboard = variant === "dashboard";
  const data = content[active];

  const filteredSections = sections.filter((s) => {
    const q = searchQuery.toLowerCase();
    return (
      s.label.toLowerCase().includes(q) ||
      content[s.id].title.toLowerCase().includes(q) ||
      content[s.id].subtitle.toLowerCase().includes(q)
    );
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "mx-auto w-full",
        isDashboard ? "max-w-none space-y-8" : "max-w-7xl px-6 py-12"
      )}
    >
      {/* ----------------------------------------------------------------- */}
      {/* Marketing-mode header                                              */}
      {/* ----------------------------------------------------------------- */}
      {!isDashboard && (
        <div className="mb-10 text-center">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-5xl mb-4">
            Documentation
          </h1>
          <p className="text-muted-foreground mx-auto max-w-xl text-sm md:text-base font-medium">
            Guides, API reference, keyboard shortcuts, and feature walkthroughs for the GitScope analytics platform.
          </p>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Dashboard-mode header                                              */}
      {/* ----------------------------------------------------------------- */}
      {isDashboard && (
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
              <span className="bg-clip-text text-transparent bg-linear-to-r from-indigo-500 to-purple-500">
                Documentation
              </span>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-500">
                <MaterialIcon name="menu_book" size={14} />
                <span className="text-[10px] uppercase font-bold tracking-widest">Reference</span>
              </div>
            </h1>
            <p className="text-muted-foreground mt-1 text-sm font-medium">
              Guides, API reference, and feature walkthroughs for the GitScope analytics platform.
            </p>
          </div>
          <div className="relative group max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground group-focus-within:text-indigo-500 transition-colors" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search docs..."
              className="pl-10 pr-4 py-6 rounded-2xl bg-card border-border focus:ring-2 ring-indigo-500/20 font-medium"
            />
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Two-column layout: sidebar + content                               */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">

        {/* Sidebar nav */}
        <nav className="space-y-1">
          {/* Search bar — marketing mode */}
          {!isDashboard && (
            <div className="relative group mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground group-focus-within:text-indigo-500 transition-colors" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search docs..."
                className="pl-10 pr-4 py-2 rounded-xl bg-card border-border focus:ring-2 ring-indigo-500/20 font-medium text-sm"
              />
            </div>
          )}

          {filteredSections.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition-all group",
                active === s.id
                  ? "bg-indigo-500/10 font-bold text-indigo-500 border border-indigo-500/20 shadow-lg shadow-indigo-500/5"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent"
              )}
            >
              <MaterialIcon
                name={s.icon}
                size={17}
                className={cn(
                  "shrink-0 transition-colors",
                  active === s.id
                    ? "text-indigo-500"
                    : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <span className="truncate tracking-tight">{s.label}</span>
            </button>
          ))}

          {filteredSections.length === 0 && (
            <div className="px-4 py-8 text-center border border-dashed border-border rounded-xl">
              <MaterialIcon name="search_off" size={24} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                No matching sections
              </p>
            </div>
          )}
        </nav>

        {/* Main content panel */}
        <motion.article
          key={active}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className="rounded-2xl p-8 lg:p-12 relative overflow-hidden border border-border bg-card"
        >
          {/* Decorative background icon */}
          <div className="absolute top-0 right-0 p-10 opacity-[0.04] pointer-events-none select-none">
            <MaterialIcon
              name={sections.find((s) => s.id === active)?.icon ?? "article"}
              size={180}
            />
          </div>

          <div className="relative z-10 max-w-3xl">
            {/* Section header */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <MaterialIcon
                  name={sections.find((s) => s.id === active)?.icon ?? "article"}
                  size={20}
                  className="text-indigo-500"
                />
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500/70">
                  {sections.find((s) => s.id === active)?.label}
                </span>
              </div>
              <h2 className="font-heading text-2xl md:text-3xl font-black text-foreground tracking-tight">
                {data.title}
              </h2>
              <p className="mt-2 text-sm md:text-base text-muted-foreground font-medium">
                {data.subtitle}
              </p>
            </div>

            {/* Section body */}
            <RenderBlocks blocks={data.blocks} />

            {/* Next steps / links */}
            {data.links && data.links.length > 0 && (
              <div className="mt-12 border-t border-border/50 pt-8">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-4">
                  Next Steps
                </p>
                <div className="flex flex-wrap gap-3">
                  {data.links.map((l) => (
                    <Link
                      key={l.label}
                      href={l.href}
                      target={l.href.startsWith("http") ? "_blank" : undefined}
                      rel={l.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="group inline-flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-5 py-2.5 text-xs font-bold text-indigo-400 transition-all hover:bg-indigo-500/10 hover:border-indigo-500/40 hover:text-indigo-300 shadow-sm"
                    >
                      {l.label}
                      <MaterialIcon
                        name={l.href.startsWith("http") ? "open_in_new" : "arrow_forward"}
                        size={13}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.article>
      </div>
    </motion.div>
  );
}
