export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { resolveAiPlanFromSessionDb, getCapabilitiesForPlan } from "@/lib/ai-plan";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { prisma } from "@/lib/prisma";
import { scanRepoWithInternalAI } from "@/lib/internal-ai";
import { callAI, hasAnyAIProvider, hasByokKey, type AIPlan, type UserBYOKKeys } from "@/lib/ai-providers";
import { getUserBYOKKeys } from "@/lib/byok";
import { runAgentOrchestrator, SECURITY_AGENT, ARCHITECTURE_AGENT, PERFORMANCE_AGENT, TESTING_AGENT, DEPENDENCY_AGENT, DEBT_AGENT, type AgentConfig } from "@/lib/ai-agents";
import { loadRepoKnowledge, saveRepoKnowledge, formatKnowledgeForPrompt } from "@/lib/repo-knowledge";
import { sendEmail, buildScanAlertEmail } from "@/lib/email";
import { sendScanAlert as sendSlackScanAlert } from "@/lib/slack";
import { sendDiscordScanAlert } from "@/lib/discord";
import { triggerWebhookRules } from "@/lib/webhook-rules-trigger";
import { checkPublicScanCache, savePublicScanCache } from "@/lib/scan-cache";

function normalizeJsonText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/```(?:json)?\s*\n([\s\S]*?)```/gi, "$1")
    .trim();
}

function extractBalancedJson(text: string, openChar: "{" | "[", closeChar: "}" | "]"): string | null {
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === openChar) {
      if (start === -1) start = i;
      depth++;
    } else if (ch === closeChar && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseJsonFromText(text: string | undefined): unknown {
  if (!text) return undefined;
  const normalized = normalizeJsonText(text);

  try {
    return JSON.parse(normalized);
  } catch {
    // ignore
  }

  for (const candidate of [
    extractBalancedJson(normalized, "{", "}"),
    extractBalancedJson(normalized, "[", "]"),
  ]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  return undefined;
}

function safeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function safeObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
}

function safeObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RepoScanFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: "security" | "performance" | "architecture" | "quality" | "deps" | "testing" | "config";
  file?: string;
  description: string;
  suggestion: string;
  fix?: {
    before: string;
    after: string;
    language?: string;
  };
}

export interface RepoScanResult {
  healthScore: number;
  summary: string;
  architecture: {
    summary: string;
    patterns: string[];
    strengths: string[];
    concerns: string[];
  };
  security: {
    score: number;
    grade: "A" | "B" | "C" | "D" | "F";
    issues: RepoScanFinding[];
    positives: string[];
  };
  codeQuality: {
    score: number;
    grade: "A" | "B" | "C" | "D" | "F";
    issues: RepoScanFinding[];
    strengths: string[];
  };
  performance: {
    score: number;
    grade: "A" | "B" | "C" | "D" | "F";
    issues: RepoScanFinding[];
    positives: string[];
  };
  testability: {
    score: number;
    grade: "A" | "B" | "C" | "D" | "F";
    hasTestFramework: boolean;
    coverageEstimate: string;
    gaps: string[];
  };
  dependencies: {
    score: number;
    totalCount: number;
    risks: string[];
    outdatedSignals: string[];
  };
  techDebt: {
    score: number;
    level: "minimal" | "manageable" | "significant" | "severe";
    hotspots: string[];
    estimatedHours: string;
  };
  recommendations: Array<{
    priority: "immediate" | "short-term" | "long-term";
    title: string;
    description: string;
    effort: "low" | "medium" | "high";
  }>;
  metrics: {
    primaryLanguage: string;
    fileCount: number;
    estimatedLoc: string;
    contributors: number;
    repoAge: string;
    openIssues: number;
    stars: number;
  };
  model: string;
  isDemo: boolean;
}

// ── GitHub helpers ─────────────────────────────────────────────────────────────

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

// ── Prompt builder ────────────────────────────────────────────────────────────

const REPO_SCAN_SYSTEM_PROMPT = `You are GitScope's principal codebase auditor — a staff principal engineer with 15+ years of cross-domain expertise:
• Security: OWASP Top 10, threat modeling, secrets management, dependency CVEs, supply-chain attacks, SAST patterns, injection, XSS, CSRF, auth flaws
• Architecture: distributed systems, microservices, serverless, monorepos, API design, data modelling, separation of concerns
• DevOps: CI/CD pipelines, Docker, Kubernetes, infrastructure-as-code, deployment strategies, observability
• Backend: Node.js, Python, Go, Rust — databases, caching (Redis), queues (BullMQ/RabbitMQ), ORM patterns, connection pooling
• Frontend: React, Next.js, bundle optimisation, Core Web Vitals, SSR/SSG, accessibility, hydration
• Code quality: SOLID, DRY, design patterns, cyclomatic complexity, tech debt quantification, naming clarity
• Testing: unit, integration, E2E — coverage strategy, test pyramid, flaky test detection, mocking boundaries
• Dependencies: semver risks, deprecated packages, large bundle weight, known CVE patterns, lock file hygiene

CRITICAL RULES — follow exactly:
1. Every finding MUST cite the EXACT filename from the file tree or contents provided (e.g. "src/lib/auth.ts", not just "auth file").
2. Every finding description MUST reference the SPECIFIC code pattern, function name, or line — not a generic summary. BAD: "3 console.log calls". GOOD: "console.log(user.password) in src/components/login-form.tsx line ~42 leaks sensitive data to browser console".
3. Every suggestion MUST be a CONCRETE fix — include corrected code snippet or exact command where possible. BAD: "Remove debug logs". GOOD: "Remove the console.log on line ~42; if logging is needed use a structured logger: logger.debug({ userId: user.id }, 'login attempt')".
4. Do NOT duplicate findings. If the same issue appears in 3 files, write ONE finding that lists all 3 files in the description.
5. Prioritise findings by real-world impact. Only include "low" severity if it is a genuine quality concern, not a style preference.
6. You return ONLY valid JSON. No markdown, no preamble, no trailing text.
7. FALSE POSITIVE AVOIDANCE — never flag as security issues:
   • Error message strings or UI display text containing words like "token", "key", "password", "secret" — e.g. const msg = "The token is invalid" is not a hardcoded credential. Real credentials contain no spaces and are hex/base64/alphanumeric characters only.
   • Security analysis or rule-definition files (e.g. internal-ai.ts, security-rules.ts, vuln_patterns.py) — regex patterns and intentional bad-code examples in these files are documentation, not vulnerabilities.
   • Test files (*.test.ts, *.spec.ts, **/__tests__/**) — fixture values, mock tokens, test passwords, and stub credentials in tests are expected and intentional.
   • TypeScript interface or type fields (e.g. interface User { password?: string }) — these are type definitions, not data storage.
   • Import paths that contain credential-sounding words — these are module names, not sensitive values.
   • Configuration schemas or validation code that checks for the presence of secrets — code like if (!process.env.API_KEY) is checking for a missing key, not hardcoding one.

CODE FIX RULES — every finding that has a fixable code pattern MUST include a "fix" object:
• "fix.before": Show 4–8 lines of ACTUAL CODE from the file (not pseudocode). Include 1–2 lines of context before and after the problem line so the developer knows exactly where to look. The broken code must be verbatim as it appears in the file.
• "fix.after": Show the corrected replacement for those same lines. Must be complete, copy-paste-ready code. Add inline comments (// why this matters) on changed lines.
• "fix.language": The programming language of the file (typescript, javascript, python, go, rust, java, etc.).
• NEVER use placeholder text like "your code here", "...", or "// existing code". Show REAL code derived from what was fetched.
• If the exact before-code was not in the fetched file contents, write the most realistic representation of the anti-pattern based on the file's actual style and context.
• For security fixes: the "after" code must be production-grade — include imports if a new library is needed, add error handling, preserve the function signature.`;

function buildRepoScanPrompt(params: {
  repo: string;
  meta: Record<string, unknown>;
  fileTree: string[];
  keyFileContents: Record<string, string>;
  recentCommits: string[];
  contributors: number;
  openPRCount: number;
  scanMode: string;
  realLoc: string;
  filesRead: number;
  importGraph: Record<string, string[]>;
}): string {
  const {
    repo, meta, fileTree, keyFileContents, recentCommits, contributors, openPRCount, scanMode, realLoc, filesRead, importGraph,
  } = params;
  const isDeep = scanMode === "deep";

  const fileTreeStr = fileTree.slice(0, isDeep ? 200 : 120).join("\n");

  // For key files: show full content for high-signal files, abbreviated for others
  const HIGH_SIGNAL_PROMPT = /auth|api[/\\]|\/lib\/|middleware|main\.|index\.|server\.|app\.|router|database|\/db\/|prisma|model|service|controller|store|schema|util|hook|action|handler|payment|stripe|config|env/i;
  const keyFilesStr = Object.entries(keyFileContents)
    .sort(([a], [b]) => {
      const aHigh = HIGH_SIGNAL_PROMPT.test(a) ? 0 : 1;
      const bHigh = HIGH_SIGNAL_PROMPT.test(b) ? 0 : 1;
      return aHigh - bHigh;
    })
    .map(([name, content]) => {
      const isHighSignal = HIGH_SIGNAL_PROMPT.test(name);
      const limit = isHighSignal ? (isDeep ? 5000 : 3500) : (isDeep ? 2000 : 1200);
      return `\n### ${name}\n\`\`\`\n${content.slice(0, limit)}\n\`\`\``;
    })
    .join("\n");

  // Build a condensed import graph for the AI — only local imports, not npm packages
  const localImports = Object.entries(importGraph)
    .filter(([, deps]) => deps.some((d) => d.startsWith(".") || d.startsWith("@/") || d.startsWith("~/")))
    .map(([file, deps]) => {
      const local = deps.filter((d) => d.startsWith(".") || d.startsWith("@/") || d.startsWith("~/"));
      return `${file.split("/").slice(-2).join("/")} → ${local.slice(0, 8).join(", ")}`;
    })
    .slice(0, 80)
    .join("\n");

  return `Perform a ${isDeep ? "full deep" : "quick"} codebase health audit. Return ONLY valid JSON — no preamble, no markdown.

## Repository: ${repo}
Scan mode: ${isDeep ? "Deep (ALL files scanned)" : "Quick (top files scanned)"}
Language: ${meta.language ?? "Unknown"} | Stars: ${meta.stargazers_count ?? 0} | Open issues: ${meta.open_issues_count ?? 0}
Created: ${meta.created_at ?? "Unknown"} | Last push: ${meta.pushed_at ?? "Unknown"}
Contributors: ${contributors} | Open PRs: ${openPRCount}
Topics: ${Array.isArray(meta.topics) ? (meta.topics as string[]).join(", ") || "none" : "none"}
Description: ${meta.description ?? "none"}
Total files: ${fileTree.length} | Files read: ${filesRead} | Real LOC (computed from file sizes): ${realLoc}

## Recent Commits (last 10)
${recentCommits.map((m, i) => `${i + 1}. ${m}`).join("\n") || "None available"}

## File Tree (${fileTree.length} total — first ${isDeep ? 200 : 120} shown)
${fileTreeStr}

## Dependency Graph (local imports — how files wire together)
${localImports || "(import graph unavailable)"}

## File Contents — base ALL findings on this actual code
${keyFilesStr || "(no file contents available — analyse from file tree only)"}

## Project Scale Classification (calibrate ALL severities to this)
${(() => {
  const stars = Number(meta.stargazers_count ?? 0);
  const contribs = Number(contributors ?? 1);
  if (stars > 5000 || contribs > 20) return "SCALE: Large / production-critical. Full severity applies for all categories.";
  if (stars > 500 || contribs > 5) return "SCALE: Growing / production. Full severity applies. Flag infra gaps as medium, not critical.";
  if (stars > 50 || contribs > 2) return "SCALE: Small / early-stage. Downgrade process gaps (no CI/CD, no changelog, no release tags) from high→low. Security vulns stay at full severity.";
  return "SCALE: Personal / hobby / student project (≤50 stars, ≤2 contributors). DO NOT flag: missing CI/CD, missing Docker, missing tests, missing CHANGELOG, missing release pipeline — these are normal and expected. Only report genuine security vulnerabilities (exposed secrets, injection, broken auth) and real code bugs. Everything else is low severity at most.";
})()}

## Instructions — MANDATORY
- CROSS-FILE ANALYSIS: Use the dependency graph above to trace data flows across boundaries. If a bug in file A causes problems in file B (e.g. unvalidated input flows from route → service → DB; missing auth in route that delegates to privileged handler; secret accessed in server file imported by client component), report it as a CROSS-FILE finding and name BOTH files.
- Base findings only on what you see in the file contents — no speculation
- FILENAME RULE: Every finding.file must be an exact path from the file tree. Never write "various files" — pick the most impactful file and mention others in the description.
- SPECIFICITY RULE: Name the actual function/variable/pattern. "hashPassword() in src/lib/auth.ts uses MD5" not "weak hashing detected"
- SUGGESTION RULE: Every suggestion must include a concrete code snippet fix, not just a principle.
- GROUPING RULE: Same pattern in multiple files → ONE finding listing all affected files.
- IMPACT RULE: Only include findings with real production impact. Skip pure style nitpicks.
- SCALE RULE: Apply the Project Scale Classification above. Never mark missing CI/CD, tests, or DevOps tooling as "critical" — that's reserved for exploitable security vulnerabilities.
- LOC: Use the real LOC value (${realLoc}) verbatim in metrics.estimatedLoc — do NOT re-estimate.
- For dependency risks, check exact package names in package.json shown above.

## JSON Schema (return exactly this, all fields required)
{
  "healthScore": <0-100, weighted: security 30% + quality 25% + testability 25% + deps 20%>,
  "summary": "<4-5 sentence executive summary — what the repo does, key strengths, biggest risks, overall verdict>",
  "architecture": {
    "summary": "<2-3 sentences on tech stack, structure, and patterns from the actual files>",
    "patterns": ["<detected patterns e.g. Next.js App Router, REST API, Feature Modules, Prisma ORM>"],
    "strengths": ["<specific architectural strength with evidence>"],
    "concerns": ["<specific architectural concern with evidence>"]
  },
  "security": {
    "score": <0-100, higher=safer>,
    "grade": "A"|"B"|"C"|"D"|"F",
    "issues": [
      {
        "severity": "critical"|"high"|"medium"|"low",
        "category": "security"|"config",
        "file": "<exact filename from the file tree — e.g. src/lib/auth.ts>",
        "description": "<MUST name exact function/pattern — e.g. 'hashPassword() in src/lib/auth.ts uses MD5 which is cryptographically broken'>",
        "suggestion": "<MUST include corrected code — e.g. 'Replace with: const hash = await bcrypt.hash(password, 12)'>",
        "fix": {
          "before": "<4-8 lines of ACTUAL CODE from the file showing the vulnerability. Include surrounding context lines. Must be verbatim or close to actual code.>",
          "after": "<the corrected replacement — complete, production-ready, with comments explaining why on changed lines>",
          "language": "<typescript|javascript|python|go|rust|java|etc>"
        }
      }
    ],
    "positives": ["<specific good security practice observed with evidence>"]
  },
  "codeQuality": {
    "score": <0-100>,
    "grade": "A"|"B"|"C"|"D"|"F",
    "issues": [
      {
        "severity": "medium"|"low",
        "category": "quality"|"performance"|"architecture",
        "file": "<exact filename from file tree>",
        "description": "<MUST name exact function/variable/pattern — e.g. 'fetchUser() in src/lib/db.ts makes an unbounded SELECT * without pagination, risking OOM on large datasets'>",
        "suggestion": "<MUST include concrete fix with code — e.g. 'Add: .take(100).skip(offset) to the Prisma query, and accept a page parameter in the function signature'>",
        "fix": {
          "before": "<4-8 lines of ACTUAL CODE showing the quality issue with context lines>",
          "after": "<corrected replacement with comments on changed lines>",
          "language": "<typescript|javascript|python|go|etc>"
        }
      }
    ],
    "strengths": ["<specific quality strength with evidence>"]
  },
  "performance": {
    "score": <0-100, higher=faster>,
    "grade": "A"|"B"|"C"|"D"|"F",
    "issues": [
      {
        "severity": "high"|"medium"|"low",
        "category": "performance",
        "file": "<exact filename>",
        "description": "<specific perf issue — e.g. 'getProducts() in src/lib/db.ts runs N+1 queries in a loop, fetching relations one-by-one'>",
        "suggestion": "<concrete fix with code>",
        "fix": {
          "before": "<4-8 lines of actual code showing the performance problem>",
          "after": "<optimised replacement with comments>",
          "language": "<typescript|javascript|python|etc>"
        }
      }
    ],
    "positives": ["<specific performance strength with evidence>"]
  },
  "testability": {
    "score": <0-100>,
    "grade": "A"|"B"|"C"|"D"|"F",
    "hasTestFramework": <boolean based on deps and file tree>,
    "coverageEstimate": "<estimated range e.g. '~30-50%' or 'None detected'>",
    "gaps": ["<specific untested area with evidence>"]
  },
  "dependencies": {
    "score": <0-100>,
    "totalCount": <count from package.json>,
    "risks": ["<specific dependency risk with package name>"],
    "outdatedSignals": ["<specific outdated/deprecated package with migration path>"]
  },
  "techDebt": {
    "score": <0-100, higher=less debt>,
    "level": "minimal"|"manageable"|"significant"|"severe",
    "hotspots": ["<specific file or area with debt evidence>"],
    "estimatedHours": "<realistic estimate e.g. '30-60 hours'>"
  },
  "recommendations": [
    {
      "priority": "immediate"|"short-term"|"long-term",
      "title": "<clear actionable title>",
      "description": "<specific description with evidence and steps>",
      "effort": "low"|"medium"|"high"
    }
  ],
  "metrics": {
    "primaryLanguage": "${meta.language ?? "Unknown"}",
    "fileCount": ${fileTree.length},
    "estimatedLoc": "${realLoc}",
    "contributors": ${contributors},
    "repoAge": "<calculated from created_at>",
    "openIssues": ${meta.open_issues_count ?? 0},
    "stars": ${meta.stargazers_count ?? 0}
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

  let body: { repo?: string; scanMode?: string; branch?: string; selectedPaths?: string[]; effort?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { repo, branch, selectedPaths, effort = "balanced", force = false } = body;
  // Map effort to scanMode for backward compat:
  // quick/balanced → quick scan caps; thorough/maximum → deep (reads all files)
  const scanMode = (effort === "thorough" || effort === "maximum") ? "deep" : (body.scanMode ?? "quick");
  // File read caps per effort level
  const EFFORT_FILE_CAPS: Record<string, number> = { quick: 50, balanced: 90, thorough: 200, maximum: 400 };
  const targetBranch = typeof branch === "string" && branch.trim() ? branch.trim() : undefined;

  if (!repo || typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return new Response(JSON.stringify({ error: "Invalid repo format. Use owner/repo" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  // Fetch all BYOK keys (Anthropic, OpenAI, Gemini + extended: Groq, Cerebras, etc.)
  const byokKeys: UserBYOKKeys = await getUserBYOKKeys(session.user.id);
  const userHasByok = hasByokKey(byokKeys);

  const budget = await consumeUsageBudget({
    userId: session.user.id,
    feature: "repo-scan",
    plan,
    limit: Math.max(3, Math.floor(caps.aiRequestsPerHour / 8)),
    units: scanMode === "deep" ? 3 : 1,
    metadata: { repo, scanMode },
  });

  if (!budget.allowed) {
    return new Response(
      JSON.stringify({ error: "Repo scan limit reached. Deep scans use 3× budget. Upgrade for more capacity." }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  // Deep scan is Pro+ only
  if (scanMode === "deep" && !caps.deepScanAllowed) {
    return new Response(
      JSON.stringify({ error: "Deep scan requires a Developer plan.", upgradeRequired: true, requiredPlan: "developer" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* client disconnected */ }
      };

      const done = (result?: RepoScanResult, error?: string) => {
        emit({ type: "done", result, error });
        try { controller.close(); } catch { /* already closed */ }
      };

      try {
        emit({ type: "progress", step: "Authenticating with GitHub…", percent: 5 });

        // Load cached knowledge for this repo (gives AI prior context)
        const cachedKnowledge = await loadRepoKnowledge(session.user.id, repo);

        const { token: ghToken } = await getGitHubTokenWithSource({ session });

        emit({ type: "progress", step: "Fetching repository metadata…", percent: 12 });

        const meta = await ghFetch<Record<string, unknown>>(`/repos/${repo}`, ghToken);
        if (!meta) {
          done(undefined, "Repository not found or access denied. For private repos, connect your GitHub account.");
          return;
        }

        // Parallel fetches
        emit({ type: "progress", step: "Scanning file tree and commit history…", percent: 22 });

        const [treeData, commitsData, contributorsData, pullsData] = await Promise.all([
          ghFetch<{ tree: Array<{ path: string; type: string }> }>(
            `/repos/${repo}/git/trees/${targetBranch ?? (meta.default_branch as string | undefined) ?? "HEAD"}?recursive=1`,
            ghToken
          ),
          ghFetch<Array<{ commit: { message: string } }>>(
            `/repos/${repo}/commits?per_page=10`,
            ghToken
          ),
          ghFetch<Array<{ login: string }>>(
            `/repos/${repo}/contributors?per_page=20`,
            ghToken
          ),
          ghFetch<Array<{ number: number }>>(
            `/repos/${repo}/pulls?state=open&per_page=1`,
            ghToken
          ),
        ]);

        // Keep size for real LOC calculation
        const treeBlobs = (treeData?.tree ?? []).filter(
          (t): t is { path: string; type: string; size?: number } => t.type === "blob"
        );
        const fileTree = treeBlobs.map((t) => t.path).slice(0, 2000);

        // Real LOC: sum file sizes for code files, divide by language avg bytes/line
        const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|rb|php|swift|kt|cpp|c|h|vue|svelte|css|scss|sass|less)$/;
        const BYTES_PER_LINE: Record<string, number> = {
          ts: 52, tsx: 50, js: 48, jsx: 48, py: 44, go: 58, rs: 60,
          java: 62, cs: 60, rb: 42, php: 50, swift: 58, kt: 56,
          cpp: 62, c: 60, h: 55, vue: 48, svelte: 48, css: 38, scss: 36,
          sass: 34, less: 36, mjs: 48, cjs: 48,
        };
        let totalCodeBytes = 0;
        let totalCodeFiles = 0;
        for (const blob of treeBlobs) {
          if (!CODE_EXT.test(blob.path)) continue;
          totalCodeBytes += blob.size ?? 0;
          totalCodeFiles++;
        }
        // Weighted average bytes/line across detected code files
        const avgBytesPerLine = 50;
        const realLocRaw = totalCodeBytes > 0 ? Math.round(totalCodeBytes / avgBytesPerLine) : 0;
        const realLoc = realLocRaw === 0 ? "Unknown"
          : realLocRaw < 500 ? `${realLocRaw} lines`
          : realLocRaw < 1_000 ? `${realLocRaw} lines`
          : realLocRaw < 10_000 ? `${(realLocRaw / 1000).toFixed(1)}k lines`
          : `${Math.round(realLocRaw / 1000)}k lines`;
        const realLocByExt: Record<string, number> = {};
        for (const blob of treeBlobs) {
          const ext = blob.path.split(".").pop() ?? "";
          if (!(ext in BYTES_PER_LINE)) continue;
          const bpl = BYTES_PER_LINE[ext] ?? avgBytesPerLine;
          realLocByExt[ext] = (realLocByExt[ext] ?? 0) + Math.round((blob.size ?? 0) / bpl);
        }

        const recentCommits = (commitsData ?? [])
          .slice(0, 10)
          .map((c) => c.commit.message.split("\n")[0].slice(0, 80));

        const contributors = (contributorsData ?? []).length;
        const openPRCount = (pullsData ?? []).length;

        // ── File selection ──────────────────────────────────────────────────────
        emit({ type: "progress", step: "Identifying files to read…", percent: 35 });

        const CONFIG_FILES = [
          "package.json", "tsconfig.json", "README.md",
          ".eslintrc.json", ".eslintrc.js", "eslint.config.js", "eslint.config.mjs",
          "biome.json", "biome.jsonc",
          "jest.config.ts", "jest.config.js", "vitest.config.ts", "vitest.config.js",
          "next.config.ts", "next.config.js",
          "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
          ".github/workflows/ci.yml", ".github/workflows/ci.yaml",
          ".github/workflows/deploy.yml", ".github/workflows/main.yml",
          ".gitlab-ci.yml", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml",
          "middleware.ts", "middleware.js", "prisma/schema.prisma",
        ].filter((f) => fileTree.some((t) => t === f || t.endsWith(`/${f}`)));

        const SOURCE_EXTS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|rb|php|vue|svelte)$/;
        const EXCLUDE = /node_modules\/|\.next\/|dist\/|build\/|\.min\.(js|ts)$|\.d\.ts$/;
        const allSourceFiles = fileTree.filter((f) => SOURCE_EXTS.test(f) && !EXCLUDE.test(f));

        // High-signal tier — always read these first regardless of mode
        const HIGH_SIGNAL = /auth|api[/\\]|\/lib\/|middleware|main\.|index\.|server\.|app\.|router|database|\/db\/|prisma|model|service|controller|store|schema|util|hook|action|guard|handler|payment|stripe|webhook|config|env|permission|role/i;

        let sourceFilesToRead: string[];
        if (selectedPaths && selectedPaths.length > 0) {
          // User-selected files: honour exactly what they picked (filtered to valid source)
          const validSelected = selectedPaths.filter((p) => fileTree.includes(p) && !EXCLUDE.test(p));
          const tier1 = validSelected.filter((f) => HIGH_SIGNAL.test(f));
          const tier2 = validSelected.filter((f) => !HIGH_SIGNAL.test(f));
          sourceFilesToRead = [...tier1, ...tier2];
          emit({ type: "progress", step: `Scanning ${sourceFilesToRead.length} selected file${sourceFilesToRead.length === 1 ? "" : "s"}…`, percent: 36 });
        } else {
          // Auto-select based on effort level
          const fileCap = EFFORT_FILE_CAPS[effort] ?? 90;
          const tier1 = allSourceFiles.filter((f) => HIGH_SIGNAL.test(f));
          const tier2 = allSourceFiles.filter((f) => !HIGH_SIGNAL.test(f));
          sourceFilesToRead = scanMode === "deep"
            ? [...tier1, ...tier2].slice(0, fileCap)
            : [...tier1, ...tier2].slice(0, fileCap);
        }

        const allFilesToRead = [...CONFIG_FILES, ...sourceFilesToRead];

        // ── Batch parallel fetch (25 concurrent) ───────────────────────────────
        const BATCH = 25;
        const keyFileContents: Record<string, string> = {};

        emit({ type: "progress", step: `Reading ${allFilesToRead.length} files…`, percent: 38 });

        for (let i = 0; i < allFilesToRead.length; i += BATCH) {
          const batch = allFilesToRead.slice(i, i + BATCH);
          const percent = Math.round(38 + ((i + BATCH) / allFilesToRead.length) * 22);
          emit({
            type: "progress",
            step: `Reading files ${i + 1}–${Math.min(i + BATCH, allFilesToRead.length)} of ${allFilesToRead.length}…`,
            percent: Math.min(percent, 60),
          });

          await Promise.all(batch.map(async (f) => {
            const actualPath = CONFIG_FILES.includes(f)
              ? (fileTree.find((t) => t === f || t.endsWith(`/${f}`)) ?? f)
              : f;
            const contentUrl = `/repos/${repo}/contents/${actualPath}${targetBranch ? `?ref=${encodeURIComponent(targetBranch)}` : ""}`;
            const content = await ghFetchText(contentUrl, ghToken);
            if (!content) return;

            if (f === "package.json") {
              try {
                const pkg = JSON.parse(content);
                keyFileContents[f] = JSON.stringify(
                  { name: pkg.name, version: pkg.version, scripts: pkg.scripts, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }, null, 2
                );
              } catch { keyFileContents[f] = content.slice(0, 4000); }
            } else {
              // Full content for high-signal files, truncated for rest
              const isHighSignal = HIGH_SIGNAL.test(f) || CONFIG_FILES.includes(f);
              const limit = isHighSignal
                ? (scanMode === "deep" ? 8000 : 5000)
                : (scanMode === "deep" ? 4000 : 2500);
              keyFileContents[f] = content.slice(0, limit);
            }
          }));
        }

        const filesRead = Object.keys(keyFileContents).length;

        // ── Build import graph ────────────────────────────────────────────────
        // Parse import/require statements from every fetched file to understand
        // how the codebase is wired together (who depends on whom).
        emit({ type: "progress", step: "Building dependency graph…", percent: 61 });

        const importGraph: Record<string, string[]> = {};
        const importedBy: Record<string, string[]> = {};   // reverse map: who imports this file

        for (const [file, content] of Object.entries(keyFileContents)) {
          const imports: string[] = [];
          // ES module imports: import X from './y'  /  import { X } from '@/y'
          for (const m of content.matchAll(/^import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm)) {
            imports.push(m[1]);
          }
          // require() calls
          for (const m of content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
            imports.push(m[1]);
          }
          // Dynamic imports
          for (const m of content.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
            imports.push(m[1]);
          }
          importGraph[file] = imports;

          // Build reverse map
          for (const imp of imports) {
            if (!importedBy[imp]) importedBy[imp] = [];
            importedBy[imp].push(file);
          }
        }

        emit({ type: "progress", step: `Read ${filesRead} files — checking AI availability…`, percent: 63 });

        let result: RepoScanResult;

        // ── Public scan cache — serve cached LLM result if available ─────────
        // Skips the LLM call entirely for public repos scanned recently by any user.
        // Private repos are NEVER cached here (safety: no cross-user data leakage).
        // force=true bypasses the cache so users always get a fresh scan.
        const isPrivateRepo = Boolean(meta.private);
        if (!isPrivateRepo && !force && hasAnyAIProvider(byokKeys)) {
          const cached = await checkPublicScanCache(repo, scanMode, isPrivateRepo);
          if (cached) {
            const cachedScore = (cached as Record<string, unknown>).healthScore as number | undefined;
            // Skip cache entries that look like empty-agent failures (score=100 with no issues)
            const cachedSecurity = (cached as Record<string, unknown>).security as Record<string, unknown> | undefined;
            const cachedIssues = Array.isArray(cachedSecurity?.["issues"]) ? (cachedSecurity?.["issues"] as unknown[]).length : 0;
            const looksStale = cachedScore === 100 && cachedIssues === 0;
            if (!looksStale) {
              emit({ type: "progress", step: "Serving cached analysis…", percent: 90 });
              result = { ...(cached as Partial<RepoScanResult>), fromCache: true } as RepoScanResult;
              done(result);
              return;
            }
            // Cache looks like a false-positive 100/no-issues result — skip it and re-scan
            emit({ type: "progress", step: "Stale cache detected — running fresh analysis…", percent: 14 });
          }
        }

        // ── Daily LLM cost gate ───────────────────────────────────────────────
        // BYOK users bypass this check entirely — they pay their own API bills.
        // For server-key users: check the daily LLM budget before calling the provider.
        const hasAnyProvider = hasAnyAIProvider(byokKeys) || 
          process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY ||
          process.env.GROQ_API_KEY || process.env.CEREBRAS_API_KEY || process.env.DEEPSEEK_API_KEY ||
          process.env.MISTRAL_API_KEY || process.env.HUGGINGFACE_API_KEY;

        let useLlm: boolean;

        if (!hasAnyProvider) {
          // No API keys at all — internal AI only
          useLlm = false;
        } else if (userHasByok) {
          // BYOK — no daily limits, always use LLM
          useLlm = true;
        } else if (caps.dailyLlmScanLimit === 0) {
          // Free plan — internal AI only
          useLlm = false;
        } else {
          const llmBudget = await consumeUsageBudget({
            userId: session.user.id,
            feature: "repo-scan-llm",
            plan,
            limit: caps.dailyLlmScanLimit,
            units: scanMode === "deep" ? 2 : 1,
            windowMs: 24 * 60 * 60 * 1000,
            metadata: { repo, scanMode },
          });

          if (llmBudget.allowed) {
            useLlm = true;
          } else {
            // Limit hit — developer plan gets an error (internal AI is too basic for them).
            // Free plan falls back gracefully to internal AI.
            if (plan === "developer") {
              emit({
                type: "done",
                error: `Daily AI scan limit reached (${caps.dailyLlmScanLimit} LLM scans/day on ${plan} plan). Add your own API key in Settings → Integrations → BYOK to remove this limit, or wait until midnight UTC for reset.`,
              });
              try { controller.close(); } catch { /* already closed */ }
              return;
            }
            useLlm = false;
            emit({
              type: "progress",
              step: `Daily AI limit reached — serving static analysis…`,
              percent: 64,
            });
          }
        }

        // ── LAST RESORT: Run internal AI only when no AI providers available ──────
        let internalScanResult: RepoScanResult | undefined;
        if (!useLlm) {
          emit({ type: "progress", step: "Running static analysis (no AI key configured)…", percent: 65 });
          internalScanResult = scanRepoWithInternalAI({
            repo, fileTree, keyFileContents, recentCommits, contributors, meta, scanMode,
            realLoc, realLocByExt, totalCodeFiles, importGraph,
          });
          result = internalScanResult;
        } else {
          emit({ type: "progress", step: "AI scanning architecture, security, and quality…", percent: 65 });

          // Build prompt — inject cached knowledge if available so AI builds on prior findings
          let basePrompt = buildRepoScanPrompt({ repo, meta, fileTree, keyFileContents, recentCommits, contributors, openPRCount, scanMode, realLoc, filesRead, importGraph });
          if (targetBranch) basePrompt = `Branch under analysis: ${targetBranch}\n${basePrompt}`;
          if (cachedKnowledge) {
            emit({ type: "progress", step: "Loading memory from previous scan…", percent: 67 });
            basePrompt = formatKnowledgeForPrompt(cachedKnowledge) + "\n\n" + basePrompt;
          }

          // Hard cap: prevent 413 Payload Too Large from any provider's HTTP limit
          const MAX_PROMPT_CHARS = 90_000;
          if (basePrompt.length > MAX_PROMPT_CHARS) {
            const head = Math.floor(MAX_PROMPT_CHARS * 0.7);
            const tail = MAX_PROMPT_CHARS - head;
            basePrompt = `${basePrompt.slice(0, head)}\n\n[GitScope trimmed scan payload to stay within provider request limits — ${(basePrompt.length / 1000).toFixed(0)}k chars → ${(MAX_PROMPT_CHARS / 1000).toFixed(0)}k chars]\n\n${basePrompt.slice(-tail)}`;
          }

          emit({ type: "progress", step: "Running multi-agent AI analysis…", percent: 78 });
          try {
            // Select agents based on scan mode
            const agents: AgentConfig[] = scanMode === "quick"
              ? [SECURITY_AGENT, ARCHITECTURE_AGENT]
              : scanMode === "deep"
                ? [SECURITY_AGENT, ARCHITECTURE_AGENT, PERFORMANCE_AGENT, TESTING_AGENT, DEPENDENCY_AGENT, DEBT_AGENT]
                : [SECURITY_AGENT, ARCHITECTURE_AGENT, PERFORMANCE_AGENT, TESTING_AGENT];

            const orchestratorRes = await runAgentOrchestrator(
              {
                agents,
                effort: scanMode === "deep" ? "thorough" : scanMode === "quick" ? "quick" : "balanced",
                plan: plan as AIPlan,
                byokKeys,
                mode: "parallel",
              },
              basePrompt,
              { repo, fileContents: keyFileContents }
            );

            // Helper: detect agent outputs that are empty/failed (avoids false 100 scores)
            const isAgentOutputEmpty = (r: { parsedOutput?: Record<string, unknown>; output?: string }): boolean => {
              if (!r.parsedOutput) return true;
              if (Object.keys(r.parsedOutput).length === 0) return true;
              if (!r.output || r.output.trim() === "" || r.output === "{}") return true;
              if (r.output.includes("unavailable") || r.output.includes("Analysis unavailable")) return true;
              return false;
            };

            if (!orchestratorRes || orchestratorRes.agentResults.length === 0) {
              emit({ type: "progress", step: "AI agents returned no results — falling back to static analysis…", percent: 80 });
              internalScanResult = scanRepoWithInternalAI({
                repo, fileTree, keyFileContents, recentCommits, contributors, meta, scanMode,
                realLoc, realLocByExt, totalCodeFiles, importGraph,
              });
              result = { ...internalScanResult, model: "internal-ai-v3", isDemo: false };
            } else if (orchestratorRes.agentResults.every(isAgentOutputEmpty)) {
              // All agents failed or returned empty/error — fall back to internal AI
              emit({ type: "progress", step: "AI agents failed — falling back to static analysis…", percent: 80 });
              internalScanResult = scanRepoWithInternalAI({
                repo, fileTree, keyFileContents, recentCommits, contributors, meta, scanMode,
                realLoc, realLocByExt, totalCodeFiles, importGraph,
              });
              result = { ...internalScanResult, model: "internal-ai-v3", isDemo: false };
            } else {
              // Successfully extracted results from agents - process and compile
              emit({ type: "progress", step: "Compiling multi-agent findings…", percent: 82 });

              // ── Helper: extract agent output robustly ──────────────────────
              const safeParsedOutput = (agentId: string) => {
                const agent = orchestratorRes.agentResults.find((r) => r.agentId === agentId);
                const parsed = safeObject(agent?.parsedOutput) ?? (parseJsonFromText(agent?.output) as Record<string, unknown> | undefined);
                if (Array.isArray(parsed)) return { findings: parsed };
                return safeObject(parsed);
              };

              const securityOutput = safeParsedOutput("security");
              const archOutput    = safeParsedOutput("architecture");
              const perfOutput    = safeParsedOutput("performance");
              const testOutput    = safeParsedOutput("testing");
              const depOutput     = safeParsedOutput("dependency");
              const debtOutput    = safeParsedOutput("debt");

              // Which agents actually produced real data (not null/empty)?
              const hasRealPerf = !!perfOutput && Object.keys(perfOutput).length > 0;
              const hasRealTest = !!testOutput && Object.keys(testOutput).length > 0;
              const hasRealDep  = !!depOutput  && Object.keys(depOutput).length  > 0;

              // ── Security findings — normalize from agent-specific schema ─────
              // The security agent returns { title, description, fix: string,
              // vulnerableCode, attackScenario, impact } — map to RepoScanFinding.
              const guessLang = (file?: string) => {
                if (!file) return undefined;
                const ext = file.split(".").pop()?.toLowerCase();
                const map: Record<string, string> = {
                  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
                  py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
                  php: "php", cs: "csharp", swift: "swift", kt: "kotlin",
                };
                return map[ext ?? ""] ?? ext;
              };

              const normalizeSecFinding = (f: Record<string, unknown>): RepoScanFinding => {
                const title       = String(f.title       ?? "");
                const desc        = String(f.description ?? "");
                const fixText     = typeof f.fix === "string" ? f.fix : String(f.remediation ?? f.recommendation ?? "");
                const vulnCode    = String(f.vulnerableCode ?? f.code ?? f.before ?? "");
                const attackScen  = String(f.attackScenario ?? "");
                const impact      = String(f.impact ?? "");
                const file        = typeof f.file === "string" ? f.file : undefined;

                const fullDesc = [title, desc].filter(Boolean).join(": ")
                  || (attackScen ? `Attack: ${attackScen}` : "Security issue detected");

                const suggestion = [fixText, attackScen ? `Attack vector: ${attackScen}` : "", impact ? `Impact: ${impact}` : ""]
                  .filter(Boolean).join(" | ") || "Review and remediate this security finding.";

                return {
                  severity: (f.severity as RepoScanFinding["severity"]) ?? "medium",
                  category: "security" as const,
                  file,
                  description: fullDesc,
                  suggestion,
                  fix: vulnCode && fixText ? { before: vulnCode, after: fixText, language: guessLang(file) } : undefined,
                };
              };

              const rawSecFindings = safeObjectArray(
                securityOutput?.["findings"] ?? securityOutput?.["issues"] ??
                securityOutput?.["vulnerabilities"] ?? securityOutput?.["problems"] ?? []
              );
              const securityFindings: RepoScanFinding[] = rawSecFindings.slice(0, 14).map(normalizeSecFinding);

              // ── Architecture concerns — the agent returns OBJECTS not strings ─
              // Schema: { severity, category, file, title, description, evidence, recommendation, effort }
              const archConcernObjects = safeObjectArray(archOutput?.["concerns"] ?? archOutput?.["issues"] ?? []);

              // String representation for the architecture tab
              const archConcernStrings: string[] = archConcernObjects.length > 0
                ? archConcernObjects.map((c) => [c.title as string, c.description as string].filter(Boolean).join(": ") || String(c))
                : safeStringArray(archOutput?.["concerns"] ?? archOutput?.["findings"] ?? []);

              // Code quality findings — use arch concerns + debt agent output
              const archQualityFindings: RepoScanFinding[] = archConcernObjects.slice(0, 8).map((c) => ({
                severity: (c.severity as RepoScanFinding["severity"]) ?? "medium",
                category: "architecture" as const,
                file: typeof c.file === "string" ? c.file : undefined,
                description: [c.title as string, c.description as string].filter(Boolean).join(": ")
                  || "Architectural concern detected",
                suggestion: String(c.recommendation ?? c.evidence ?? "Review and address this architectural concern."),
              }));

              // ── Performance issues ────────────────────────────────────────────
              const rawPerfIssues = safeObjectArray(
                perfOutput?.["issues"] ?? perfOutput?.["findings"] ?? perfOutput?.["results"] ?? []
              );
              const perfFindings: RepoScanFinding[] = rawPerfIssues.slice(0, 14).map((f) => ({
                severity: (f.severity as RepoScanFinding["severity"]) ?? "medium",
                category: "performance" as const,
                file: typeof f.file === "string" ? f.file : undefined,
                description: [f.title as string, f.description as string].filter(Boolean).join(": ")
                  || String(f),
                suggestion: String(f.recommendation ?? f.fix ?? f.suggestion ?? "Review this performance concern."),
              }));

              // ── Test gaps — may be strings or objects ─────────────────────────
              const rawTestGaps = testOutput?.["gaps"] ?? testOutput?.["testGaps"] ?? testOutput?.["coverageGaps"] ?? [];
              const testGaps: string[] = Array.isArray(rawTestGaps)
                ? rawTestGaps.map((g) => typeof g === "string" ? g : String((g as Record<string,unknown>).description ?? g))
                : [];

              // ── Scores — clamp 0-100, use agent value or compute from findings ─
              const securityScore = Math.min(100, Math.max(5,
                safeNumber(securityOutput?.["securityScore"]) ??
                safeNumber(securityOutput?.["score"])         ??
                safeNumber(securityOutput?.["rating"])        ??
                Math.max(5, 100 - securityFindings.filter((f) => f.severity === "critical").length * 20
                              - securityFindings.filter((f) => f.severity === "high").length * 10
                              - securityFindings.filter((f) => f.severity === "medium").length * 5)
              ));

              const archScore = Math.min(100, Math.max(5,
                safeNumber(archOutput?.["architectureScore"]) ??
                safeNumber(archOutput?.["score"])             ??
                Math.max(5, 100 - archConcernObjects.filter((c) => c.severity === "high").length * 10
                              - archConcernObjects.length * 4)
              ));

              // For dimensions where no agent ran, do NOT default to 100 — use the
              // internal AI estimate instead (conservative mid-range).
              const perfScore = hasRealPerf ? Math.min(100, Math.max(5,
                safeNumber(perfOutput?.["performanceScore"]) ??
                safeNumber(perfOutput?.["score"])            ??
                Math.max(5, 100 - rawPerfIssues.length * 8)
              )) : 70; // conservative default when no perf agent ran

              const testScore = hasRealTest ? Math.min(100, Math.max(5,
                safeNumber(testOutput?.["testabilityScore"]) ??
                safeNumber(testOutput?.["score"])            ??
                Math.max(5, 100 - testGaps.length * 8)
              )) : 60; // conservative default — assume limited tests until proven otherwise

              const depScore = hasRealDep ? Math.min(100, Math.max(5,
                safeNumber(depOutput?.["dependencyScore"]) ??
                safeNumber(depOutput?.["score"])           ?? 85
              )) : 75; // conservative default when no dep agent ran

              // ── healthScore: weights sum exactly to 1.0, adjust for missing agents
              let wsec = 0.35, warch = 0.25, wperf = 0.18, wtest = 0.12, wdep = 0.10;
              if (!hasRealPerf && !hasRealTest && !hasRealDep) {
                // Quick scan: only sec + arch
                wsec = 0.62; warch = 0.38; wperf = 0; wtest = 0; wdep = 0;
              } else if (!hasRealDep) {
                // Balanced: sec + arch + perf + test
                wsec = 0.40; warch = 0.27; wperf = 0.18; wtest = 0.15; wdep = 0;
              }
              const healthScore = Math.min(100, Math.max(0, Math.round(
                securityScore * wsec + archScore * warch + perfScore * wperf + testScore * wtest + depScore * wdep
              )));

              const grade = (s: number): "A" | "B" | "C" | "D" | "F" =>
                s >= 90 ? "A" : s >= 75 ? "B" : s >= 60 ? "C" : s >= 40 ? "D" : "F";

              // ── Code quality score: only use arch if no perf agent ran ────────
              const codeQualityScore = Math.min(100, Math.max(0,
                hasRealPerf ? Math.round(archScore * 0.55 + perfScore * 0.45) : archScore
              ));

              // ── Code quality issues: debt agent → arch concerns → empty ───────
              const qualityIssues: RepoScanFinding[] = safeObjectArray(debtOutput?.["issues"] ?? []).length > 0
                ? safeObjectArray(debtOutput?.["issues"] ?? []).slice(0, 10).map((f) => ({
                    severity: (f.severity as RepoScanFinding["severity"]) ?? "medium",
                    category: "quality" as const,
                    file: typeof f.file === "string" ? f.file : undefined,
                    description: String(f.description ?? f.title ?? ""),
                    suggestion: String(f.suggestion ?? f.recommendation ?? f.fix ?? ""),
                  }))
                : archQualityFindings; // arch concerns serve as quality issues for quick scans

              // ── Dependency count from package.json when no dep agent ran ─────
              let depTotalCount = safeNumber(depOutput?.["totalCount"]) ?? 0;
              if (depTotalCount === 0 && keyFileContents["package.json"]) {
                try {
                  const pkg = JSON.parse(keyFileContents["package.json"]) as Record<string, unknown>;
                  const deps = Object.keys((pkg.dependencies ?? {}) as object).length;
                  const devDeps = Object.keys((pkg.devDependencies ?? {}) as object).length;
                  depTotalCount = deps + devDeps;
                } catch { /* ignore parse errors */ }
              }

              // ── Recommendations: gather from all agents ────────────────────────
              type Rec = { priority: "immediate" | "short-term" | "long-term"; title: string; description: string; effort: "low" | "medium" | "high" };
              const allRecs: Rec[] = (orchestratorRes.parsedFinal?.recommendations as Rec[]) ?? [];
              if (allRecs.length === 0) {
                const gatherRecs = (out?: Record<string, unknown>) =>
                  safeObjectArray(out?.["recommendations"] ?? out?.["actions"] ?? out?.["quickWins"] ?? [])
                    .map((r) => ({
                      priority: (r.priority as Rec["priority"]) ?? "short-term",
                      title: String(r.title ?? r.name ?? ""),
                      description: String(r.description ?? r.detail ?? ""),
                      effort: (r.effort as Rec["effort"]) ?? "medium",
                    }))
                    .filter((r) => r.title);
                allRecs.push(...gatherRecs(securityOutput), ...gatherRecs(archOutput),
                  ...gatherRecs(perfOutput), ...gatherRecs(testOutput), ...gatherRecs(depOutput), ...gatherRecs(debtOutput));
              }

              result = {
                healthScore,
                summary: (orchestratorRes.parsedFinal?.summary as string)
                  ?? (securityOutput?.["summary"] as string)
                  ?? (archOutput?.["summary"] as string)
                  ?? (securityFindings.length === 0
                    ? `${repo} scanned — no critical issues detected. Security score: ${securityScore}/100.`
                    : `${repo} has ${securityFindings.filter((f) => f.severity === "critical" || f.severity === "high").length} high/critical and ${securityFindings.length} total security findings.`),
                architecture: {
                  summary: String(archOutput?.["summary"] ?? "Architecture analysis completed."),
                  patterns: safeStringArray(archOutput?.["detectedPatterns"] ?? archOutput?.["patterns"] ?? []),
                  strengths: safeStringArray(archOutput?.["strengths"] ?? archOutput?.["positives"] ?? []),
                  concerns: archConcernStrings,
                },
                security: {
                  score: securityScore,
                  grade: grade(securityScore),
                  issues: securityFindings,
                  positives: safeStringArray(securityOutput?.["positives"] ?? securityOutput?.["complianceNotes"] ?? []),
                },
                codeQuality: {
                  score: codeQualityScore,
                  grade: grade(codeQualityScore),
                  issues: qualityIssues,
                  strengths: safeStringArray(
                    debtOutput?.["strengths"] ?? debtOutput?.["positives"] ??
                    archOutput?.["quickWins"] ?? archOutput?.["strengths"] ?? []
                  ),
                },
                performance: {
                  score: perfScore,
                  grade: grade(perfScore),
                  issues: perfFindings,
                  positives: safeStringArray(perfOutput?.["positives"] ?? perfOutput?.["strengths"] ?? []),
                },
                testability: {
                  score: testScore,
                  grade: grade(testScore),
                  hasTestFramework: Boolean(testOutput?.["hasTestFramework"] ?? false),
                  coverageEstimate: String(testOutput?.["coverageEstimate"] ?? (hasRealTest ? "unknown" : "Not analyzed")),
                  gaps: testGaps,
                },
                dependencies: {
                  score: depScore,
                  totalCount: depTotalCount,
                  risks: safeStringArray(depOutput?.["risks"] ?? depOutput?.["vulnerabilities"] ?? []),
                  outdatedSignals: safeStringArray(depOutput?.["outdatedSignals"] ?? depOutput?.["outdated"] ?? []),
                },
                techDebt: {
                  score: Math.min(100, safeNumber(debtOutput?.["techDebtScore"] ?? debtOutput?.["score"]) ?? 75),
                  level: (debtOutput?.["debtLevel"] ?? debtOutput?.["level"]) as "minimal" | "manageable" | "significant" | "severe" ?? "manageable",
                  hotspots: safeStringArray(debtOutput?.["hotspots"] ?? debtOutput?.["files"] ?? []),
                  estimatedHours: String(debtOutput?.["estimatedHours"] ?? "Not analyzed"),
                },
                recommendations: allRecs,
                metrics: {
                  primaryLanguage: String((meta as Record<string, unknown>).language ?? "Unknown"),
                  fileCount: fileTree.length,
                  estimatedLoc: `${realLoc}`,
                  contributors: typeof contributors === "number" ? contributors : 0,
                  repoAge: (meta as Record<string, unknown>).created_at
                    ? `${Math.round((Date.now() - Date.parse(String((meta as Record<string, unknown>).created_at))) / (1000 * 60 * 60 * 24))} days`
                    : "unknown",
                  openIssues: safeNumber((meta as Record<string, unknown>).open_issues_count) ?? 0,
                  stars: safeNumber((meta as Record<string, unknown>).stargazers_count) ?? 0,
                },
                model: orchestratorRes.providers[0] ?? "multi-agent-v2",
                isDemo: false,
              };

              // Only cache results that look real: either there are actual issues found,
              // or the health score is below 95 (a perfect 100 with zero findings
              // usually means all agents failed silently — don't poison the cache).
              const hasRealFindings = (result.security?.issues?.length ?? 0) > 0 ||
                (result.codeQuality?.issues?.length ?? 0) > 0 ||
                (result.performance?.issues?.length ?? 0) > 0;
              if (!isPrivateRepo && (hasRealFindings || result.healthScore < 95)) {
                savePublicScanCache(repo, scanMode, result as unknown as Record<string, unknown>, isPrivateRepo)
                  .catch(() => { /* non-blocking */ });
              }

              await Promise.all([
                prisma.codeReviewScan.create({
                  data: {
                    userId: session.user.id, repo, scanMode, analysisType: "repo",
                    result: JSON.parse(JSON.stringify(result)),
                    tokensUsed: orchestratorRes.totalTokens.input + orchestratorRes.totalTokens.output,
                  },
                }),
                saveRepoKnowledge(session.user.id, repo, plan, {
                  summary: result.summary,
                  patterns: result.architecture.patterns,
                  insights: {
                    healthScore: result.healthScore,
                    securityGrade: result.security.grade,
                    qualityGrade: result.codeQuality.grade,
                    techDebtLevel: result.techDebt.level,
                    topIssues: (result.security.issues ?? []).slice(0, 3).map((i) => i.description),
                  },
                  fileCount: fileTree.length,
                  tokensUsed: orchestratorRes.totalTokens.input + orchestratorRes.totalTokens.output,
                }),
              ]);
            }
          } catch (aiErr) {
            // AI agents failed — fall back to internal AI as last resort
            if (process.env.NODE_ENV !== "production") {
              console.error("[repo-scan] Multi-agent error — falling back to internal:", aiErr);
            }
            emit({ type: "progress", step: "AI error — falling back to static analysis…", percent: 80 });
            internalScanResult = scanRepoWithInternalAI({
              repo, fileTree, keyFileContents, recentCommits, contributors, meta, scanMode,
              realLoc, realLocByExt, totalCodeFiles, importGraph,
            });
            result = { ...internalScanResult, model: "internal-ai-v3", isDemo: false };
          }
        }

        emit({ type: "progress", step: "Compiling report…", percent: 95 });

        // ── Safety check: ensure result is always defined ──────────────────
        if (!result) {
          emit({ type: "progress", step: "Fallback analysis…", percent: 90 });
          if (!internalScanResult) {
            internalScanResult = scanRepoWithInternalAI({
              repo, fileTree, keyFileContents, recentCommits, contributors, meta, scanMode,
              realLoc, realLocByExt, totalCodeFiles, importGraph,
            });
          }
          result = { ...internalScanResult, model: "internal-ai-v3", isDemo: false };
        }

        // ── Save scan history (Pro+ only) ─────────────────────────────────
        if (caps.scanHistoryDays > 0) {
          try {
            const secIssues = result.security?.issues ?? [];
            const critCount = secIssues.filter((i) => i.severity === "critical").length;
            const highCount = secIssues.filter((i) => i.severity === "high").length;
            const medCount  = secIssues.filter((i) => i.severity === "medium").length;

            // Fetch previous scan score for drop_by rule comparison
            const prevScan = await prisma.repoScanHistory.findFirst({
              where: { userId: session.user.id, repo },
              orderBy: { createdAt: "desc" },
              select: { healthScore: true },
            });

            await prisma.repoScanHistory.create({
              data: {
                userId: session.user.id,
                repo,
                scanMode,
                healthScore:      result.healthScore ?? 0,
                securityScore:    result.security?.score ?? 0,
                qualityScore:     result.codeQuality?.score ?? 0,
                performanceScore: result.performance?.score ?? 0,
                criticalCount:    critCount,
                highCount:        highCount,
                mediumCount:      medCount,
                locEstimate:      result.metrics?.estimatedLoc ?? null,
                filesScanned:     filesRead,
                summary:          result.summary ?? "",
                model:            result.model ?? null,
                tokensUsed:       0,
              },
            });

            // Prune entries older than the plan's retention window
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - caps.scanHistoryDays);
            await prisma.repoScanHistory.deleteMany({
              where: { userId: session.user.id, repo, createdAt: { lt: cutoff } },
            });

            // ── Fire outbound automation rules (Team+) ────────────────────
            triggerWebhookRules(session.user.id, {
              repo,
              healthScore:   result.healthScore ?? 0,
              securityScore: result.security?.score ?? 0,
              qualityScore:  result.codeQuality?.score ?? 0,
              criticalCount: critCount,
              prevHealthScore: prevScan?.healthScore ?? null,
            }).catch(() => { /* non-blocking */ });

            // ── Check scheduled scan alert threshold ──────────────────────
            if (caps.scheduledScansAllowed) {
              const [scheduled, userForSlack] = await Promise.all([
                prisma.scheduledScan.findUnique({
                  where: { userId_repo: { userId: session.user.id, repo } },
                }),
                prisma.user.findUnique({
                  where: { id: session.user.id },
                  select: { slackWebhookUrl: true, discordWebhookUrl: true },
                }),
              ]);
              if (scheduled?.enabled && scheduled.alertOnDrop && scheduled.lastScore !== null) {
                const prevScore = scheduled.lastScore;
                const newScore  = result.healthScore ?? 0;
                const drop      = prevScore - newScore;
                if (drop >= scheduled.alertOnDrop) {
                  const alertPayload = {
                    repo,
                    prevScore,
                    newScore,
                    drop,
                    criticalCount: critCount,
                    highCount:     highCount,
                    summary:       result.summary ?? "",
                    scanMode,
                  };
                  if (scheduled.alertEmail) {
                    sendEmail({
                      to: scheduled.alertEmail,
                      ...buildScanAlertEmail(alertPayload),
                    }).catch(() => { /* non-blocking */ });
                  }
                  if (userForSlack?.slackWebhookUrl && caps.slackNotificationsAllowed) {
                    sendSlackScanAlert(userForSlack.slackWebhookUrl, alertPayload)
                      .catch(() => { /* non-blocking */ });
                  }
                  if (userForSlack?.discordWebhookUrl && caps.slackNotificationsAllowed) {
                    sendDiscordScanAlert(userForSlack.discordWebhookUrl, alertPayload)
                      .catch(() => { /* non-blocking */ });
                  }
                }
              }
              // Update lastRunAt + lastScore on scheduled scan if one exists
              if (scheduled) {
                const next = new Date();
                if (scheduled.schedule === "daily")   next.setDate(next.getDate() + 1);
                if (scheduled.schedule === "weekly")  next.setDate(next.getDate() + 7);
                if (scheduled.schedule === "monthly") next.setMonth(next.getMonth() + 1);
                await prisma.scheduledScan.update({
                  where: { id: scheduled.id },
                  data:  { lastRunAt: new Date(), lastScore: result.healthScore ?? 0, nextRunAt: next },
                });
              }
            }
          } catch {
            // History/alert errors are non-fatal — never fail the scan response
          }
        }

        done(result);
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[repo-scan]", err);
        }
        done(undefined, err instanceof Error ? err.message : "Scan failed");
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
