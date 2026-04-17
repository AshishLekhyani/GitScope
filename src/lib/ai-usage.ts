import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { AiPlan } from "@/lib/ai-plan";

export type AiUsageFeature =
  | "pr-risk"
  | "deep-impact"
  | "security-scan"
  | "dora-metrics"
  | "dependency-map"
  | "repo-analysis"
  | "code-review"
  | "repo-scan"
  | "repo-scan-llm";   // daily LLM cost gate (separate from hourly rate limit)

export interface UsageBudgetResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  used: number;
}

interface ConsumeUsageInput {
  userId: string;
  feature: AiUsageFeature;
  plan: AiPlan;
  limit: number;
  units?: number;
  windowMs?: number;
  metadata?: unknown;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

function computeResetAt(minCreatedAt: Date | null, windowMs: number): number {
  if (!minCreatedAt) return Date.now() + windowMs;
  return minCreatedAt.getTime() + windowMs;
}

export async function consumeUsageBudget(input: ConsumeUsageInput): Promise<UsageBudgetResult> {
  const units = Math.max(1, input.units ?? 1);
  const windowMs = input.windowMs ?? 60 * 60 * 1000;
  const since = new Date(Date.now() - windowMs);

  try {
    const usage = await prisma.aiUsageEvent.aggregate({
      where: {
        userId: input.userId,
        feature: input.feature,
        createdAt: { gte: since },
      },
      _sum: { units: true },
      _min: { createdAt: true },
    });

    const used = usage._sum.units ?? 0;
    if (used + units > input.limit) {
      return {
        allowed: false,
        remaining: Math.max(0, input.limit - used),
        resetAt: computeResetAt(usage._min.createdAt, windowMs),
        used,
      };
    }

    await prisma.aiUsageEvent.create({
      data: {
        userId: input.userId,
        feature: input.feature,
        plan: input.plan,
        units,
        metadata: toJson(input.metadata),
      },
    });

    const nextUsed = used + units;
    return {
      allowed: true,
      remaining: Math.max(0, input.limit - nextUsed),
      resetAt: computeResetAt(usage._min.createdAt, windowMs),
      used: nextUsed,
    };
  } catch {
    const fallback = await checkRateLimit(`usage:${input.feature}:${input.userId}`, {
      limit: input.limit,
      windowMs,
    });
    return {
      allowed: fallback.allowed,
      remaining: fallback.remaining,
      resetAt: fallback.resetAt,
      used: Math.max(0, input.limit - fallback.remaining),
    };
  }
}

interface TrackUsageInput {
  userId: string;
  feature: AiUsageFeature;
  plan: AiPlan;
  units?: number;
  metadata?: unknown;
}

export async function trackUsageEvent(input: TrackUsageInput): Promise<void> {
  try {
    await prisma.aiUsageEvent.create({
      data: {
        userId: input.userId,
        feature: input.feature,
        plan: input.plan,
        units: Math.max(1, input.units ?? 1),
        metadata: toJson(input.metadata),
      },
    });
  } catch {
    // Best effort tracking only.
  }
}

export async function getUsageSnapshot(userId: string, windowMs = 60 * 60 * 1000) {
  const since = new Date(Date.now() - windowMs);

  try {
    const grouped = await prisma.aiUsageEvent.groupBy({
      by: ["feature"],
      where: {
        userId,
        createdAt: { gte: since },
      },
      _sum: {
        units: true,
      },
    });

    const byFeature: Partial<Record<AiUsageFeature, number>> = {};
    let total = 0;
    for (const row of grouped) {
      const units = row._sum.units ?? 0;
      byFeature[row.feature as AiUsageFeature] = units;
      total += units;
    }

    return { byFeature, total, since: since.toISOString() };
  } catch {
    return { byFeature: {}, total: 0, since: since.toISOString() };
  }
}
