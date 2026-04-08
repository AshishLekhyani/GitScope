export const dynamic = "force-dynamic";
export const maxDuration = 90;

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { resolveAiPlanFromSessionDb, getCapabilitiesForPlan } from "@/lib/ai-plan";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { scanRepoWithInternalAI } from "@/lib/internal-ai";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RepoScanFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: "security" | "performance" | "architecture" | "quality" | "deps" | "testing" | "config";
  file?: string;
  description: string;
  suggestion: string;
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

function buildRepoScanPrompt(params: {
  repo: string;
  meta: Record<string, unknown>;
  fileTree: string[];
  keyFileContents: Record<string, string>;
  recentCommits: string[];
  contributors: number;
  openPRCount: number;
  scanMode: string;
}): string {
  const {
    repo, meta, fileTree, keyFileContents, recentCommits, contributors, openPRCount, scanMode,
  } = params;

  const fileTreeStr = fileTree.slice(0, 80).join("\n");
  const keyFilesStr = Object.entries(keyFileContents)
    .map(([name, content]) => `\n### ${name}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``)
    .join("\n");

  return `You are a principal engineer conducting a comprehensive codebase health audit. Return ONLY valid JSON — no markdown, no preamble.

REPOSITORY: ${repo}
Mode: ${scanMode === "deep" ? "Full Codebase Scan" : "Quick Health Check"}

METADATA:
${JSON.stringify(meta, null, 2).slice(0, 1000)}

Contributors: ${contributors} | Open PRs: ${openPRCount}

RECENT COMMITS (last 10):
${recentCommits.map((m, i) => `${i + 1}. ${m}`).join("\n") || "None available"}

FILE TREE (${fileTree.length} total files shown):
${fileTreeStr}

${scanMode === "deep" && keyFilesStr ? `KEY FILES:\n${keyFilesStr}` : ""}

Return this exact JSON structure:
{
  "healthScore": <0-100, overall codebase health>,
  "summary": "<3-4 sentence executive summary of the codebase state>",
  "architecture": {
    "summary": "<2-3 sentence architecture description>",
    "patterns": ["<e.g. MVC, REST API, Event-driven>"],
    "strengths": ["<architectural strength>"],
    "concerns": ["<architectural concern>"]
  },
  "security": {
    "score": <0-100, higher=safer>,
    "grade": "A"|"B"|"C"|"D"|"F",
    "issues": [{ "severity": "critical"|"high"|"medium"|"low", "category": "security", "file": null, "description": "...", "suggestion": "..." }],
    "positives": ["<good security practice observed>"]
  },
  "codeQuality": {
    "score": <0-100>,
    "grade": "A"|"B"|"C"|"D"|"F",
    "issues": [{ "severity": "medium"|"low", "category": "quality", "file": null, "description": "...", "suggestion": "..." }],
    "strengths": ["<code quality strength>"]
  },
  "testability": {
    "score": <0-100>,
    "grade": "A"|"B"|"C"|"D"|"F",
    "hasTestFramework": <boolean>,
    "coverageEstimate": "<e.g. '~40%' or 'Unknown'>",
    "gaps": ["<untested area>"]
  },
  "dependencies": {
    "score": <0-100>,
    "totalCount": <integer>,
    "risks": ["<dependency risk>"],
    "outdatedSignals": ["<outdated dep signal>"]
  },
  "techDebt": {
    "score": <0-100, higher=less debt>,
    "level": "minimal"|"manageable"|"significant"|"severe",
    "hotspots": ["<file or area with debt>"],
    "estimatedHours": "<e.g. '20-40 hours'>"
  },
  "recommendations": [
    {
      "priority": "immediate"|"short-term"|"long-term",
      "title": "<concise title>",
      "description": "<actionable description>",
      "effort": "low"|"medium"|"high"
    }
  ],
  "metrics": {
    "primaryLanguage": "${meta.language ?? "Unknown"}",
    "fileCount": ${fileTree.length},
    "estimatedLoc": "<e.g. '~15,000 lines'>",
    "contributors": ${contributors},
    "repoAge": "<e.g. '2 years'>",
    "openIssues": ${meta.open_issues_count ?? 0},
    "stars": ${meta.stargazers_count ?? 0}
  }
}`;
}

// ── Demo data ──────────────────────────────────────────────────────────────────

function getDemoScanResult(repo: string): RepoScanResult {
  return {
    healthScore: 72,
    summary: `${repo} is a moderately healthy TypeScript/Next.js application with solid architectural foundations. The codebase demonstrates good separation of concerns and consistent patterns, but carries meaningful security and test coverage debt that should be addressed before scaling. The dependency tree is manageable with a few outdated packages worth investigating.`,
    architecture: {
      summary: "Full-stack Next.js application using App Router with clear feature-based module structure. API routes follow RESTful conventions with middleware-based security. Frontend uses React Server Components with client-side state management.",
      patterns: ["Feature-based modules", "REST API", "Server Components", "Middleware pipeline"],
      strengths: [
        "Clean separation between features and shared utilities",
        "Consistent API route structure with security middleware",
        "TypeScript throughout — good type safety coverage",
      ],
      concerns: [
        "Some large components would benefit from further decomposition",
        "Inconsistent error handling patterns across API routes",
      ],
    },
    security: {
      score: 68,
      grade: "C",
      issues: [
        {
          severity: "high",
          category: "security",
          file: "src/lib/auth.ts",
          description: "Session token not rotated after privilege escalation — potential session fixation risk.",
          suggestion: "Call session.regenerate() or equivalent after any permission change.",
        },
        {
          severity: "medium",
          category: "security",
          file: "src/app/api",
          description: "Several API routes lack input sanitization for string fields, creating potential injection vectors.",
          suggestion: "Use a validation library (zod, yup) to sanitize all user inputs at route entry points.",
        },
        {
          severity: "low",
          category: "config",
          file: ".env.example",
          description: "Missing security-relevant environment variable documentation.",
          suggestion: "Document all required security env vars with descriptions and example values.",
        },
      ],
      positives: [
        "CSRF protection implemented via double-submit cookie pattern",
        "Rate limiting applied to sensitive endpoints",
        "Passwords hashed with bcrypt",
        "HTTP security headers configured (CSP, HSTS, X-Frame-Options)",
      ],
    },
    codeQuality: {
      score: 74,
      grade: "B",
      issues: [
        {
          severity: "medium",
          category: "quality",
          description: "Several async functions missing error boundaries — unhandled promise rejections possible.",
          suggestion: "Add try/catch to all top-level async handlers or use a global error boundary.",
          file: undefined,
        },
        {
          severity: "low",
          category: "quality",
          description: "Some utility functions duplicated across feature modules.",
          suggestion: "Consolidate into shared /lib utilities with clear ownership.",
          file: undefined,
        },
      ],
      strengths: [
        "Consistent naming conventions throughout the codebase",
        "Good use of TypeScript generics for reusable patterns",
        "Components are appropriately sized — no 'god components'",
      ],
    },
    testability: {
      score: 38,
      grade: "D",
      hasTestFramework: true,
      coverageEstimate: "~20-30%",
      gaps: [
        "API route handlers have minimal test coverage",
        "Authentication flows not covered by integration tests",
        "No E2E tests for critical user paths",
        "Utility functions in /lib lack unit tests",
      ],
    },
    dependencies: {
      score: 79,
      totalCount: 48,
      risks: [
        "2 dependencies have known security advisories (run npm audit)",
        "heavy bundle — consider code splitting for large UI deps",
      ],
      outdatedSignals: [
        "Some peer dependencies pinned to older major versions",
        "Prisma client should be kept in sync with schema generator version",
      ],
    },
    techDebt: {
      score: 58,
      level: "manageable",
      hotspots: ["src/features/ (some oversized modules)", "src/app/api/ (inconsistent patterns)", "test/ (coverage gaps)"],
      estimatedHours: "40-80 hours to baseline",
    },
    recommendations: [
      {
        priority: "immediate",
        title: "Add input validation to all API routes",
        description: "Install zod and add validation schemas to every API route handler. This single change eliminates the largest category of security risk.",
        effort: "medium",
      },
      {
        priority: "immediate",
        title: "Address npm audit vulnerabilities",
        description: "Run npm audit --fix and resolve the 2 known security advisories in dependencies. If not auto-fixable, evaluate alternatives.",
        effort: "low",
      },
      {
        priority: "short-term",
        title: "Increase test coverage to 60%+",
        description: "Focus on API route integration tests and authentication flows first — these are highest-risk lowest-coverage areas.",
        effort: "high",
      },
      {
        priority: "short-term",
        title: "Establish session rotation on privilege change",
        description: "Regenerate session tokens after login, logout, and any permission elevation to prevent session fixation attacks.",
        effort: "low",
      },
      {
        priority: "long-term",
        title: "Refactor oversized feature modules",
        description: "Some features have grown beyond single-responsibility. Plan a decomposition sprint to split into focused sub-modules.",
        effort: "high",
      },
    ],
    metrics: {
      primaryLanguage: "TypeScript",
      fileCount: 142,
      estimatedLoc: "~18,000 lines",
      contributors: 3,
      repoAge: "8 months",
      openIssues: 12,
      stars: 0,
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

  let body: { repo?: string; scanMode?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { repo, scanMode = "quick" } = body;

  if (!repo || typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return new Response(JSON.stringify({ error: "Invalid repo format. Use owner/repo" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

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
            `/repos/${repo}/git/trees/${meta.default_branch ?? "HEAD"}?recursive=1`,
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

        const fileTree = (treeData?.tree ?? [])
          .filter((t) => t.type === "blob")
          .map((t) => t.path)
          .slice(0, 200);

        const recentCommits = (commitsData ?? [])
          .slice(0, 10)
          .map((c) => c.commit.message.split("\n")[0].slice(0, 80));

        const contributors = (contributorsData ?? []).length;
        const openPRCount = (pullsData ?? []).length;

        // Fetch key files for context
        emit({ type: "progress", step: "Reading key configuration files…", percent: 38 });

        const keyFilesToFetch = [
          "package.json",
          "tsconfig.json",
          "README.md",
          ".eslintrc.json",
          ".eslintrc.js",
          "jest.config.ts",
          "jest.config.js",
          "next.config.ts",
          "next.config.js",
          "Dockerfile",
        ].filter((f) => fileTree.some((t) => t === f || t.endsWith(`/${f}`)));

        const keyFileContents: Record<string, string> = {};

        if (scanMode === "deep") {
          await Promise.all(
            keyFilesToFetch.slice(0, 6).map(async (f) => {
              const content = await ghFetchText(
                `/repos/${repo}/contents/${f}`,
                ghToken
              );
              if (content) keyFileContents[f] = content;
            })
          );
        } else {
          // Quick mode: just package.json
          const pkgContent = await ghFetchText(`/repos/${repo}/contents/package.json`, ghToken);
          if (pkgContent) {
            try {
              const pkg = JSON.parse(pkgContent);
              keyFileContents["package.json"] = JSON.stringify(
                { dependencies: pkg.dependencies, devDependencies: pkg.devDependencies },
                null,
                2
              );
            } catch {
              keyFileContents["package.json"] = pkgContent.slice(0, 1000);
            }
          }
        }

        emit({ type: "progress", step: "Running internal static analysis…", percent: 58 });

        // Always run internal AI — works without any API key
        const internalScanResult = scanRepoWithInternalAI({
          repo, fileTree, keyFileContents, recentCommits, contributors, meta, scanMode,
        });

        let result: RepoScanResult;

        if (!process.env.ANTHROPIC_API_KEY) {
          emit({ type: "progress", step: "Analysis complete…", percent: 90 });
          result = internalScanResult;
        } else {
          emit({ type: "progress", step: "Enhancing with deep AI analysis…", percent: 65 });

          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          const model =
            plan === "enterprise" ? "claude-opus-4-6" :
            plan === "team" || plan === "professional" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";

          const prompt = buildRepoScanPrompt({ repo, meta, fileTree, keyFileContents, recentCommits, contributors, openPRCount, scanMode });
          emit({ type: "progress", step: "AI scanning architecture, security, and quality…", percent: 78 });

          try {
            const message = await client.messages.create({
              model, max_tokens: 5120,
              messages: [{ role: "user", content: prompt }],
              system: "You are a principal engineer conducting a codebase health audit. Return ONLY valid JSON — no markdown, no code fences, no extra text.",
            });
            const text = message.content[0]?.type === "text" ? message.content[0].text : "{}";
            const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
            result = JSON.parse(cleaned) as RepoScanResult;
            result.model = model;
            result.isDemo = false;
            // Merge internal security issues LLM might have missed
            const llmDescs = new Set(result.security.issues.map((i) => i.description.slice(0, 40)));
            const extra = internalScanResult.security.issues.filter((i) => !llmDescs.has(i.description.slice(0, 40)));
            result.security.issues = [...result.security.issues, ...extra].slice(0, 8);
            await prisma.codeReviewScan.create({
              data: {
                userId: session.user.id, repo, scanMode, analysisType: "repo",
                result: JSON.parse(JSON.stringify(result)),
                tokensUsed: (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0),
              },
            });
          } catch {
            result = internalScanResult;
          }
        }

        emit({ type: "progress", step: "Compiling report…", percent: 95 });
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
