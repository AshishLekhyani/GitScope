export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { resolveAiPlanFromSessionDb, getCapabilitiesForPlan } from "@/lib/ai-plan";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { prisma } from "@/lib/prisma";
import { analyzeWithInternalAI } from "@/lib/internal-ai";
import { callAI, hasAnyAIProvider, type AIPlan } from "@/lib/ai-providers";
import { getUserBYOKKeys } from "@/lib/byok";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CodeReviewFinding {
  severity: "critical" | "high" | "medium" | "low";
  category: "security" | "performance" | "logic" | "quality" | "breaking" | "testing" | "style";
  file?: string;
  line?: number;
  description: string;
  suggestion: string;
  codeSnippet?: string;
  fix?: {
    before: string;
    after: string;
    language?: string;
  };
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

async function ghFetchText(path: string, token: string | null): Promise<string | null> {
  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

// ── AI Prompt ────────────────────────────────────────────────────────────────

const CODE_REVIEW_SYSTEM_PROMPT = `You are GitScope's senior AI code reviewer — a principal engineer with 15+ years of hands-on expertise:
• Security engineering: OWASP Top 10, injection attacks, auth flaws, cryptography, supply-chain, CVE analysis, timing attacks, path traversal
• Backend: Node.js, Python, Go, Rust — APIs, databases, caching, message queues, distributed systems, race conditions
• Frontend: React, Next.js, performance, accessibility, bundle size, Core Web Vitals, XSS, CSRF
• DevOps: Docker, Kubernetes, CI/CD pipelines, cloud platforms, IaC, secrets management, supply chain
• Database: SQL/NoSQL design, query optimization, indexing, migration safety, N+1 queries, replication
• Architecture: microservices, monoliths, serverless, event-driven, CQRS, DDD patterns, API contracts
• Code quality: SOLID principles, design patterns, refactoring, tech debt, cyclomatic complexity, naming
• Network: TLS/SSL, HTTP/2, WebSockets, rate limiting, proxies, CDN, CORS

CRITICAL RULES — follow exactly:
1. SPECIFICITY: Every finding description must name the EXACT function, variable, or line pattern. BAD: "Missing input validation". GOOD: "The createUser() handler in src/api/users.ts at ~line 47 passes req.body.email directly to prisma.user.create() without sanitisation — a malformed email crashes the ORM"
2. SUGGESTIONS WITH CODE: Every suggestion must show the corrected snippet or exact command. BAD: "Add validation". GOOD: "Add: const email = z.string().email().parse(req.body.email) before the prisma call"
3. EVIDENCE ONLY: Only flag issues that are directly visible in the diff or full file contents provided. Never speculate.
4. FILE ACCURACY: finding.file must be the exact filename from the diff (e.g. "src/api/users.ts"). Never write "various files".
5. DEDUP: If the same pattern appears in 3 files, write ONE finding listing all 3 in the description — not 3 separate findings.
6. You return ONLY valid JSON. No markdown fences, no preamble, no trailing text.
7. FALSE POSITIVE AVOIDANCE — never flag:
   • Error message strings as hardcoded credentials. e.g. token: "The link is missing a token." is an error message, NOT a secret. Real credentials have no spaces and are hex/base64/alphanumeric.
   • JSX label or UI display text that contains words like "key", "token", "password" — these are user-facing strings, not security issues.
   • Files that define security analysis rules (e.g. internal-ai.ts, vuln_patterns.py) — their regex patterns and example bad-code snippets are intentional, not actual vulnerabilities.
   • Test files — hardcoded fixture values, mock credentials, and test tokens in *.test.ts / *.spec.ts files are intentional and expected.
   • Type annotations or interface field names (e.g. password?: string) — these are type definitions, not actual credential storage.
   • Import paths or require() calls that happen to contain words like "auth", "secret", or "token" — these are module names, not sensitive values.`;

function buildPRPrompt(params: {
  repo: string;
  repoBrief: GHRepoBrief | null;
  prMeta: GHPRMeta;
  prNumber: number;
  files: GHFile[];
  scanMode: string;
  fileContents?: Record<string, string>;
}): string {
  const { repo, repoBrief, prMeta, prNumber, files, scanMode, fileContents = {} } = params;
  const totalDiff = files.reduce((a, f) => a + (f.patch?.length ?? 0), 0);
  const isDeep = scanMode === "deep";

  // Always include diffs — more chars in deep mode
  const fileSections = files
    .slice(0, isDeep ? 25 : 12)
    .map((f) => {
      const diff = f.patch
        ? `\n\`\`\`diff\n${f.patch.slice(0, isDeep ? 2500 : 800)}\n\`\`\``
        : "";
      return `### ${f.filename} (${f.status}, +${f.additions} -${f.deletions})${diff}`;
    })
    .join("\n\n");

  const skipped = files.length - (isDeep ? 25 : 12);

  // Full file contents for important files (beyond just the diff)
  const fullFileSection = Object.keys(fileContents).length > 0
    ? `\n## Full File Contents (key changed files — use for deeper context)\n` +
      Object.entries(fileContents)
        .map(([name, content]) => `\n### ${name}\n\`\`\`\n${content}\n\`\`\``)
        .join("\n")
    : "";

  return `Analyze this Pull Request. Return ONLY valid JSON matching the schema at the end — no preamble, no markdown.

## Repository
${repo} | Language: ${repoBrief?.language ?? "Unknown"} | Stars: ${repoBrief?.stargazers_count ?? 0}
${repoBrief?.description ? `Description: ${repoBrief.description}` : ""}

## Pull Request #${prNumber}: "${prMeta.title}"
Author: ${prMeta.user.login}${prMeta.draft ? " [DRAFT]" : ""}
State: ${prMeta.state} | Mergeable: ${prMeta.mergeable_state ?? "unknown"}
Labels: ${prMeta.labels.map((l) => l.name).join(", ") || "none"}
Stats: +${prMeta.additions} added / -${prMeta.deletions} removed across ${prMeta.changed_files} files (~${Math.round(totalDiff / 1024)}KB diff)

PR Description:
${prMeta.body?.slice(0, 1200) ?? "(no description provided)"}

## Changed Files with Diffs
${fileSections}
${skipped > 0 ? `\n_(${skipped} additional file${skipped > 1 ? "s" : ""} not shown — focus on the files above)_` : ""}
${fullFileSection}

## Instructions — MANDATORY
- Read every diff line before scoring. Do not skim.
- SPECIFICITY: Name the exact function/variable/line in every finding. "The validateToken() function at line ~23 in src/middleware/auth.ts uses a timing-unsafe string comparison" not "auth middleware has timing issues"
- SUGGESTION CODE: Include a corrected snippet in every suggestion. Show the fix, not just the principle.
- EVIDENCE ONLY: Flag only what is directly visible in the diffs and file contents above. No speculation.
- DEDUP: Group identical patterns from multiple files into one finding. List all affected files in description.
- IMPACT FOCUS: Prioritise critical/high findings. Include low/medium only if they have real production consequence.
- testCoverage score: 0 if no tests in diff; scale to 100 based on how thoroughly the implementation is tested.

## JSON Schema (return exactly this, all fields required)
{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "confidence": <0-100>,
  "summary": "<3-4 sentence executive summary — what the PR does, quality signal, merge recommendation>",
  "mergeRisk": "low" | "medium" | "high" | "critical",
  "scores": {
    "security": <0-100, higher=safer>,
    "value": <0-100, impact and usefulness of this change>,
    "quality": <0-100, code quality and best practices>,
    "testCoverage": <0-100, how well the change is tested>,
    "breakingRisk": <0-100, higher=more likely to break existing behaviour>
  },
  "flags": [<from: "security","breaking-change","performance","deps","auth","database","api-contract","large-diff","test-coverage","config","logic-error","style","security-fix">],
  "findings": [
    {
      "severity": "critical"|"high"|"medium"|"low",
      "category": "security"|"performance"|"logic"|"quality"|"breaking"|"testing"|"style",
      "file": "<exact filename from the diff — e.g. src/api/users.ts>",
      "line": <approximate line number or null>,
      "description": "<MUST name the exact function/variable/pattern — e.g. 'createUser() in src/api/users.ts passes unsanitised req.body.email to prisma'>",
      "suggestion": "<MUST include corrected code snippet or exact command — e.g. 'const email = z.string().email().parse(req.body.email)'>",
      "codeSnippet": "<the exact problematic line or expression from the diff, max 140 chars>"
    }
  ],
  "breakingChanges": ["<specific breaking change with migration path>"],
  "securityIssues": ["<one-line security concern referencing file/pattern>"],
  "positives": ["<specific good practice observed in the diff, 2-5 items>"],
  "recommendation": "<2-3 sentences — merge decision with specific conditions or action items>",
  "reviewChecklist": ["<concrete thing a human reviewer must verify before merging>"],
  "estimatedReviewTime": "<e.g. '20 min' or '1.5h'>",
  "suggestedReviewers": <1-5>,
  "impactAreas": ["<e.g. authentication, database, REST API, React UI>"],
  "affectedSystems": ["<e.g. Auth Service, PostgreSQL, CDN, Background Jobs>"],
  "diffStats": {
    "fileCount": ${prMeta.changed_files},
    "additions": ${prMeta.additions},
    "deletions": ${prMeta.deletions},
    "hotFiles": ["<3-5 highest-risk or most-changed files>"]
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
  const isDeep = scanMode === "deep";

  const fileSections = files
    .slice(0, isDeep ? 20 : 10)
    .map((f) => {
      const diff = f.patch
        ? `\n\`\`\`diff\n${f.patch.slice(0, isDeep ? 2000 : 900)}\n\`\`\``
        : "";
      return `### ${f.filename} (${f.status}, +${f.additions} -${f.deletions})${diff}`;
    })
    .join("\n\n");

  const skipped = files.length - (isDeep ? 20 : 10);

  return `Analyze this git commit. Return ONLY valid JSON — no markdown, no preamble.

## Repository
${repo} | Language: ${repoBrief?.language ?? "Unknown"}
${repoBrief?.description ? `Description: ${repoBrief.description}` : ""}

## Commit ${sha.slice(0, 12)}
Author: ${commit.author?.login ?? commit.commit.author.name}
Date: ${commit.commit.author.date}
Message:
"${commit.commit.message.slice(0, 600)}"

Stats: +${commit.stats?.additions ?? 0} / -${commit.stats?.deletions ?? 0} (${files.length} files)

## Changed Files with Diffs
${fileSections || "(no diff data available — analyse based on stats and message)"}
${skipped > 0 ? `\n_(${skipped} additional file${skipped > 1 ? "s" : ""} not shown)_` : ""}

## Instructions
- Evaluate the commit based on the actual diff lines above
- Check for security issues, logic errors, breaking changes, and quality
- Cite exact filenames and code patterns in findings
- Score testCoverage as 0 if no test files changed

## JSON Schema (all fields required)
{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "confidence": <0-100>,
  "summary": "<2-3 sentences — what the commit does, quality, and whether it is safe to keep>",
  "mergeRisk": "low" | "medium" | "high" | "critical",
  "scores": {
    "security": <0-100>,
    "value": <0-100>,
    "quality": <0-100>,
    "testCoverage": <0-100>,
    "breakingRisk": <0-100>
  },
  "flags": ["<applicable flags>"],
  "findings": [
    {
      "severity": "critical"|"high"|"medium"|"low",
      "category": "security"|"performance"|"logic"|"quality"|"breaking"|"testing"|"style",
      "file": "<filename>",
      "line": null,
      "description": "<specific, evidence-based description>",
      "suggestion": "<concrete fix with code example>",
      "codeSnippet": "<exact snippet from diff, max 120 chars>"
    }
  ],
  "breakingChanges": ["<specific breaking change>"],
  "securityIssues": ["<security concern with filename>"],
  "positives": ["<good practice observed>"],
  "recommendation": "<2 sentences — keep, revert, or fix — with specific actions>",
  "reviewChecklist": ["<thing to verify>"],
  "estimatedReviewTime": "<e.g. '10 min'>",
  "suggestedReviewers": <1-5>,
  "impactAreas": ["<impacted area>"],
  "affectedSystems": ["<affected system>"],
  "diffStats": {
    "fileCount": ${files.length},
    "additions": ${commit.stats?.additions ?? 0},
    "deletions": ${commit.stats?.deletions ?? 0},
    "hotFiles": ["<most-changed or highest-risk files>"]
  }
}`;
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
  const byokKeys = await getUserBYOKKeys(session.user.id);
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

          emit({ type: "progress", step: "Fetching changed files and diffs…", percent: 38 });

          const maxFiles = scanMode === "deep" ? caps.maxFilesPerDeepScan : 12;
          const files =
            (await ghFetch<GHFile[]>(
              `/repos/${repo}/pulls/${prNumber}/files?per_page=${maxFiles}`,
              ghToken
            )) ?? [];

          // Fetch full file contents for the most important changed files
          // This gives the AI (and internal analyzer) real context beyond just the diff
          const codeExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".cs"];
          const keyChangedFiles = files
            .filter((f) => codeExtensions.some((ext) => f.filename.endsWith(ext)) && f.status !== "removed")
            .slice(0, scanMode === "deep" ? 10 : 5);

          const fileContents: Record<string, string> = {};
          for (let i = 0; i < keyChangedFiles.length; i++) {
            const f = keyChangedFiles[i];
            const shortName = f.filename.split("/").slice(-2).join("/");
            emit({ type: "progress", step: `Reading ${shortName}…`, percent: Math.round(42 + (i / keyChangedFiles.length) * 12) });
            const content = await ghFetchText(`/repos/${repo}/contents/${f.filename}`, ghToken);
            if (content) fileContents[f.filename] = content.slice(0, scanMode === "deep" ? 3000 : 1500);
          }

          emit({ type: "progress", step: `Analyzed ${files.length} changed files — building context…`, percent: 56 });

          // ── Always run internal AI first (fast, no API key needed) ──
          emit({ type: "progress", step: "Running internal static analysis…", percent: 60 });
          const internalResult = analyzeWithInternalAI({
            repo, analysisType: "pr", prMeta, files, prNumber,
          });

          if (!hasAnyAIProvider()) {
            emit({ type: "progress", step: "Static analysis complete…", percent: 90 });
            result = internalResult;
          } else {
            emit({ type: "progress", step: "Enhancing with AI analysis…", percent: 68 });
            const prompt = buildPRPrompt({ repo, repoBrief, prMeta, prNumber, files, scanMode, fileContents });
            emit({ type: "progress", step: "AI analyzing patterns and security vectors…", percent: 78 });
            try {
              const aiRes = await callAI({
                plan: plan as AIPlan,
                byokKeys,
                systemPrompt: CODE_REVIEW_SYSTEM_PROMPT,
                userPrompt: prompt,
                maxTokens: 4096,
              });
              if (aiRes) {
                const cleaned = aiRes.text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
                result = JSON.parse(cleaned) as CodeReviewResult;
                result.model = aiRes.model;
                result.isDemo = false;
                const llmDescs = new Set(result.findings.map((f) => f.description.slice(0, 40)));
                const extra = internalResult.findings.filter((f) => !llmDescs.has(f.description.slice(0, 40)));
                result.findings = [...result.findings, ...extra].slice(0, 12);
                await prisma.codeReviewScan.create({
                  data: {
                    userId: session.user.id, repo, prNumber, scanMode, analysisType: "pr",
                    result: JSON.parse(JSON.stringify(result)),
                    tokensUsed: aiRes.inputTokens + aiRes.outputTokens,
                  },
                });
              } else {
                result = internalResult;
              }
            } catch {
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

          if (!hasAnyAIProvider()) {
            emit({ type: "progress", step: "Analysis complete…", percent: 90 });
            result = internalCommitResult;
          } else {
            emit({ type: "progress", step: "Enhancing with AI analysis…", percent: 68 });
            const prompt = buildCommitPrompt({ repo, repoBrief, commit, sha: commitSha!, scanMode });
            try {
              const aiRes = await callAI({
                plan: plan as AIPlan,
                byokKeys,
                systemPrompt: CODE_REVIEW_SYSTEM_PROMPT,
                userPrompt: prompt,
                maxTokens: 3072,
              });
              if (aiRes) {
                const cleaned = aiRes.text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
                result = JSON.parse(cleaned) as CodeReviewResult;
                result.model = aiRes.model;
                result.isDemo = false;
                await prisma.codeReviewScan.create({
                  data: {
                    userId: session.user.id, repo, commitSha, scanMode, analysisType: "commit",
                    result: JSON.parse(JSON.stringify(result)),
                    tokensUsed: aiRes.inputTokens + aiRes.outputTokens,
                  },
                });
              } else {
                result = internalCommitResult;
              }
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
