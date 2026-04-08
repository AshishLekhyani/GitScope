export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { resolveAiPlanFromSessionDb, getCapabilitiesForPlan } from "@/lib/ai-plan";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { analyzeWithInternalAI } from "@/lib/internal-ai";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CodeReviewFinding {
  severity: "critical" | "high" | "medium" | "low";
  category: "security" | "performance" | "logic" | "quality" | "breaking" | "testing" | "style";
  file?: string;
  line?: number;
  description: string;
  suggestion: string;
  codeSnippet?: string;
}

export interface CodeReviewResult {
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  confidence: number;
  summary: string;
  mergeRisk: "low" | "medium" | "high" | "critical";
  scores: {
    security: number;
    value: number;
    quality: number;
    testCoverage: number;
    breakingRisk: number;
  };
  flags: string[];
  findings: CodeReviewFinding[];
  breakingChanges: string[];
  securityIssues: string[];
  positives: string[];
  recommendation: string;
  reviewChecklist: string[];
  estimatedReviewTime: string;
  suggestedReviewers: number;
  impactAreas: string[];
  affectedSystems: string[];
  diffStats: {
    fileCount: number;
    additions: number;
    deletions: number;
    hotFiles: string[];
  };
  model: string;
  isDemo: boolean;
}

// ── GitHub helpers ────────────────────────────────────────────────────────────

interface GHFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface GHPRMeta {
  title: string;
  body: string | null;
  state: string;
  user: { login: string };
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable_state: string;
  draft: boolean;
  labels: Array<{ name: string }>;
  requested_reviewers: Array<{ login: string }>;
}

interface GHCommitMeta {
  commit: { message: string; author: { name: string; date: string } };
  author?: { login: string; avatar_url: string };
  stats?: { additions: number; deletions: number; total: number };
  files?: GHFile[];
}

interface GHRepoBrief {
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  topics: string[];
}

async function ghFetch<T>(path: string, token: string | null): Promise<T | null> {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ── AI Prompt ────────────────────────────────────────────────────────────────

function buildPRPrompt(params: {
  repo: string;
  repoBrief: GHRepoBrief | null;
  prMeta: GHPRMeta;
  prNumber: number;
  files: GHFile[];
  scanMode: string;
}): string {
  const { repo, repoBrief, prMeta, prNumber, files, scanMode } = params;
  const totalDiff = files.reduce((a, f) => a + (f.patch?.length ?? 0), 0);

  const fileSummaries = files
    .slice(0, scanMode === "deep" ? 20 : 10)
    .map((f) => {
      const patchSnippet =
        f.patch && scanMode === "deep"
          ? `\n\`\`\`diff\n${f.patch.slice(0, 1200)}\n\`\`\``
          : "";
      return `- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})${patchSnippet}`;
    })
    .join("\n");

  return `You are an elite AI code reviewer — a principal engineer + security researcher combined.
Analyze this Pull Request and return ONLY a valid JSON object. No markdown. No preamble. ONLY JSON.

REPOSITORY: ${repo}
Language: ${repoBrief?.language ?? "Unknown"} | Stars: ${repoBrief?.stargazers_count ?? 0} | ${repoBrief?.description ?? "No description"}

PULL REQUEST #${prNumber}: "${prMeta.title}"
Author: ${prMeta.user.login}${prMeta.draft ? " (DRAFT)" : ""}
State: ${prMeta.state} | Mergeable: ${prMeta.mergeable_state}
Labels: ${prMeta.labels.map((l) => l.name).join(", ") || "none"}
Stats: +${prMeta.additions} lines added, -${prMeta.deletions} lines removed, ${prMeta.changed_files} files changed
Total diff size: ~${Math.round(totalDiff / 1024)}KB

Description:
${prMeta.body?.slice(0, 800) ?? "(no description provided)"}

Changed Files:
${fileSummaries}

Return this exact JSON structure (all fields required):
{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "confidence": <0-100 integer>,
  "summary": "<2-3 sentence executive summary>",
  "mergeRisk": "low" | "medium" | "high" | "critical",
  "scores": {
    "security": <0-100, higher=safer>,
    "value": <0-100, how valuable/impactful is this change>,
    "quality": <0-100, code quality and best practices>,
    "testCoverage": <0-100, estimated test coverage of changed code>,
    "breakingRisk": <0-100, higher=more likely to break things>
  },
  "flags": [<array of applicable: "security","breaking-change","performance","deps","auth","database","api-contract","large-diff","test-coverage","config","logic-error","style">],
  "findings": [
    {
      "severity": "critical"|"high"|"medium"|"low",
      "category": "security"|"performance"|"logic"|"quality"|"breaking"|"testing"|"style",
      "file": "<filename or null>",
      "line": <line number or null>,
      "description": "<specific, actionable description>",
      "suggestion": "<concrete fix with example if possible>",
      "codeSnippet": "<the problematic code line or null>"
    }
  ],
  "breakingChanges": ["<specific breaking change description>"],
  "securityIssues": ["<specific security concern>"],
  "positives": ["<what this PR does well, 2-4 items>"],
  "recommendation": "<2-3 sentence merge recommendation with specific action items>",
  "reviewChecklist": ["<specific thing reviewer must verify>"],
  "estimatedReviewTime": "<e.g. '15 min' or '2 hours'>",
  "suggestedReviewers": <integer 1-5>,
  "impactAreas": ["<e.g. authentication, database, API, frontend>"],
  "affectedSystems": ["<e.g. Backend API, Database, Auth Service>"],
  "diffStats": {
    "fileCount": ${prMeta.changed_files},
    "additions": ${prMeta.additions},
    "deletions": ${prMeta.deletions},
    "hotFiles": ["<top 3-5 most critical/risky files changed>"]
  }
}`;
}

function buildCommitPrompt(params: {
  repo: string;
  repoBrief: GHRepoBrief | null;
  commit: GHCommitMeta;
  sha: string;
  scanMode: string;
}): string {
  const { repo, repoBrief, commit, sha, scanMode } = params;
  const files = commit.files ?? [];

  const fileSummaries = files
    .slice(0, scanMode === "deep" ? 20 : 10)
    .map((f) => {
      const patchSnippet =
        f.patch && scanMode === "deep"
          ? `\n\`\`\`diff\n${f.patch.slice(0, 1200)}\n\`\`\``
          : "";
      return `- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})${patchSnippet}`;
    })
    .join("\n");

  return `You are an elite AI code reviewer. Analyze this commit and return ONLY valid JSON. No markdown. ONLY JSON.

REPOSITORY: ${repo}
Language: ${repoBrief?.language ?? "Unknown"} | ${repoBrief?.description ?? "No description"}

COMMIT: ${sha.slice(0, 10)}
Author: ${commit.author?.login ?? commit.commit.author.name}
Date: ${commit.commit.author.date}
Message: "${commit.commit.message.slice(0, 500)}"
Stats: +${commit.stats?.additions ?? 0} -${commit.stats?.deletions ?? 0} (${files.length} files)

Changed Files:
${fileSummaries || "(no file data available)"}

Return this exact JSON (all fields required):
{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "confidence": <0-100>,
  "summary": "<2-3 sentence executive summary of what this commit does and whether it should be accepted>",
  "mergeRisk": "low" | "medium" | "high" | "critical",
  "scores": {
    "security": <0-100>,
    "value": <0-100>,
    "quality": <0-100>,
    "testCoverage": <0-100>,
    "breakingRisk": <0-100>
  },
  "flags": [<applicable flags>],
  "findings": [{ "severity": "...", "category": "...", "file": "...", "line": null, "description": "...", "suggestion": "...", "codeSnippet": null }],
  "breakingChanges": [],
  "securityIssues": [],
  "positives": [],
  "recommendation": "<specific actionable recommendation>",
  "reviewChecklist": [],
  "estimatedReviewTime": "<time>",
  "suggestedReviewers": <1-5>,
  "impactAreas": [],
  "affectedSystems": [],
  "diffStats": {
    "fileCount": ${files.length},
    "additions": ${commit.stats?.additions ?? 0},
    "deletions": ${commit.stats?.deletions ?? 0},
    "hotFiles": []
  }
}`;
}

// ── Demo data ────────────────────────────────────────────────────────────────

function getDemoResult(repo: string, prNumber?: number): CodeReviewResult {
  return {
    verdict: "REQUEST_CHANGES",
    confidence: 84,
    summary: `This ${prNumber ? `PR #${prNumber}` : "commit"} in ${repo} introduces significant changes to the authentication flow with notable security implications. The implementation adds valuable OAuth integration but contains two critical vulnerabilities that must be addressed before merging. The overall code quality is solid with good separation of concerns.`,
    mergeRisk: "high",
    scores: { security: 38, value: 82, quality: 71, testCoverage: 45, breakingRisk: 68 },
    flags: ["security", "auth", "breaking-change", "test-coverage"],
    findings: [
      {
        severity: "critical",
        category: "security",
        file: "src/auth/oauth-callback.ts",
        line: 47,
        description: "OAuth state parameter is not validated in the callback handler, making this endpoint vulnerable to CSRF attacks during the OAuth flow.",
        suggestion: 'Add state validation: const expectedState = req.session.oauthState; if (state !== expectedState) return res.status(403).json({ error: "State mismatch" });',
        codeSnippet: "const { code } = req.query; // state parameter not checked",
      },
      {
        severity: "high",
        category: "security",
        file: "src/auth/token-handler.ts",
        line: 112,
        description: "Access token is written to application logs in plaintext, creating a credential exposure risk in log aggregation systems.",
        suggestion: "Remove token from logs or replace with a masked version: logger.info({ tokenMasked: token.slice(0, 8) + '...' })",
        codeSnippet: "console.log('Token received:', accessToken)",
      },
      {
        severity: "medium",
        category: "breaking",
        file: "src/api/user.ts",
        line: 88,
        description: "The /api/user/profile endpoint response shape changed — removed 'displayName' field — which will break existing frontend consumers.",
        suggestion: "Keep 'displayName' as a deprecated alias for 'name' for one release cycle, or version the API endpoint.",
        codeSnippet: "return { name: user.name, email: user.email }; // displayName removed",
      },
      {
        severity: "medium",
        category: "testing",
        file: "src/auth/oauth-callback.ts",
        description: "The new OAuth callback handler has no test coverage for error cases (invalid code, expired token, revoked access).",
        suggestion: "Add unit tests covering: invalid state, expired authorization code, revoked OAuth token, and provider API failures.",
      },
    ],
    breakingChanges: [
      "API response shape change: /api/user/profile drops 'displayName' field",
      "Database migration adds NOT NULL column 'oauth_provider' — will fail on existing rows without default",
    ],
    securityIssues: [
      "OAuth state parameter not validated (CSRF vulnerability in auth flow)",
      "Access token written to application logs in plaintext",
      "Token expiry is not checked before making API calls with the token",
    ],
    positives: [
      "Proper use of PKCE flow — correctly implements code challenge/verifier",
      "Access tokens stored in httpOnly cookies (not localStorage)",
      "Good TypeScript types for the OAuth provider interface",
      "Database token storage uses encryption (AES-256)",
    ],
    recommendation:
      "Request changes on two security issues before merge: (1) add OAuth state parameter validation to prevent CSRF, and (2) remove/mask the access token from application logs. Also add a default value for the DB migration column. ETA for fixes: ~2 hours.",
    reviewChecklist: [
      "Verify OAuth state parameter is generated, stored in session, and validated on callback",
      "Confirm access token is NOT logged anywhere in the auth flow",
      "Test DB migration with existing data — confirm default value for oauth_provider column",
      "Validate that /api/user/profile consumers are updated or backward compatibility is preserved",
      "Run end-to-end OAuth flow test with an actual provider (GitHub or Google)",
      "Check token refresh logic handles 401 responses from downstream APIs",
    ],
    estimatedReviewTime: "45 min",
    suggestedReviewers: 3,
    impactAreas: ["authentication", "user-data", "API", "database"],
    affectedSystems: ["Backend API", "Auth Service", "Database", "Frontend Auth Flow"],
    diffStats: {
      fileCount: 14,
      additions: 387,
      deletions: 124,
      hotFiles: [
        "src/auth/oauth-callback.ts",
        "src/auth/token-handler.ts",
        "prisma/migrations/20260408_oauth.sql",
        "src/api/user.ts",
        "src/middleware/auth.ts",
      ],
    },
    model: "demo",
    isDemo: true,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    repo?: string;
    prNumber?: number;
    commitSha?: string;
    scanMode?: string;
    analysisType?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { repo, prNumber, commitSha, scanMode = "quick", analysisType = "pr" } = body;

  if (!repo || typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return new Response(JSON.stringify({ error: "Invalid repo format. Use owner/repo" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (analysisType === "pr" && !prNumber) {
    return new Response(JSON.stringify({ error: "prNumber required for PR analysis" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (analysisType === "commit" && !commitSha) {
    return new Response(JSON.stringify({ error: "commitSha required for commit analysis" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  const budget = await consumeUsageBudget({
    userId: session.user.id,
    feature: "code-review",
    plan,
    limit: Math.max(5, Math.floor(caps.aiRequestsPerHour / 4)),
    metadata: { repo, prNumber, commitSha, scanMode },
  });

  if (!budget.allowed) {
    return new Response(
      JSON.stringify({ error: "Code review limit reached for this hour. Upgrade your plan for more reviews." }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Stream setup ──────────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client disconnected
        }
      };

      const done = (result?: CodeReviewResult, error?: string) => {
        emit({ type: "done", result, error });
        try { controller.close(); } catch { /* already closed */ }
      };

      try {
        // ── Phase 1: Get GitHub token ─────────────────────────────────────
        emit({ type: "progress", step: "Authenticating with GitHub…", percent: 8 });

        const { token: ghToken, source: tokenSource } =
          await getGitHubTokenWithSource({ session });

        if (!ghToken && !caps.allowSharedTokenFallback) {
          // Try env token as fallback
        }

        // ── Phase 2: Fetch repo metadata ──────────────────────────────────
        emit({ type: "progress", step: "Fetching repository metadata…", percent: 15 });

        const repoBrief = await ghFetch<GHRepoBrief>(`/repos/${repo}`, ghToken);

        if (!repoBrief) {
          const errMsg =
            tokenSource === "none"
              ? "Repository not found. For private repos, connect your GitHub account in Settings."
              : "Repository not found or access denied. Ensure your GitHub account has access.";
          done(undefined, errMsg);
          return;
        }

        // Check private repo access for free tier
        if (!caps.allowsPrivateRepoAnalysis && tokenSource === "none") {
          emit({ type: "progress", step: "Verifying access…", percent: 20 });
        }

        let result: CodeReviewResult;

        if (analysisType === "pr" && prNumber) {
          // ── PR Analysis ───────────────────────────────────────────────
          emit({ type: "progress", step: `Fetching PR #${prNumber} metadata…`, percent: 25 });

          const prMeta = await ghFetch<GHPRMeta>(
            `/repos/${repo}/pulls/${prNumber}`,
            ghToken
          );

          if (!prMeta) {
            done(undefined, `PR #${prNumber} not found or not accessible.`);
            return;
          }

          emit({ type: "progress", step: "Fetching changed files and diffs…", percent: 40 });

          const maxFiles = scanMode === "deep" ? caps.maxFilesPerDeepScan : 10;
          const files =
            (await ghFetch<GHFile[]>(
              `/repos/${repo}/pulls/${prNumber}/files?per_page=${maxFiles}`,
              ghToken
            )) ?? [];

          emit({ type: "progress", step: "Building AI context…", percent: 55 });

          // ── Always run internal AI first (fast, no API key needed) ──
          emit({ type: "progress", step: "Running internal static analysis…", percent: 60 });
          const internalResult = analyzeWithInternalAI({
            repo, analysisType: "pr", prMeta, files, prNumber,
          });

          if (!process.env.ANTHROPIC_API_KEY) {
            emit({ type: "progress", step: "Static analysis complete…", percent: 90 });
            result = internalResult;
          } else {
            emit({ type: "progress", step: "Enhancing with deep AI analysis…", percent: 68 });

            const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const model =
              plan === "enterprise"
                ? "claude-opus-4-6"
                : plan === "team" || plan === "professional"
                  ? "claude-sonnet-4-6"
                  : "claude-haiku-4-5-20251001";

            const prompt = buildPRPrompt({ repo, repoBrief, prMeta, prNumber, files, scanMode });
            emit({ type: "progress", step: "AI analyzing patterns and security vectors…", percent: 78 });

            try {
              const message = await client.messages.create({
                model,
                max_tokens: 4096,
                messages: [{ role: "user", content: prompt }],
                system: "You are an elite AI code reviewer. Return ONLY valid JSON — no markdown fences, no explanations.",
              });
              const text = message.content[0]?.type === "text" ? message.content[0].text : "{}";
              const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
              result = JSON.parse(cleaned) as CodeReviewResult;
              result.model = model;
              result.isDemo = false;
              // Merge internal findings that the LLM might have missed
              const llmFindingDescs = new Set(result.findings.map((f) => f.description.slice(0, 40)));
              const extraFindings = internalResult.findings.filter(
                (f) => !llmFindingDescs.has(f.description.slice(0, 40))
              );
              result.findings = [...result.findings, ...extraFindings].slice(0, 12);
              await prisma.codeReviewScan.create({
                data: {
                  userId: session.user.id, repo, prNumber, scanMode, analysisType: "pr",
                  result: JSON.parse(JSON.stringify(result)),
                  tokensUsed: (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0),
                },
              });
            } catch {
              // LLM failed — internal AI result is still valuable
              result = internalResult;
            }
          }
        } else {
          // ── Commit Analysis ────────────────────────────────────────────
          emit({ type: "progress", step: `Fetching commit ${commitSha?.slice(0, 8)}…`, percent: 25 });

          const commit = await ghFetch<GHCommitMeta>(
            `/repos/${repo}/commits/${commitSha}`,
            ghToken
          );

          if (!commit) {
            done(undefined, "Commit not found or not accessible.");
            return;
          }

          emit({ type: "progress", step: "Analyzing commit diff…", percent: 50 });

          // ── Always run internal AI first ──
          emit({ type: "progress", step: "Running static analysis…", percent: 58 });
          const internalCommitResult = analyzeWithInternalAI({
            repo, analysisType: "commit", commitMeta: commit, files: commit.files ?? [], sha: commitSha,
          });

          if (!process.env.ANTHROPIC_API_KEY) {
            emit({ type: "progress", step: "Analysis complete…", percent: 90 });
            result = internalCommitResult;
          } else {
            emit({ type: "progress", step: "Enhancing with AI analysis…", percent: 68 });

            const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const model =
              plan === "enterprise" ? "claude-opus-4-6" :
              plan === "professional" || plan === "team" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";

            const prompt = buildCommitPrompt({ repo, repoBrief, commit, sha: commitSha!, scanMode });

            try {
              const message = await client.messages.create({
                model, max_tokens: 3072,
                messages: [{ role: "user", content: prompt }],
                system: "You are an elite AI code reviewer. Return ONLY valid JSON — no markdown fences, no explanations.",
              });
              const text = message.content[0]?.type === "text" ? message.content[0].text : "{}";
              const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
              result = JSON.parse(cleaned) as CodeReviewResult;
              result.model = model;
              result.isDemo = false;
              await prisma.codeReviewScan.create({
                data: {
                  userId: session.user.id, repo, commitSha, scanMode, analysisType: "commit",
                  result: JSON.parse(JSON.stringify(result)),
                  tokensUsed: (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0),
                },
              });
            } catch {
              result = internalCommitResult;
            }
          }
        }

        emit({ type: "progress", step: "Finalizing report…", percent: 95 });
        done(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Analysis failed";
        if (process.env.NODE_ENV !== "production") {
          console.error("[code-review]", err);
        }
        done(undefined, message);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
