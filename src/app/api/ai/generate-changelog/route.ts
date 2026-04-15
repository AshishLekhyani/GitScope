export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";
import { callAI, hasAnyAIProvider } from "@/lib/ai-providers";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import type { AIPlan } from "@/lib/ai-providers";

// ── Types ────────────────────────────────────────────────────────────────────

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  author?: { login: string } | null;
}

interface GitHubTag {
  name: string;
  commit: { sha: string; url: string };
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
}

// ── Conventional commit parser ───────────────────────────────────────────────

const CC_TYPE_MAP: Record<string, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance",
  refactor: "Refactoring",
  docs: "Documentation",
  style: "Styling",
  test: "Tests",
  build: "Build",
  ci: "CI/CD",
  chore: "Chores",
  revert: "Reverts",
  security: "Security",
  deps: "Dependencies",
  breaking: "Breaking Changes",
};

interface ParsedCommit {
  type: string;         // conventional type (feat, fix, …) or "other"
  scope: string;        // e.g. "auth" from feat(auth): …
  subject: string;      // message after the colon
  breaking: boolean;
  sha: string;
  author: string;
  date: string;
  raw: string;
}

function parseCommit(c: GitHubCommit): ParsedCommit {
  const firstLine = c.commit.message.split("\n")[0].trim();
  const match = firstLine.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);

  const breaking =
    firstLine.includes("BREAKING CHANGE") ||
    c.commit.message.includes("BREAKING CHANGE") ||
    !!match?.[3];

  if (match) {
    return {
      type: match[1].toLowerCase(),
      scope: match[2] ?? "",
      subject: match[4],
      breaking,
      sha: c.sha.slice(0, 7),
      author: c.author?.login ?? c.commit.author.name,
      date: c.commit.author.date,
      raw: firstLine,
    };
  }

  return {
    type: "other",
    scope: "",
    subject: firstLine,
    breaking,
    sha: c.sha.slice(0, 7),
    author: c.author?.login ?? c.commit.author.name,
    date: c.commit.author.date,
    raw: firstLine,
  };
}

function groupByType(commits: ParsedCommit[]): Record<string, ParsedCommit[]> {
  const groups: Record<string, ParsedCommit[]> = {};
  for (const c of commits) {
    const key = CC_TYPE_MAP[c.type] ?? "Other Changes";
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }
  return groups;
}

// ── GitHub helpers ─────────────────────────────────────────────────────────

async function ghFetch(url: string, token: string) {
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { headers, next: { revalidate: 60 } });
}

async function fetchCommits(
  fullName: string,
  token: string,
  since?: string,
  perPage = 100
): Promise<GitHubCommit[]> {
  const sinceParam = since ? `&since=${since}` : "";
  const res = await ghFetch(
    `https://api.github.com/repos/${fullName}/commits?per_page=${perPage}${sinceParam}`,
    token
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchTags(fullName: string, token: string): Promise<GitHubTag[]> {
  const res = await ghFetch(
    `https://api.github.com/repos/${fullName}/tags?per_page=20`,
    token
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchReleases(fullName: string, token: string): Promise<GitHubRelease[]> {
  const res = await ghFetch(
    `https://api.github.com/repos/${fullName}/releases?per_page=10`,
    token
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchRepoMeta(fullName: string, token: string) {
  const res = await ghFetch(`https://api.github.com/repos/${fullName}`, token);
  if (!res.ok) return null;
  return res.json();
}

// ── Handler ─────────────────────────────────────────────────────────────────

async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!hasAnyAIProvider()) {
    return NextResponse.json(
      { error: "AI not configured — no AI provider keys set" },
      { status: 503 }
    );
  }

  let body: { repo?: string; since?: string; format?: string; maxCommits?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { repo, since, format = "keepachangelog", maxCommits = 100 } = body;

  if (!repo || typeof repo !== "string") {
    return NextResponse.json({ error: "repo field required (e.g. 'owner/repo')" }, { status: 400 });
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "Invalid repo format" }, { status: 400 });
  }
  if (!["keepachangelog", "conventional", "narrative"].includes(format)) {
    return NextResponse.json(
      { error: "format must be keepachangelog | conventional | narrative" },
      { status: 400 }
    );
  }
  const clampedMax = Math.min(Math.max(Number(maxCommits) || 100, 10), 200);

  const plan = await resolveAiPlanFromSessionDb(session) as AIPlan;
  const token = await getGitHubToken() ?? "";

  const [meta, rawCommits, tags, releases] = await Promise.all([
    fetchRepoMeta(repo, token),
    fetchCommits(repo, token, since, clampedMax),
    fetchTags(repo, token),
    fetchReleases(repo, token),
  ]);

  if (!meta) {
    return NextResponse.json({ error: "Repository not found or inaccessible" }, { status: 404 });
  }

  if (rawCommits.length === 0) {
    return NextResponse.json({ error: "No commits found for the specified range" }, { status: 404 });
  }

  const parsedCommits = rawCommits.map(parseCommit);
  const grouped = groupByType(parsedCommits);
  const breakingChanges = parsedCommits.filter((c) => c.breaking);
  const uniqueAuthors = [...new Set(parsedCommits.map((c) => c.author))];

  // Build structured commit summary for the AI
  const commitSummaryLines: string[] = [];
  for (const [groupName, commits] of Object.entries(grouped)) {
    commitSummaryLines.push(`### ${groupName}`);
    for (const c of commits.slice(0, 15)) {
      const scope = c.scope ? `**${c.scope}:** ` : "";
      const breaking = c.breaking ? " ⚠️ BREAKING" : "";
      commitSummaryLines.push(`- ${scope}${c.subject} (${c.sha})${breaking}`);
    }
    if (commits.length > 15) {
      commitSummaryLines.push(`- *(and ${commits.length - 15} more ${groupName.toLowerCase()})*`);
    }
    commitSummaryLines.push("");
  }

  const latestTag = tags[0]?.name ?? "Unreleased";
  const previousTag = tags[1]?.name ?? null;
  const dateRange = rawCommits.length > 0
    ? `${new Date(parsedCommits[parsedCommits.length - 1].date).toISOString().split("T")[0]} to ${new Date(parsedCommits[0].date).toISOString().split("T")[0]}`
    : "Unknown range";

  const releaseHistory = releases.slice(0, 5).map((r) =>
    `- ${r.tag_name} (${r.published_at?.split("T")[0] ?? "unknown"}): ${r.name ?? r.tag_name}`
  ).join("\n");

  const formatInstructions =
    format === "keepachangelog"
      ? `Use the Keep a Changelog format (https://keepachangelog.com). Structure:
## [version] - YYYY-MM-DD
### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security`
      : format === "conventional"
      ? `Use Conventional Commits changelog format. Group by type (feat, fix, perf, etc.) with scopes. Include breaking changes prominently at the top.`
      : `Write a narrative changelog — flowing prose paragraphs grouped by theme, not bullet lists. Make it readable like a blog post release note.`;

  const systemPrompt =
    "You are a senior developer writing professional, human-friendly changelogs. You transform raw commit data into clear, useful release notes that developers and users will actually read. You highlight breaking changes, new features, and important fixes. You never pad with filler.";

  const userPrompt = `Generate a professional CHANGELOG entry for the GitHub repository "${repo}".

${formatInstructions}

## Repository Context
- **Version/tag:** ${latestTag}${previousTag ? ` (previous: ${previousTag})` : ""}
- **Date range:** ${dateRange}
- **Total commits analyzed:** ${parsedCommits.length}
- **Contributors:** ${uniqueAuthors.slice(0, 10).join(", ")}${uniqueAuthors.length > 10 ? ` (+${uniqueAuthors.length - 10} more)` : ""}
- **Breaking changes:** ${breakingChanges.length}

${releases.length > 0 ? `## Recent Release History\n${releaseHistory}\n` : ""}

## Commit Groups
${commitSummaryLines.join("\n")}

${breakingChanges.length > 0
  ? `## Breaking Changes Detail\n${breakingChanges.map((c) => `- ${c.scope ? `**${c.scope}:** ` : ""}${c.subject} (${c.sha})`).join("\n")}`
  : ""}

## Instructions
- Lead with breaking changes if any exist
- Group related commits into meaningful themes — don't just repeat the raw messages
- Improve commit message wording to be user-facing and clear
- Skip trivial commits (formatting, whitespace, typo fixes in comments) unless they're numerous
- Include the version header and date
- Output ONLY the raw changelog markdown. No preamble or explanation.`;

  try {
    const result = await callAI({
      plan,
      systemPrompt,
      userPrompt,
      maxTokens: 1024,
    });

    if (!result) {
      return NextResponse.json({ error: "AI generation failed — no provider available" }, { status: 500 });
    }

    return NextResponse.json({
      changelog: result.text,
      repo,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      meta: {
        commitsAnalyzed: parsedCommits.length,
        dateRange,
        version: latestTag,
        breakingChanges: breakingChanges.length,
        contributors: uniqueAuthors.length,
        format,
        groups: Object.fromEntries(
          Object.entries(grouped).map(([k, v]) => [k, v.length])
        ),
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.error("[AI generate-changelog]", err);
    return NextResponse.json({ error: "Changelog generation failed" }, { status: 500 });
  }
}

export const POST = withRouteSecurity(handler, SecurityPresets.ai);
