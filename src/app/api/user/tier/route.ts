import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  resolveAiPlanFromSessionDb,
  type AiPlan,
  updateUserAiPlan,
} from "@/lib/ai-plan";

const VALID_PLANS: AiPlan[] = ["free", "professional", "developer", "team", "enterprise"];

function parseAdminEmails() {
  return new Set(
    (process.env.AI_TIER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  );
}

function canManageTiers(email?: string | null) {
  if (process.env.NODE_ENV !== "production") return true;
  if (!email) return false;
  const admins = parseAdminEmails();
  return admins.has(email.toLowerCase());
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const canManage = canManageTiers(session.user.email);

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

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTiers(session.user.email)) {
    return NextResponse.json(
      { error: "Tier updates are restricted in production." },
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
      { error: "Invalid plan. Use free, professional, team, or enterprise." },
      { status: 400 }
    );
  }

  const targetUserId = (body.userId ?? session.user.id).trim();
  if (!targetUserId) {
    return NextResponse.json({ error: "Missing target user id." }, { status: 400 });
  }

  const updated = await updateUserAiPlan(targetUserId, plan);
  return NextResponse.json({
    user: updated,
    message: "AI tier updated.",
  });
}
