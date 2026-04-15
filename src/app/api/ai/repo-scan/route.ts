export const dynamic = "force-dynamic";
export const maxDuration = 90;

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { resolveAiPlanFromSessionDb, getCapabilitiesForPlan } from "@/lib/ai-plan";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { prisma } from "@/lib/prisma";
import { scanRepoWithInternalAI } from "@/lib/internal-ai";
import { callAI, hasAnyAIProvider, type AIPlan } from "@/lib/ai-providers";
import { loadRepoKnowledge, saveRepoKnowledge, formatKnowledgeForPrompt } from "@/lib/repo-knowledge";

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
1. Every finding MUST cite the EXACT filename from the file tree or contents provided (e.g. "src/lib/auth.ts", not just "auth file")
2. Every finding description MUST reference the SPECIFIC code pattern, function name, or line — not a generic summary. BAD: "3 console.log calls". GOOD: "console.log(user.password) in src/components/login-form.tsx line ~42 leaks sensitive data to browser console"
3. Every suggestion MUST be a CONCRETE fix — include corrected code snippet or exact command where possible. BAD: "Remove debug logs". GOOD: "Remove the console.log on line ~42; if logging is needed use a structured logger: logger.debug({ userId: user.id }, 'login attempt')"
4. Do NOT duplicate findings. If the same issue appears in 3 files, write ONE finding that lists all 3 files in the description.
5. Prioritise findings by real-world impact. Only include "low" severity if it is a genuine quality concern, not a style preference.
6. You return ONLY valid JSON. No markdown, no preamble, no trailing text.`;

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
  const isDeep = scanMode === "deep";

  const fileTreeStr = fileTree.slice(0, isDeep ? 120 : 80).join("\n");
  const keyFilesStr = Object.entries(keyFileContents)
    .map(([name, content]) => `\n### ${name}\n\`\`\`\n${content.slice(0, isDeep ? 3000 : 1800)}\n\`\`\``)
    .join("\n");

  return `Perform a ${isDeep ? "full deep" : "quick"} codebase health audit. Return ONLY valid JSON — no preamble, no markdown.

## Repository: ${repo}
Scan mode: ${isDeep ? "Deep (full codebase scan)" : "Quick (health check)"}
Language: ${meta.language ?? "Unknown"} | Stars: ${meta.stargazers_count ?? 0} | Open issues: ${meta.open_issues_count ?? 0}
Created: ${meta.created_at ?? "Unknown"} | Last push: ${meta.pushed_at ?? "Unknown"}
Contributors: ${contributors} | Open PRs: ${openPRCount}
Topics: ${Array.isArray(meta.topics) ? (meta.topics as string[]).join(", ") || "none" : "none"}
Description: ${meta.description ?? "none"}

## Recent Commits (last 10)
${recentCommits.map((m, i) => `${i + 1}. ${m}`).join("\n") || "None available"}

## File Tree (${fileTree.length} total files — first ${isDeep ? 120 : 80} shown)
${fileTreeStr}

## Key File Contents — READ THESE CAREFULLY, base findings on this actual code
${keyFilesStr || "(no file contents available — analyse from file tree only)"}

## Instructions — MANDATORY
- Base ALL findings on what you actually see in the file contents above — no speculation
- FILENAME RULE: Every finding.file must be an exact path visible in the file tree (e.g. "src/lib/auth.ts"). Never write "various files" or "multiple files" in the file field — use the most impactful single file, and mention others in the description.
- SPECIFICITY RULE: Descriptions must include the actual function/variable/pattern name. "The foo() function in src/api/users.ts lacks input validation" not "input validation is missing"
- SUGGESTION RULE: Every suggestion must include a concrete code fix or command. Show the corrected code, not just the principle.
- GROUPING RULE: If the same issue pattern repeats across multiple files, group into ONE finding. List all affected files in description.
- IMPACT RULE: Focus on findings with real production impact — security holes, data leaks, crashes, performance cliffs, broken contracts. Skip pure style preferences.
- Estimate LOC from the file tree size and average file length from the contents shown
- For dependency risks, check the exact package names in package.json deps shown above

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
        "suggestion": "<MUST include corrected code — e.g. 'Replace with: const hash = await bcrypt.hash(password, 12)' >"
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
        "category": "quality"|"performance"|"style",
        "file": "<exact filename from file tree>",
        "description": "<MUST name exact function/variable/pattern — e.g. 'fetchUser() in src/lib/db.ts makes an unbounded SELECT * without pagination, risking OOM on large datasets'>",
        "suggestion": "<MUST include concrete fix with code — e.g. 'Add: .take(100).skip(offset) to the Prisma query, and accept a page parameter in the function signature'>"
      }
    ],
    "strengths": ["<specific quality strength with evidence>"]
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
    "estimatedLoc": "<estimate from file count and average size e.g. '~12,000 lines'>",
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

        // Fetch key files for context — config files + actual source code
        emit({ type: "progress", step: "Identifying key files to read…", percent: 35 });

        // Config/root files that always give useful context
        const configFiles = [
          "package.json", "tsconfig.json", "README.md", "CHANGELOG.md",
          ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs",
          "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs",
          "biome.json", "biome.jsonc",
          "jest.config.ts", "jest.config.js", "vitest.config.ts", "vitest.config.js",
          "next.config.ts", "next.config.js",
          "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
          ".github/workflows/ci.yml", ".github/workflows/ci.yaml",
          ".github/workflows/deploy.yml", ".github/workflows/main.yml",
          ".gitlab-ci.yml", "Jenkinsfile", ".travis.yml",
          "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml",
          "middleware.ts", "middleware.js",
        ].filter((f) => fileTree.some((t) => t === f || t.endsWith(`/${f}`)));

        // Source files — pick the most important ones from the actual file tree
        const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"];
        const importantSourceFiles = fileTree.filter((f) => {
          const lower = f.toLowerCase();
          return (
            sourceExtensions.some((ext) => f.endsWith(ext)) &&
            // Prioritise: auth, API routes, lib, middleware, main entry points
            (lower.includes("auth") || lower.includes("api/") || lower.includes("/lib/") ||
             lower.includes("middleware") || lower.includes("main.") || lower.includes("index.") ||
             lower.includes("server.") || lower.includes("app.") || lower.includes("router") ||
             lower.includes("database") || lower.includes("db/") || lower.includes("prisma") ||
             lower.includes("model") || lower.includes("service") || lower.includes("controller") ||
             lower.includes("store") || lower.includes("schema") || lower.includes("util"))
          );
        }).slice(0, scanMode === "deep" ? 40 : 20);

        const keyFileContents: Record<string, string> = {};
        const configToFetch = scanMode === "deep" ? configFiles : configFiles.slice(0, 6);
        const allFilesToRead = [...configToFetch, ...importantSourceFiles];
        const totalFiles = allFilesToRead.length;

        // Read files sequentially so we can emit progress per file
        for (let i = 0; i < allFilesToRead.length; i++) {
          const f = allFilesToRead[i];
          const percent = Math.round(38 + (i / totalFiles) * 20); // 38%–58%
          const shortName = f.split("/").slice(-2).join("/");
          emit({ type: "progress", step: `Reading ${shortName}…`, percent });

          const actualPath = configToFetch.includes(f)
            ? (fileTree.find((t) => t === f || t.endsWith(`/${f}`)) ?? f)
            : f;
          const content = await ghFetchText(`/repos/${repo}/contents/${actualPath}`, ghToken);

          if (content) {
            if (f === "package.json" && scanMode !== "deep") {
              try {
                const pkg = JSON.parse(content);
                keyFileContents[f] = JSON.stringify(
                  { dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }, null, 2
                );
              } catch { keyFileContents[f] = content.slice(0, 2000); }
            } else {
              keyFileContents[f] = content.slice(0, scanMode === "deep" ? 4000 : 3000);
            }
          }
        }

        const filesRead = Object.keys(keyFileContents).length;
        emit({ type: "progress", step: `Read ${filesRead} files — running static analysis…`, percent: 58 });

        // Always run internal AI — works without any API key
        const internalScanResult = scanRepoWithInternalAI({
          repo, fileTree, keyFileContents, recentCommits, contributors, meta, scanMode,
        });

        let result: RepoScanResult;

        if (!hasAnyAIProvider()) {
          emit({ type: "progress", step: "Analysis complete…", percent: 90 });
          result = internalScanResult;
        } else {
          emit({ type: "progress", step: "Enhancing with AI analysis…", percent: 65 });

          // Build prompt — inject cached knowledge if available so AI builds on prior findings
          let basePrompt = buildRepoScanPrompt({ repo, meta, fileTree, keyFileContents, recentCommits, contributors, openPRCount, scanMode });
          if (cachedKnowledge) {
            emit({ type: "progress", step: "Loading memory from previous scan…", percent: 67 });
            basePrompt = formatKnowledgeForPrompt(cachedKnowledge) + "\n\n" + basePrompt;
          }

          emit({ type: "progress", step: "AI scanning architecture, security, and quality…", percent: 78 });
          try {
            const aiRes = await callAI({
              plan: plan as AIPlan,
              systemPrompt: REPO_SCAN_SYSTEM_PROMPT,
              userPrompt: basePrompt,
              maxTokens: 5120,
            });
            if (aiRes) {
              const cleaned = aiRes.text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
              result = JSON.parse(cleaned) as RepoScanResult;
              result.model = aiRes.model;
              result.isDemo = false;
              const llmDescs = new Set(result.security.issues.map((i) => i.description.slice(0, 40)));
              const extra = internalScanResult.security.issues.filter((i) => !llmDescs.has(i.description.slice(0, 40)));
              result.security.issues = [...result.security.issues, ...extra].slice(0, 8);

              await Promise.all([
                prisma.codeReviewScan.create({
                  data: {
                    userId: session.user.id, repo, scanMode, analysisType: "repo",
                    result: JSON.parse(JSON.stringify(result)),
                    tokensUsed: aiRes.inputTokens + aiRes.outputTokens,
                  },
                }),
                // Save knowledge for future scans
                saveRepoKnowledge(session.user.id, repo, plan, {
                  summary: result.summary,
                  patterns: result.architecture.patterns,
                  insights: {
                    healthScore: result.healthScore,
                    securityGrade: result.security.grade,
                    qualityGrade: result.codeQuality.grade,
                    techDebtLevel: result.techDebt.level,
                    topIssues: result.security.issues.slice(0, 3).map((i) => i.description),
                  },
                  fileCount: fileTree.length,
                  tokensUsed: aiRes.inputTokens + aiRes.outputTokens,
                }),
              ]);
            } else {
              result = internalScanResult;
            }
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
