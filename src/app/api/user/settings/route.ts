import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";
import {
  resolveAiPlanFromSessionDb,
  getCapabilitiesForPlan,
  type AiPlan,
} from "@/lib/ai-plan";

// Consolidated settings response type
interface SettingsResponse {
  // User profile
  profile: {
    name: string | null;
    bio: string | null;
    githubHandle: string | null;
    image: string | null;
    email: string | null;
    hasPassword: boolean;
    hasGithubApiKey: boolean;
  };
  // BYOK key presence (never return actual keys)
  byok: Record<string, boolean | undefined>;
  profileMeta: Record<string, string>;
  // Connected OAuth providers
  connectedProviders: string[];
  // AI tier info
  aiTier: {
    resolvedPlan: AiPlan;
    storedPlan: AiPlan;
    aiTierUpdatedAt: Date | null;
    canManage: boolean;
    capabilities: ReturnType<typeof getCapabilitiesForPlan>;
  };
  // GitHub API rate limit - placeholder for now
  githubRateLimit: {
    remaining: number;
    limit: number;
    resetAt: number;
  } | null;
  // Recent AI jobs
  recentJobs: {
    id: string;
    type: string;
    status: string;
    plan: string;
    attempts: number;
    error: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }[];
  // AI usage stats
  aiUsage: {
    totalEvents: number;
    todayEvents: number;
  };
}

async function getHandler() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Fetch all data in parallel
  const [
    user,
    accounts,
    resolvedPlan,
    recentJobs,
    aiUsageAgg,
  ] = await Promise.all([
    // User profile
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        bio: true,
        githubHandle: true,
        image: true,
        email: true,
        password: true,
        githubApiKey: true,
        aiTier: true,
        aiTierUpdatedAt: true,
        byokAnthropicKey: true,
        byokOpenAIKey: true,
        byokGeminiKey: true,
        byokExtendedKeys: true,
        byokPreferPlatform: true,
        profileMeta: true,
      },
    }),
    // Connected OAuth providers
    prisma.account.findMany({
      where: { userId },
      select: { provider: true },
    }),
    // Resolved AI plan
    resolveAiPlanFromSessionDb(session),
    // Recent AI jobs (last 10)
    prisma.aiAnalysisJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        status: true,
        plan: true,
        attempts: true,
        error: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    }),
    // AI usage stats
    prisma.aiUsageEvent.aggregate({
      where: { userId },
      _count: { id: true },
    }),
  ]);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Check if user can manage tiers (admin only in production)
  const canManage: boolean =
    process.env.NODE_ENV !== "production" ||
    !!(session.user.email &&
      (process.env.AI_TIER_ADMIN_EMAILS || "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .includes(session.user.email.toLowerCase()));

  // Parse extended BYOK keys presence (never return actual key values)
  let extByokPresence: Record<string, boolean> = {};
  if (user.byokExtendedKeys) {
    try {
      const { safeDecrypt } = await import("@/lib/encrypt");
      const decrypted = safeDecrypt(user.byokExtendedKeys);
      if (decrypted) {
        const parsed = JSON.parse(decrypted) as Record<string, string>;
        extByokPresence = Object.fromEntries(Object.keys(parsed).map((k) => [k, true]));
      }
    } catch { /* ignore */ }
  }

  // Parse profileMeta JSON
  let profileMeta: Record<string, string> = {};
  if (user.profileMeta) {
    try { profileMeta = JSON.parse(user.profileMeta) as Record<string, string>; } catch { /* ignore */ }
  }

  const response: SettingsResponse = {
    profile: {
      name: user.name,
      bio: user.bio,
      githubHandle: user.githubHandle,
      image: user.image,
      email: user.email,
      hasPassword: !!user.password,
      hasGithubApiKey: !!user.githubApiKey,
    },
    byok: {
      hasAnthropic: !!user.byokAnthropicKey,
      hasOpenAI:    !!user.byokOpenAIKey,
      hasGemini:    !!user.byokGeminiKey,
      anthropic: !!user.byokAnthropicKey,
      openai:    !!user.byokOpenAIKey,
      gemini:    !!user.byokGeminiKey,
      preferPlatform: user.byokPreferPlatform ?? false,
      ...extByokPresence,
    },
    profileMeta,
    connectedProviders: accounts.map((a: { provider: string }) => a.provider),
    aiTier: {
      resolvedPlan,
      storedPlan: user.aiTier as AiPlan,
      aiTierUpdatedAt: user.aiTierUpdatedAt,
      canManage,
      capabilities: getCapabilitiesForPlan(resolvedPlan),
    },
    githubRateLimit: null, // Can be fetched client-side if needed
    recentJobs,
    aiUsage: {
      totalEvents: aiUsageAgg._count.id,
      todayEvents: 0, // Can be added if needed
    },
  };

  return NextResponse.json(response);
}

// Apply security middleware - GET is read-only
export const GET = withRouteSecurity(getHandler, {
  ...SecurityPresets.public,
  csrf: false,
});
