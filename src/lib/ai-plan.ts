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
}

const AI_CAPABILITIES: Record<AiPlan, AiCapabilities> = {
  free: {
    plan: "free",
    label: "Explorer",
    maxReposInWorkspace: 5,            // bumped from 3 → more generous free tier
    maxReposPerRequest: 5,
    maxOpenPRsPerRepo: 5,
    maxFilesPerDeepScan: 4,
    maxPackagesPerSecurityScan: 100,   // CVE scan available free — bumped from 80
    aiAgentDepth: 1,
    aiRequestsPerHour: 20,
    allowsPrivateRepoAnalysis: false,
    allowSharedTokenFallback: false,
    deepScanAllowed: false,
    fixDiffsAllowed: false,
    scanHistoryDays: 0,
    scheduledScansAllowed: false,
    maxScheduledScans: 0,
    customRulesAllowed: false,
    maxCustomRules: 0,
    dailyScanLimit: 5,                 // bumped from 3
    generateReadmeAllowed: false,
    generateChangelogAllowed: false,
    dailyGenerateLimit: 0,
    slackNotificationsAllowed: false,
    githubAppPrReviewsAllowed: true,   // 5 free PR reviews/month via GitHub App
    weeklyDigestAllowed: false,
    benchmarkComparisonAllowed: false,
    monthlyPrReviewLimit: 5,
  },
  professional: {
    plan: "professional",
    label: "Professional",
    maxReposInWorkspace: 15,           // bumped from 10
    maxReposPerRequest: 15,
    maxOpenPRsPerRepo: 10,
    maxFilesPerDeepScan: 12,
    maxPackagesPerSecurityScan: 300,   // bumped from 220
    aiAgentDepth: 2,
    aiRequestsPerHour: 100,
    allowsPrivateRepoAnalysis: true,
    allowSharedTokenFallback: false,
    deepScanAllowed: true,
    fixDiffsAllowed: true,
    scanHistoryDays: 30,
    scheduledScansAllowed: true,
    maxScheduledScans: 5,              // bumped from 3
    customRulesAllowed: false,
    maxCustomRules: 0,
    dailyScanLimit: 25,
    generateReadmeAllowed: true,
    generateChangelogAllowed: true,
    dailyGenerateLimit: 10,
    slackNotificationsAllowed: true,
    githubAppPrReviewsAllowed: true,
    weeklyDigestAllowed: true,
    benchmarkComparisonAllowed: true,
    monthlyPrReviewLimit: 50,
  },
  team: {
    plan: "team",
    label: "Team",
    maxReposInWorkspace: 30,           // bumped from 20
    maxReposPerRequest: 25,
    maxOpenPRsPerRepo: 20,
    maxFilesPerDeepScan: 25,
    maxPackagesPerSecurityScan: 600,   // bumped from 500
    aiAgentDepth: 3,
    aiRequestsPerHour: 300,
    allowsPrivateRepoAnalysis: true,
    allowSharedTokenFallback: false,
    deepScanAllowed: true,
    fixDiffsAllowed: true,
    scanHistoryDays: 90,
    scheduledScansAllowed: true,
    maxScheduledScans: 30,             // bumped from 20
    customRulesAllowed: true,
    maxCustomRules: 30,                // bumped from 25
    dailyScanLimit: 80,
    generateReadmeAllowed: true,
    generateChangelogAllowed: true,
    dailyGenerateLimit: 40,
    slackNotificationsAllowed: true,
    githubAppPrReviewsAllowed: true,
    weeklyDigestAllowed: true,
    benchmarkComparisonAllowed: true,
    monthlyPrReviewLimit: 200,
  },
  enterprise: {
    plan: "enterprise",
    label: "Enterprise",
    maxReposInWorkspace: 100,          // bumped from 50
    maxReposPerRequest: 50,
    maxOpenPRsPerRepo: 40,
    maxFilesPerDeepScan: 50,
    maxPackagesPerSecurityScan: 2000,  // bumped from 1200
    aiAgentDepth: 3,
    aiRequestsPerHour: 2000,
    allowsPrivateRepoAnalysis: true,
    allowSharedTokenFallback: true,
    deepScanAllowed: true,
    fixDiffsAllowed: true,
    scanHistoryDays: 365,
    scheduledScansAllowed: true,
    maxScheduledScans: 200,            // bumped from 100
    customRulesAllowed: true,
    maxCustomRules: 150,               // bumped from 100
    dailyScanLimit: 500,
    generateReadmeAllowed: true,
    generateChangelogAllowed: true,
    dailyGenerateLimit: 200,
    slackNotificationsAllowed: true,
    githubAppPrReviewsAllowed: true,
    weeklyDigestAllowed: true,
    benchmarkComparisonAllowed: true,
    monthlyPrReviewLimit: 10000,       // effectively unlimited
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

// function planRank(plan: AiPlan): number {
//   return PLAN_ORDER.indexOf(plan);
// }

// function maxPlan(a: AiPlan, b: AiPlan): AiPlan {
//   return planRank(a) >= planRank(b) ? a : b;
// }

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

  // const provider = session.provider ?? (session.accessToken ? "github" : undefined);
  // New users should default to free tier regardless of auth provider
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
