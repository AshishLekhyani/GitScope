import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import type { AiTier as PrismaAiTier } from "@prisma/client";

/**
 * Two-tier model: "free" (generous limits) | "developer" (all features, BYOK, PPP pricing $10-20).
 * All legacy plan values (professional/team/enterprise) are normalized to "developer" at runtime.
 */
export type AiPlan = "free" | "developer";

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
  // Scan-specific gates
  deepScanAllowed: boolean;
  fixDiffsAllowed: boolean;
  scanHistoryDays: number;       // 0 = no history stored
  scheduledScansAllowed: boolean;
  maxScheduledScans: number;
  customRulesAllowed: boolean;
  maxCustomRules: number;
  dailyScanLimit: number;
  generateReadmeAllowed: boolean;
  generateChangelogAllowed: boolean;
  dailyGenerateLimit: number;
  // Integration gates
  slackNotificationsAllowed: boolean;
  githubAppPrReviewsAllowed: boolean;
  weeklyDigestAllowed: boolean;
  benchmarkComparisonAllowed: boolean;
  // Free monthly PR review allowance (GitHub App)
  monthlyPrReviewLimit: number;
  // Maximum LLM-powered scans per day (internal AI is free and unlimited).
  // Caps real API cost — free plan gets 0 (internal AI only).
  dailyLlmScanLimit: number;
}

// ── Two-tier capability matrix ────────────────────────────────────────────────
// Free: generous — BYOK works for ALL providers, most features unlocked.
// Developer ($10-20/mo PPP-priced): EVERYTHING, unlimited scans via BYOK, all enterprise features.
const AI_CAPABILITIES: Record<AiPlan, AiCapabilities> = {
  free: {
    plan: "free",
    label: "Free",
    maxReposInWorkspace: 10,
    maxReposPerRequest: 10,
    maxOpenPRsPerRepo: 10,
    maxFilesPerDeepScan: 8,
    maxPackagesPerSecurityScan: 200,
    aiAgentDepth: 1,
    aiRequestsPerHour: 30,
    allowsPrivateRepoAnalysis: true,   // BYOK unlocks private repos for free users too
    allowSharedTokenFallback: true,
    deepScanAllowed: false,            // thorough/maximum effort locked to Developer
    fixDiffsAllowed: false,
    scanHistoryDays: 7,                // 7-day history on free (was 0)
    scheduledScansAllowed: false,
    maxScheduledScans: 0,
    customRulesAllowed: false,
    maxCustomRules: 0,
    dailyScanLimit: 10,
    generateReadmeAllowed: true,       // README gen available on free
    generateChangelogAllowed: false,
    dailyGenerateLimit: 3,
    slackNotificationsAllowed: false,
    githubAppPrReviewsAllowed: true,
    weeklyDigestAllowed: false,
    benchmarkComparisonAllowed: true,
    monthlyPrReviewLimit: 10,
    dailyLlmScanLimit: 5,              // 5 server-key scans/day; BYOK is unlimited
  },
  developer: {
    plan: "developer",
    label: "Developer",
    maxReposInWorkspace: 9999,
    maxReposPerRequest: 100,
    maxOpenPRsPerRepo: 100,
    maxFilesPerDeepScan: 500,
    maxPackagesPerSecurityScan: 9999,
    aiAgentDepth: 3,
    aiRequestsPerHour: 9999,
    allowsPrivateRepoAnalysis: true,
    allowSharedTokenFallback: true,
    deepScanAllowed: true,
    fixDiffsAllowed: true,
    scanHistoryDays: 365,
    scheduledScansAllowed: true,
    maxScheduledScans: 200,
    customRulesAllowed: true,
    maxCustomRules: 200,
    dailyScanLimit: 9999,              // unlimited via BYOK
    generateReadmeAllowed: true,
    generateChangelogAllowed: true,
    dailyGenerateLimit: 9999,
    slackNotificationsAllowed: true,
    githubAppPrReviewsAllowed: true,
    weeklyDigestAllowed: true,
    benchmarkComparisonAllowed: true,
    monthlyPrReviewLimit: 999999,
    dailyLlmScanLimit: 20,             // 20 server-key scans/day; BYOK is unlimited
  },
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePlan(value: string): AiPlan | null {
  const normalized = normalize(value);
  // Legacy plan names all map to "developer"
  if (["professional", "pro", "premium", "team", "enterprise", "ent", "developer"].includes(normalized)) return "developer";
  if (normalized === "free") return "free";
  return null;
}


function toPrismaTier(plan: AiPlan): PrismaAiTier {
  return plan as PrismaAiTier;
}

export function fromPrismaTier(tier: PrismaAiTier): AiPlan {
  // Normalize legacy tier values to the two-tier model
  if (tier === "free") return "free";
  return "developer"; // professional / team / enterprise / developer all → developer
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
const developerDomains = parseCsv(process.env.AI_DEVELOPER_DOMAINS);

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
    if (matchesDomain(email, developerDomains)) return "developer";
  }

  return "free";
}

export function resolveAiPlanFromSession(session: Session | null): AiPlan {
  return inferAiPlanFromSession(session);
}

export async function resolveAiPlanFromSessionDb(session: Session | null): Promise<AiPlan> {
  const userId = session?.user?.id;
  if (!userId) return inferAiPlanFromSession(session);

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { aiTier: true },
    });
    // Database is the source of truth - use stored tier if it exists
    if (user?.aiTier) {
      return fromPrismaTier(user.aiTier);
    }
    // Fall back to inference only if no tier is set in DB
    return inferAiPlanFromSession(session);
  } catch {
    return inferAiPlanFromSession(session);
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
