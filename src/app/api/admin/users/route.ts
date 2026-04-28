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

const VALID_PLANS: AiPlan[] = ["free", "developer"];

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

// DELETE /api/admin/users?userId=xxx — delete user account
// DELETE /api/admin/users?userId=xxx&keyId=yyy — revoke specific API key only
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? "";
  const keyId = searchParams.get("keyId") ?? "";

  if (keyId) {
    await prisma.apiKey.delete({ where: { id: keyId } });
    return NextResponse.json({ ok: true });
  }

  if (!userId) return NextResponse.json({ error: "userId required." }, { status: 400 });
  if (userId === session.user.id) return NextResponse.json({ error: "Cannot delete your own account." }, { status: 400 });

  await prisma.user.delete({ where: { id: userId } });
  return NextResponse.json({ ok: true, deleted: userId });
}

// POST /api/admin/users — send password reset email to any user
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { userId?: string };
  const targetId = (body.userId ?? "").trim();
  if (!targetId) return NextResponse.json({ error: "userId required." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: targetId }, select: { email: true, name: true } });
  if (!user?.email) return NextResponse.json({ error: "User not found or has no email." }, { status: 404 });

  // Dynamic import to avoid circular deps at module level
  const { sendEmail } = await import("@/lib/email");
  const crypto = await import("crypto");

  await prisma.verificationToken.deleteMany({ where: { identifier: `reset:${user.email}` } });
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await prisma.verificationToken.create({ data: { identifier: `reset:${user.email}`, token, expires } });

  const resetUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Password Reset — GitScope",
    html: `<p>Hi ${user.name ?? "there"},</p><p>An admin has sent you a password reset link. Click below to reset your password (expires in 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  });

  return NextResponse.json({ ok: true, email: user.email });
}
