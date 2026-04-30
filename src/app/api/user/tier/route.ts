import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  resolveAiPlanFromSessionDb,
  type AiPlan,
  updateUserAiPlan,
} from "@/lib/ai-plan";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

const VALID_PLANS: AiPlan[] = ["free", "developer"];

function parseAdminEmails() {
  return new Set(
    (process.env.AI_TIER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isAdmin(email?: string | null): boolean {
  if (!email) return false;
  const adminEnv = (process.env.AI_TIER_ADMIN_EMAILS ?? "").trim();
  // Dev-only bypass: only when NODE_ENV is strictly "development" AND no admin
  // list is configured. This prevents staging/preview envs from being open.
  if (!adminEnv && process.env.NODE_ENV === "development") return true;
  if (!adminEnv) return false;
  return parseAdminEmails().has(email.toLowerCase());
}

async function getHandler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const canManage = isAdmin(session.user.email);

  const [resolvedPlan, user] = await Promise.all([
    resolveAiPlanFromSessionDb(session),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { aiTier: true, aiTierUpdatedAt: true },
    }),
  ]);

  return NextResponse.json({
    resolvedPlan,
    storedPlan: user?.aiTier ?? "free",
    aiTierUpdatedAt: user?.aiTierUpdatedAt ?? null,
    canManage,
  });
}

async function patchHandler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.email)) {
    return NextResponse.json(
      { error: "Tier updates require admin privileges." },
      { status: 403 }
    );
  }

  let body: { plan?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const plan = (body.plan ?? "").trim().toLowerCase() as AiPlan;
  if (!VALID_PLANS.includes(plan)) {
    return NextResponse.json(
      { error: "Invalid plan. Use free or developer." },
      { status: 400 }
    );
  }

  // Only allow targeting another user if the requester is a configured admin
  // (not just the dev-mode bypass). Self-update is always allowed.
  const requestedUserId = (body.userId ?? "").trim();
  const targetUserId = requestedUserId && requestedUserId !== session.user.id
    ? requestedUserId
    : session.user.id;

  const hasConfiguredAdmin = (process.env.AI_TIER_ADMIN_EMAILS ?? "").trim().length > 0;
  if (targetUserId !== session.user.id && !hasConfiguredAdmin) {
    return NextResponse.json(
      { error: "Cross-user tier updates require AI_TIER_ADMIN_EMAILS to be configured." },
      { status: 403 }
    );
  }

  const updated = await updateUserAiPlan(targetUserId, plan);
  return NextResponse.json({
    user: updated,
    message: "AI tier updated.",
  });
}

export const GET  = withRouteSecurity(getHandler,  { ...SecurityPresets.authenticated, csrf: false });
export const PATCH = withRouteSecurity(patchHandler, SecurityPresets.authenticated);
