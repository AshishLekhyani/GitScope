export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateUserAiPlan, type AiPlan } from "@/lib/ai-plan";

function isAdmin(email?: string | null) {
  if (!email) return false;
  const admins = new Set(
    (process.env.AI_TIER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
  return admins.has(email.toLowerCase());
}

const VALID_PLANS: AiPlan[] = ["free", "professional", "developer", "team", "enterprise"];

// GET /api/admin/users?q=email&page=1&limit=20
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip = (page - 1) * limit;

  const where = q
    ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        aiTier: true,
        aiTierUpdatedAt: true,
        createdAt: true,
        _count: { select: { repoScanHistory: true, apiKeys: true, orgMemberships: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({ users, total, page, limit });
}

// PATCH /api/admin/users — change any user's tier
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { userId?: string; plan?: string };
  const plan = (body.plan ?? "").trim().toLowerCase() as AiPlan;
  if (!VALID_PLANS.includes(plan))
    return NextResponse.json({ error: "Invalid plan." }, { status: 400 });

  const targetId = (body.userId ?? "").trim();
  if (!targetId) return NextResponse.json({ error: "userId required." }, { status: 400 });

  const updated = await updateUserAiPlan(targetId, plan);
  return NextResponse.json({ user: updated });
}

// DELETE /api/admin/users?userId=xxx&keyId=yyy — revoke any user's API key
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const keyId = searchParams.get("keyId") ?? "";
  if (!keyId) return NextResponse.json({ error: "keyId required." }, { status: 400 });

  await prisma.apiKey.delete({ where: { id: keyId } });
  return NextResponse.json({ ok: true });
}
