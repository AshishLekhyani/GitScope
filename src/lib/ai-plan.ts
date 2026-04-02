import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import type { AiTier as PrismaAiTier } from "@prisma/client";

export type AiPlan = "free" | "professional" | "team" | "enterprise";

export interface AiCapabilities {
  plan: AiPlan;
  label: string;
  maxReposInWorkspace: number;
  maxReposPerRequest: number;
  maxOpenPRsPerRepo: number;
  maxFilesPerDeepScan: number;
  maxPackagesPerSecurityScan: number;
  aiAgentDepth: 0 | 1 | 2 | 3;
  aiRequestsPerHour: number;
  allowsPrivateRepoAnalysis: boolean;
  allowSharedTokenFallback: boolean;
}

const AI_CAPABILITIES: Record<AiPlan, AiCapabilities> = {
  free: {
    plan: "free",
    label: "Explorer",
    maxReposInWorkspace: 3,
    maxReposPerRequest: 3,
    maxOpenPRsPerRepo: 4,
    maxFilesPerDeepScan: 4,
    maxPackagesPerSecurityScan: 80,
    aiAgentDepth: 1,
    aiRequestsPerHour: 20,
    allowsPrivateRepoAnalysis: false,
    allowSharedTokenFallback: false,
  },
  professional: {
    plan: "professional",
    label: "Professional",
    maxReposInWorkspace: 10,
    maxReposPerRequest: 10,
    maxOpenPRsPerRepo: 10,
    maxFilesPerDeepScan: 10,
    maxPackagesPerSecurityScan: 220,
    aiAgentDepth: 2,
    aiRequestsPerHour: 80,
    allowsPrivateRepoAnalysis: true,
    allowSharedTokenFallback: false,
  },
  team: {
    plan: "team",
    label: "Team",
    maxReposInWorkspace: 20,
    maxReposPerRequest: 20,
    maxOpenPRsPerRepo: 18,
    maxFilesPerDeepScan: 20,
    maxPackagesPerSecurityScan: 500,
    aiAgentDepth: 3,
    aiRequestsPerHour: 240,
    allowsPrivateRepoAnalysis: true,
    allowSharedTokenFallback: false,
  },
  enterprise: {
    plan: "enterprise",
    label: "Enterprise",
    maxReposInWorkspace: 50,
    maxReposPerRequest: 40,
    maxOpenPRsPerRepo: 30,
    maxFilesPerDeepScan: 35,
    maxPackagesPerSecurityScan: 1200,
    aiAgentDepth: 3,
    aiRequestsPerHour: 1000,
    allowsPrivateRepoAnalysis: true,
    allowSharedTokenFallback: true,
  },
};

const PLAN_ORDER: AiPlan[] = ["free", "professional", "team", "enterprise"];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePlan(value: string): AiPlan | null {
  const normalized = normalize(value);
  if (normalized === "pro" || normalized === "premium") return "professional";
  if (normalized === "ent") return "enterprise";
  if (PLAN_ORDER.includes(normalized as AiPlan)) return normalized as AiPlan;
  return null;
}

function planRank(plan: AiPlan): number {
  return PLAN_ORDER.indexOf(plan);
}

function maxPlan(a: AiPlan, b: AiPlan): AiPlan {
  return planRank(a) >= planRank(b) ? a : b;
}

function toPrismaTier(plan: AiPlan): PrismaAiTier {
  return plan as PrismaAiTier;
}

function fromPrismaTier(tier: PrismaAiTier): AiPlan {
  return tier as AiPlan;
}

function parseOverrideMap(raw?: string): Map<string, AiPlan> {
  const map = new Map<string, AiPlan>();
  if (!raw) return map;

  for (const part of raw.split(",")) {
    const [keyRaw, planRaw] = part.split(":");
    if (!keyRaw || !planRaw) continue;
    const key = normalize(keyRaw);
    const plan = normalizePlan(planRaw);
    if (plan) {
      map.set(key, plan);
    }
  }
  return map;
}

function parseCsv(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => normalize(v))
    .filter(Boolean);
}

const planOverrides = parseOverrideMap(process.env.AI_TIER_OVERRIDES);
const teamDomains = parseCsv(process.env.AI_TEAM_DOMAINS);
const enterpriseDomains = parseCsv(process.env.AI_ENTERPRISE_DOMAINS);

export function getCapabilitiesForPlan(plan: AiPlan): AiCapabilities {
  return AI_CAPABILITIES[plan];
}

function matchesDomain(email: string, domains: string[]): boolean {
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0) return false;
  const domain = email.slice(atIndex + 1).toLowerCase();
  return domains.includes(domain);
}

function inferAiPlanFromSession(session: Session | null): AiPlan {
  if (!session?.user) return "free";

  const email = normalize(session.user.email ?? "");
  if (email) {
    const explicit = planOverrides.get(email);
    if (explicit) return explicit;
    if (matchesDomain(email, enterpriseDomains)) return "enterprise";
    if (matchesDomain(email, teamDomains)) return "team";
  }

  const provider = session.provider ?? (session.accessToken ? "github" : undefined);
  if (provider === "github") return "professional";
  return "free";
}

export function resolveAiPlanFromSession(session: Session | null): AiPlan {
  return inferAiPlanFromSession(session);
}

export async function resolveAiPlanFromSessionDb(session: Session | null): Promise<AiPlan> {
  const inferred = inferAiPlanFromSession(session);
  const userId = session?.user?.id;
  if (!userId) return inferred;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { aiTier: true },
    });
    if (!user?.aiTier) return inferred;

    const stored = fromPrismaTier(user.aiTier);
    const resolved = maxPlan(stored, inferred);

    if (resolved !== stored) {
      await prisma.user
        .update({
          where: { id: userId },
          data: {
            aiTier: toPrismaTier(resolved),
            aiTierUpdatedAt: new Date(),
          },
        })
        .catch(() => {});
    }

    return resolved;
  } catch {
    return inferred;
  }
}

export async function updateUserAiPlan(userId: string, plan: AiPlan) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      aiTier: toPrismaTier(plan),
      aiTierUpdatedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      aiTier: true,
      aiTierUpdatedAt: true,
    },
  });
}

export async function getUserAiPlan(userId: string): Promise<AiPlan> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiTier: true },
  });
  if (!user?.aiTier) return "free";
  return fromPrismaTier(user.aiTier);
}

export async function resolveAiPlanForRequest(): Promise<AiPlan> {
  const session = await getServerSession(authOptions);
  return resolveAiPlanFromSessionDb(session);
}
