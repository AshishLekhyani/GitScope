/**
 * GitScope AI Engine
 *
 * Tiered AI architecture:
 * - free: lite analysis (single-pass fast model + strong heuristics fallback)
 * - professional: multi-agent analysis (specialists + synthesis)
 * - team/enterprise: deeper specialist set and wider context windows
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AiPlan } from "@/lib/ai-plan";

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

type Provider = "anthropic" | "openai" | "none";

function detectProvider(): Provider {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  if (explicit === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (explicit === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

const PROVIDER = detectProvider();

export function hasAIProvider(): boolean {
  return PROVIDER !== "none";
}

const anthropic =
  PROVIDER === "anthropic"
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

const openai =
  PROVIDER === "openai"
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const FAST_MODEL =
  PROVIDER === "openai"
    ? (process.env.OPENAI_FAST_MODEL ?? "gpt-4o-mini")
    : (process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-4-5-20251001");

const SMART_MODEL =
  PROVIDER === "openai"
    ? (process.env.OPENAI_SMART_MODEL ?? "gpt-4o")
    : (process.env.ANTHROPIC_SMART_MODEL ?? "claude-sonnet-4-6");

async function callAI(opts: {
  model: "fast" | "smart";
  system: string;
  prompt: string;
  maxTokens: number;
}): Promise<string> {
  const model = opts.model === "fast" ? FAST_MODEL : SMART_MODEL;

  if (anthropic) {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    return msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  }

  if (openai) {
    const res = await openai.chat.completions.create({
      model,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? "";
  }

  return "";
}

function extractJSON<T>(text: string, arrayMode = false): T | null {
  try {
    const pattern = arrayMode ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
    const match = text.match(pattern);
    if (!match) return null;
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

function tierDepth(plan: AiPlan): 0 | 1 | 2 | 3 {
  if (plan === "enterprise") return 3;
  if (plan === "team") return 3;
  if (plan === "professional") return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Quick batch analysis (PR list cards)
// ---------------------------------------------------------------------------

export interface PRSummary {
  number: number;
  title: string;
  body: string;
  user: string;
  userRepos: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  fileNames: string[];
  riskScore: number;
}

export interface PRQuickAnalysis {
  headline: string;
  analysis: string;
  flags: string[];
  hotFiles: string[];
  confidence?: "low" | "medium" | "high";
}

function heuristicQuick(p: PRSummary): PRQuickAnalysis {
  const churn = p.additions + p.deletions;
  const flags: string[] = [];

  if (p.riskScore >= 70) flags.push("high-churn");
  if (churn >= 500) flags.push("large-diff");
  if (p.fileNames.some((f) => /auth|security|jwt|token|password|secret/i.test(f))) flags.push("security");
  if (p.fileNames.some((f) => /schema|migration|prisma|sql|db/i.test(f))) flags.push("database");
  if (p.fileNames.some((f) => /package\.json|go\.mod|requirements|Cargo\.toml|pom\.xml|Gemfile/i.test(f))) flags.push("deps");
  if (p.fileNames.some((f) => /route\.ts|controller|api/i.test(f))) flags.push("api-contract");
  if (!p.fileNames.some((f) => /test|spec|__tests__/i.test(f)) && churn > 200) flags.push("test-coverage");

  const headline =
    p.riskScore >= 75
      ? "High-impact change with broad blast radius"
      : p.riskScore >= 45
      ? "Moderate risk, review with intent"
      : "Low risk and likely safe to ship";

  const analysis =
    p.riskScore >= 75
      ? `This PR is touching ${p.changedFiles} files (+${p.additions}/-${p.deletions}), so the blast radius is real. I would prioritize security paths and regression checks before merge.`
      : p.riskScore >= 45
      ? `Scope is moderate across ${p.changedFiles} files. Focus on interface changes and downstream dependency impact during review.`
      : `The change is fairly contained. A focused review plus smoke tests should usually be enough.`;

  return {
    headline,
    analysis,
    flags,
    hotFiles: p.fileNames.slice(0, 3),
    confidence: "medium",
  };
}

type SpecialistQuickOutput = {
  number: number;
  notes?: string;
  flags?: string[];
  hotFiles?: string[];
  riskDelta?: number;
};

async function runQuickSpecialist(role: "security" | "architecture" | "delivery", prs: PRSummary[]): Promise<SpecialistQuickOutput[]> {
  const systemByRole: Record<typeof role, string> = {
    security:
      "You are a strict security reviewer. Focus on auth, secret handling, unsafe inputs, privilege boundaries, and dependency risk.",
    architecture:
      "You are a principal engineer reviewing architecture and maintainability. Focus on module boundaries, API contracts, and coupling risk.",
    delivery:
      "You are a release manager reviewing delivery risk. Focus on churn, blast radius, migration risk, and testing confidence.",
  };

  const blocks = prs
    .map(
      (p) => `PR #${p.number}\nTitle: ${p.title}\nRisk seed: ${p.riskScore}\nDiff: +${p.additions}/-${p.deletions} across ${p.changedFiles} files\nFiles: ${p.fileNames.slice(0, 14).join(", ") || "none"}\nBody: ${(p.body || "").slice(0, 320)}`
    )
    .join("\n\n---\n\n");

  const prompt = `Analyze each PR from the perspective of ${role}.

${blocks}

Return ONLY JSON array:
[
  {
    "number": 123,
    "notes": "1 short sentence specific to this PR",
    "flags": ["security", "api-contract"],
    "hotFiles": ["src/x.ts"],
    "riskDelta": -15..15
  }
]`;

  try {
    const text = await callAI({
      model: "fast",
      system: systemByRole[role],
      prompt,
      maxTokens: 1300,
    });

    const parsed = extractJSON<SpecialistQuickOutput[]>(text, true);
    if (!parsed) return [];
    return parsed;
  } catch {
    return [];
  }
}

async function runQuickSynthesis(
  prs: PRSummary[],
  specialists: Record<string, SpecialistQuickOutput[]>,
  model: "fast" | "smart"
): Promise<Map<number, PRQuickAnalysis>> {
  const prompt = `You are the lead AI reviewer. Merge specialist outputs into final PR cards.

PR input:
${JSON.stringify(prs)}

Specialist outputs:
${JSON.stringify(specialists)}

Return ONLY JSON array:
[
  {
    "number": 123,
    "headline": "6-10 words",
    "analysis": "2-3 sentences, concrete and technical",
    "flags": ["security", "deps"],
    "hotFiles": ["src/a.ts", "src/b.ts"],
    "confidence": "low|medium|high"
  }
]`;

  try {
    const text = await callAI({
      model,
      system:
        "You write as a helpful senior teammate. Keep the summary concise, concrete, and human. Ground every claim in file paths and change size.",
      prompt,
      maxTokens: model === "smart" ? 2200 : 1500,
    });

    const rows = extractJSON<
      {
        number: number;
        headline: string;
        analysis: string;
        flags?: string[];
        hotFiles?: string[];
        confidence?: "low" | "medium" | "high";
      }[]
    >(text, true);

    if (!rows) return new Map();

    return new Map(
      rows.map((r) => [
        r.number,
        {
          headline: r.headline,
          analysis: r.analysis,
          flags: r.flags ?? [],
          hotFiles: r.hotFiles ?? [],
          confidence: r.confidence ?? "medium",
        },
      ])
    );
  } catch {
    return new Map();
  }
}

export async function analyzePRBatch(
  prs: PRSummary[],
  options?: { plan?: AiPlan }
): Promise<Map<number, PRQuickAnalysis>> {
  const plan = options?.plan ?? "free";
  if (prs.length === 0) return new Map();

  const heuristicMap = new Map(prs.map((p) => [p.number, heuristicQuick(p)]));
  if (PROVIDER === "none") return heuristicMap;

  const depth = tierDepth(plan);

  // Lite single-pass mode for free users.
  if (depth <= 1) {
    const blocks = prs
      .slice(0, 6)
      .map(
        (p) => `PR #${p.number}: ${p.title}\nDiff: +${p.additions}/-${p.deletions} across ${p.changedFiles} files\nFiles: ${p.fileNames.slice(0, 12).join(", ") || "none"}\nBody: ${(p.body || "").slice(0, 260)}`
      )
      .join("\n\n---\n\n");

    const prompt = `Return JSON array with one object per PR:
[
  {
    "number": 1,
    "headline": "...",
    "analysis": "...",
    "flags": ["security"],
    "hotFiles": ["src/file.ts"],
    "confidence": "low|medium|high"
  }
]

${blocks}`;

    try {
      const text = await callAI({
        model: "fast",
        system:
          "You are a practical engineering reviewer. Write clear and human PR summaries with concrete risks and next checks.",
        prompt,
        maxTokens: 1300,
      });

      const rows = extractJSON<
        {
          number: number;
          headline: string;
          analysis: string;
          flags?: string[];
          hotFiles?: string[];
          confidence?: "low" | "medium" | "high";
        }[]
      >(text, true);

      if (!rows) return heuristicMap;

      for (const row of rows) {
        heuristicMap.set(row.number, {
          headline: row.headline,
          analysis: row.analysis,
          flags: row.flags ?? [],
          hotFiles: row.hotFiles ?? [],
          confidence: row.confidence ?? "medium",
        });
      }

      return heuristicMap;
    } catch {
      return heuristicMap;
    }
  }

  const specialistRoles: ("security" | "architecture" | "delivery")[] =
    depth >= 3
      ? ["security", "architecture", "delivery"]
      : ["security", "delivery"];

  const specialistEntries = await Promise.all(
    specialistRoles.map(async (role) => [role, await runQuickSpecialist(role, prs)] as const)
  );

  const specialistMap: Record<string, SpecialistQuickOutput[]> = Object.fromEntries(specialistEntries);

  const synthesized = await runQuickSynthesis(prs, specialistMap, depth >= 3 ? "smart" : "fast");

  for (const pr of prs) {
    if (!synthesized.has(pr.number)) {
      const base = heuristicMap.get(pr.number)!;
      const specialistFlags = specialistRoles.flatMap((role) =>
        (specialistMap[role] ?? [])
          .find((entry) => entry.number === pr.number)
          ?.flags ?? []
      );
      synthesized.set(pr.number, {
        ...base,
        flags: Array.from(new Set([...base.flags, ...specialistFlags])),
      });
    }
  }

  return synthesized;
}

// ---------------------------------------------------------------------------
// Deep code impact scan (single PR with code context)
// ---------------------------------------------------------------------------

export interface Concern {
  severity: "critical" | "high" | "medium" | "low";
  category: "security" | "performance" | "logic" | "maintainability" | "breaking" | "testing" | "config";
  file?: string;
  description: string;
  suggestion: string;
}

export interface DeepImpactResult {
  headline: string;
  summary: string;

  riskScore: number;
  riskLevel: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "STABLE";

  dimensions: {
    security: number;
    performance: number;
    maintainability: number;
    testability: number;
    breakingChange: number;
  };

  concerns: Concern[];
  breakingChanges: string[];

  impactAreas: string[];
  affectedSystems: string[];

  recommendation: string;
  reviewChecklist: string[];
  suggestedReviewers: number;
  estimatedReviewTime: string;

  provider: string;
  model: string;
  analysisTier?: AiPlan;
  agentCount?: number;
}

function riskLevelFromScore(score: number): DeepImpactResult["riskLevel"] {
  if (score >= 85) return "CRITICAL";
  if (score >= 70) return "HIGH";
  if (score >= 45) return "MODERATE";
  if (score >= 20) return "LOW";
  return "STABLE";
}

function heuristicDeep(input: {
  additions: number;
  deletions: number;
  files: { filename: string; additions: number; deletions: number }[];
}): DeepImpactResult {
  const churn = input.additions + input.deletions;
  const fileCount = input.files.length;

  const security = clamp(
    (input.files.some((f) => /auth|token|secret|password|jwt/i.test(f.filename)) ? 35 : 10) +
      (churn > 600 ? 20 : 5),
    0,
    100
  );
  const performance = clamp(
    (input.files.some((f) => /query|cache|performance|worker|stream/i.test(f.filename)) ? 30 : 10) +
      (churn > 900 ? 20 : 8),
    0,
    100
  );
  const maintainability = clamp((fileCount * 3) + (churn > 500 ? 20 : 8), 0, 100);
  const testability = clamp(
    (input.files.some((f) => /test|spec|__tests__/i.test(f.filename)) ? 20 : 60) +
      (churn > 700 ? 15 : 5),
    0,
    100
  );
  const breakingChange = clamp(
    (input.files.some((f) => /route|api|schema|migration|types?/i.test(f.filename)) ? 40 : 10) +
      (churn > 700 ? 20 : 8),
    0,
    100
  );

  const riskScore = Math.round(
    (security * 0.25) +
      (performance * 0.2) +
      (maintainability * 0.2) +
      (testability * 0.15) +
      (breakingChange * 0.2)
  );

  const concerns: Concern[] = [];
  if (security >= 60) {
    concerns.push({
      severity: "high",
      category: "security",
      description: "Sensitive auth or token related paths are being modified and require focused review.",
      suggestion: "Run auth-path regression tests and verify no token/secret handling logic weakened.",
    });
  }
  if (breakingChange >= 60) {
    concerns.push({
      severity: "medium",
      category: "breaking",
      description: "API/schema adjacent files changed with enough scope to risk downstream compatibility.",
      suggestion: "Validate request/response contracts and migration impacts before merge.",
    });
  }

  return {
    headline: riskScore >= 70 ? "High impact change requires specialist review" : "Moderate impact engineering change",
    summary: `Heuristic analysis detected ${fileCount} changed files with +${input.additions}/-${input.deletions} churn. Prioritize review around high-change modules and contract-sensitive paths.`,
    riskScore,
    riskLevel: riskLevelFromScore(riskScore),
    dimensions: { security, performance, maintainability, testability, breakingChange },
    concerns,
    breakingChanges: [],
    impactAreas: ["Code Quality", "Delivery Risk"],
    affectedSystems: ["api", "application"],
    recommendation:
      "Use at least one domain reviewer plus one code owner reviewer for high-change files. Ensure tests cover newly touched paths.",
    reviewChecklist: [
      "Validate auth and permission checks in touched routes",
      "Check API or schema compatibility with existing clients",
      "Confirm tests cover the changed behaviors",
    ],
    suggestedReviewers: riskScore >= 70 ? 3 : 2,
    estimatedReviewTime: riskScore >= 70 ? "60-90 min" : "25-45 min",
    provider: "heuristic",
    model: "none",
  };
}

async function runDeepSpecialist(role: string, context: string): Promise<string> {
  const roleSystem: Record<string, string> = {
    security:
      "You are an AppSec engineer. Identify security and data exposure risks only. Be specific and concise.",
    architecture:
      "You are a staff software architect. Focus on coupling, maintainability, and API/schema contract risks.",
    testing:
      "You are a test strategy engineer. Focus on coverage gaps and high-risk untested paths.",
    performance:
      "You are a performance engineer. Focus on latency, memory, query, and scale risks.",
    operations:
      "You are an SRE reviewer. Focus on deployment, observability, and rollback risk.",
  };

  const system = roleSystem[role] ?? roleSystem.architecture;
  const prompt = `Review this pull request context and provide a compact specialist note.

Return plain text with:
1) Top findings (max 5 bullets)
2) Highest-risk files
3) One action recommendation

Context:
${context}`;

  try {
    return await callAI({ model: "fast", system, prompt, maxTokens: 700 });
  } catch {
    return "";
  }
}

export async function deepCodeImpact(
  input: {
    prNumber: number;
    title: string;
    body: string;
    author: string;
    additions: number;
    deletions: number;
    files: {
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
      snippet?: string;
    }[];
  },
  options?: {
    plan?: AiPlan;
    maxFiles?: number;
  }
): Promise<DeepImpactResult> {
  const plan = options?.plan ?? "free";
  const fallback = heuristicDeep(input);

  if (PROVIDER === "none") {
    return {
      ...fallback,
      analysisTier: plan,
      agentCount: 0,
      provider: "none",
      model: "none",
    };
  }

  const depth = tierDepth(plan);
  const maxFiles = options?.maxFiles ?? (plan === "free" ? 4 : plan === "professional" ? 10 : plan === "team" ? 20 : 35);

  const sortedFiles = [...input.files]
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .slice(0, maxFiles);

  const fileContext = sortedFiles
    .map((f) => {
      const patch = f.patch ? `\nPATCH:\n${f.patch.slice(0, 1200)}` : "";
      const snippet = f.snippet ? `\nCODE:\n${f.snippet.slice(0, 1800)}` : "";
      return `FILE ${f.filename} [${f.status}] +${f.additions}/-${f.deletions}${patch}${snippet}`;
    })
    .join("\n\n---\n\n");

  const context = `PR #${input.prNumber}: ${input.title}
Author: ${input.author}
Diff: +${input.additions}/-${input.deletions}
Description: ${(input.body || "").slice(0, 1200)}

${fileContext}`;

  const specialistRoles =
    depth <= 1
      ? []
      : depth === 2
      ? ["security", "architecture"]
      : plan === "enterprise"
      ? ["security", "architecture", "testing", "performance", "operations"]
      : ["security", "architecture", "testing", "performance"];

  const specialistNotes: Record<string, string> = {};
  if (specialistRoles.length > 0) {
    const pairs = await Promise.all(
      specialistRoles.map(async (role) => [role, await runDeepSpecialist(role, context)] as const)
    );
    for (const [role, note] of pairs) {
      specialistNotes[role] = note;
    }
  }

  const synthPrompt = `You are GitScope's lead AI reviewer.

Merge PR context and specialist notes into one strict JSON report.

PR context:
${context}

Specialist notes:
${JSON.stringify(specialistNotes)}

Return ONLY JSON with this exact shape:
{
  "headline": "6-10 words",
  "summary": "3-4 sentences",
  "riskScore": 0,
  "riskLevel": "CRITICAL|HIGH|MODERATE|LOW|STABLE",
  "dimensions": {
    "security": 0,
    "performance": 0,
    "maintainability": 0,
    "testability": 0,
    "breakingChange": 0
  },
  "concerns": [
    {
      "severity": "critical|high|medium|low",
      "category": "security|performance|logic|maintainability|breaking|testing|config",
      "file": "optional filename",
      "description": "specific issue",
      "suggestion": "specific fix"
    }
  ],
  "breakingChanges": ["..."] ,
  "impactAreas": ["..."],
  "affectedSystems": ["..."],
  "recommendation": "...",
  "reviewChecklist": ["..."],
  "suggestedReviewers": 1,
  "estimatedReviewTime": "20-30 min"
}`;

  try {
    const model: "fast" | "smart" = depth >= 2 ? "smart" : "fast";
    const text = await callAI({
      model,
      system:
        "You are a principal engineer coaching a teammate. Be direct but human, avoid robotic phrasing, and ground every finding in the provided context.",
      prompt: synthPrompt,
      maxTokens: depth >= 3 ? 3200 : 2200,
    });

    const parsed = extractJSON<DeepImpactResult>(text);
    if (!parsed) {
      return {
        ...fallback,
        analysisTier: plan,
        agentCount: specialistRoles.length + 1,
        provider: PROVIDER,
        model,
      };
    }

    const riskScore = clamp(Number(parsed.riskScore ?? 0), 0, 100);

    return {
      ...parsed,
      riskScore,
      riskLevel: parsed.riskLevel ?? riskLevelFromScore(riskScore),
      dimensions: {
        security: clamp(parsed.dimensions?.security ?? 0, 0, 100),
        performance: clamp(parsed.dimensions?.performance ?? 0, 0, 100),
        maintainability: clamp(parsed.dimensions?.maintainability ?? 0, 0, 100),
        testability: clamp(parsed.dimensions?.testability ?? 0, 0, 100),
        breakingChange: clamp(parsed.dimensions?.breakingChange ?? 0, 0, 100),
      },
      concerns: parsed.concerns ?? [],
      breakingChanges: parsed.breakingChanges ?? [],
      impactAreas: parsed.impactAreas ?? [],
      affectedSystems: parsed.affectedSystems ?? [],
      reviewChecklist: parsed.reviewChecklist ?? [],
      suggestedReviewers: clamp(Number(parsed.suggestedReviewers ?? 2), 1, 5),
      estimatedReviewTime: parsed.estimatedReviewTime ?? "30-45 min",
      provider: PROVIDER,
      model: model === "fast" ? FAST_MODEL : SMART_MODEL,
      analysisTier: plan,
      agentCount: specialistRoles.length + 1,
    };
  } catch {
    return {
      ...fallback,
      analysisTier: plan,
      agentCount: specialistRoles.length + 1,
      provider: PROVIDER,
      model: SMART_MODEL,
    };
  }
}
