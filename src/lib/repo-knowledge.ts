/**
 * Codebase Memory System
 *
 * Stores AI-generated knowledge about repositories in the database, gated by plan tier.
 *
 * TTL by plan:
 *   free      — 1 hour  (ephemeral)
 *   developer — 30 days
 *
 * The knowledge is injected as context into subsequent AI scans, so the AI
 * "remembers" what it already knows about a codebase and builds on it rather
 * than starting from scratch every time.
 */

import { prisma } from "@/lib/prisma";

export type KnowledgeType = "scan-result" | "team-patterns" | "architecture";

export interface RepoKnowledgeEntry {
  repo: string;
  knowledgeType: KnowledgeType;
  summary: string;
  patterns: string[];
  insights: Record<string, unknown>;
  fileCount: number;
  tokensUsed: number;
  expiresAt: Date;
  lastUpdated: Date;
}

// ── Plan TTL config ─────────────────────────────────────────────────────────

const TTL_BY_PLAN: Record<string, number> = {
  free:         1 * 60 * 60 * 1000,          // 1 hour
  developer:    30 * 24 * 60 * 60 * 1000,    // 30 days
};

// Max knowledge entries per plan (across all repos)
const KNOWLEDGE_CAP_BY_PLAN: Record<string, number> = {
  free:      3,
  developer: 100,
};

export function getKnowledgeTTL(plan: string): number {
  return TTL_BY_PLAN[plan] ?? TTL_BY_PLAN.free;
}

export function getKnowledgeCap(plan: string): number {
  return KNOWLEDGE_CAP_BY_PLAN[plan] ?? KNOWLEDGE_CAP_BY_PLAN.free;
}

// ── Read ────────────────────────────────────────────────────────────────────

/**
 * Load cached knowledge for a repo. Returns null if not found or expired.
 * Also checks org-shared knowledge when orgId is provided.
 */
export async function loadRepoKnowledge(
  userId: string,
  repo: string,
  knowledgeType: KnowledgeType = "scan-result",
  orgId?: string
): Promise<RepoKnowledgeEntry | null> {
  try {
    const now = new Date();

    const entry = await prisma.repoKnowledge.findFirst({
      where: {
        OR: [
          { userId, repo, knowledgeType, expiresAt: { gt: now } },
          ...(orgId ? [{ orgId, repo, knowledgeType, expiresAt: { gt: now } }] : []),
        ],
      },
      orderBy: { lastUpdated: "desc" },
    });

    if (!entry) return null;

    return {
      repo: entry.repo,
      knowledgeType: entry.knowledgeType as KnowledgeType,
      summary: entry.summary,
      patterns: (entry.patterns as string[]) ?? [],
      insights: (entry.insights as Record<string, unknown>) ?? {},
      fileCount: entry.fileCount,
      tokensUsed: entry.tokensUsed,
      expiresAt: entry.expiresAt,
      lastUpdated: entry.lastUpdated,
    };
  } catch {
    // Table may not exist yet (migration pending) — return null gracefully
    return null;
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Save or update repo knowledge after a scan.
 * Upserts by (userId, repo, knowledgeType).
 * Enforces plan cap — evicts oldest entries if over limit.
 */
export async function saveRepoKnowledge(
  userId: string,
  repo: string,
  plan: string,
  data: {
    knowledgeType?: KnowledgeType;
    summary: string;
    patterns?: string[];
    insights?: Record<string, unknown>;
    fileCount?: number;
    tokensUsed?: number;
    orgId?: string;
  }
): Promise<void> {
  const {
    knowledgeType = "scan-result",
    summary,
    patterns = [],
    insights = {},
    fileCount = 0,
    tokensUsed = 0,
    orgId,
  } = data;

  const ttlMs = getKnowledgeTTL(plan);
  const expiresAt = new Date(Date.now() + ttlMs);

  try {
    await prisma.repoKnowledge.upsert({
      where: { userId_repo_knowledgeType: { userId, repo, knowledgeType } },
      create: {
        userId, orgId, repo, knowledgeType,
        summary, patterns,
        insights: insights as Parameters<typeof prisma.repoKnowledge.create>[0]["data"]["insights"],
        fileCount, tokensUsed, expiresAt,
      },
      update: {
        orgId, summary, patterns,
        insights: insights as Parameters<typeof prisma.repoKnowledge.create>[0]["data"]["insights"],
        fileCount, tokensUsed, expiresAt,
      },
    });

    // Enforce cap — evict oldest entries over the limit
    try {
      const cap = getKnowledgeCap(plan);
      const count = await prisma.repoKnowledge.count({ where: { userId } });
      if (count > cap) {
        const excess = await prisma.repoKnowledge.findMany({
          where: { userId },
          orderBy: { lastUpdated: "asc" },
          take: count - cap,
          select: { id: true },
        });
        await prisma.repoKnowledge.deleteMany({
          where: { id: { in: excess.map((e) => e.id) } },
        });
      }
    } catch {
      // Cap enforcement is best-effort
    }
  } catch (err) {
    // Knowledge is supplementary — never fail the main scan because of it
    if (process.env.NODE_ENV !== "production") {
      console.error("[RepoKnowledge] Save failed:", err);
    }
  }
}

// ── Purge ───────────────────────────────────────────────────────────────────

/** Delete all expired entries. Call from a cron or maintenance route. */
export async function purgeExpiredKnowledge(): Promise<number> {
  const result = await prisma.repoKnowledge.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

// ── Format for AI context injection ─────────────────────────────────────────

/**
 * Format cached knowledge as a context block to inject into AI prompts.
 * Tells the AI what it already knows about this repo so it can build on it
 * instead of repeating the same findings.
 */
export function formatKnowledgeForPrompt(knowledge: RepoKnowledgeEntry): string {
  const age = Math.round((Date.now() - knowledge.lastUpdated.getTime()) / (1000 * 60 * 60));
  const ageStr = age < 1 ? "< 1 hour ago" : age < 24 ? `${age}h ago` : `${Math.round(age / 24)}d ago`;

  const lines: string[] = [
    `## Cached Knowledge (from previous scan, ${ageStr})`,
    `This repo was previously analyzed. Use this context to build on prior findings.`,
    ``,
    `### Previous Summary`,
    knowledge.summary,
  ];

  if (knowledge.patterns.length > 0) {
    lines.push(`\n### Detected Patterns`);
    knowledge.patterns.forEach((p) => lines.push(`- ${p}`));
  }

  if (Object.keys(knowledge.insights).length > 0) {
    lines.push(`\n### Prior Insights`);
    lines.push(JSON.stringify(knowledge.insights, null, 2).slice(0, 1500));
  }

  lines.push(`\nNote: Focus on what has CHANGED or NEW issues since the last scan. Avoid repeating findings that are already documented above unless they are still present.`);

  return lines.join("\n");
}
