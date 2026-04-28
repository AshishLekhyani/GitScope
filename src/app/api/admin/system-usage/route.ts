export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function isAdmin(email?: string | null) {
  if (!email) return false;
  const admins = new Set(
    (process.env.AI_TIER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
  return admins.has(email.toLowerCase());
}

// GET /api/admin/system-usage?window=24h|7d|30d
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const window = searchParams.get("window") ?? "24h";
  const windowMs = window === "30d" ? 30 * 86400000 : window === "7d" ? 7 * 86400000 : 86400000;
  const since = new Date(Date.now() - windowMs);

  const [byFeature, byPlan, topUsers, totalEvents] = await Promise.all([
    prisma.aiUsageEvent.groupBy({
      by: ["feature"],
      where: { createdAt: { gte: since } },
      _sum: { units: true },
      _count: { id: true },
      orderBy: { _sum: { units: "desc" } },
    }),
    prisma.aiUsageEvent.groupBy({
      by: ["plan"],
      where: { createdAt: { gte: since } },
      _sum: { units: true },
      _count: { id: true },
    }),
    prisma.aiUsageEvent.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: since } },
      _sum: { units: true },
      orderBy: { _sum: { units: "desc" } },
      take: 10,
    }),
    prisma.aiUsageEvent.count({ where: { createdAt: { gte: since } } }),
  ]);

  // Resolve user emails for top users
  const userIds = topUsers.map((u) => u.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, name: true, aiTier: true },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return NextResponse.json({
    window,
    since: since.toISOString(),
    totalEvents,
    byFeature: byFeature.map((f) => ({ feature: f.feature, units: f._sum.units ?? 0, calls: f._count.id })),
    byPlan: byPlan.map((p) => ({ plan: p.plan, units: p._sum.units ?? 0, calls: p._count.id })),
    topUsers: topUsers.map((u) => ({
      userId: u.userId,
      email: userMap[u.userId]?.email ?? "unknown",
      name: userMap[u.userId]?.name,
      tier: userMap[u.userId]?.aiTier,
      units: u._sum.units ?? 0,
    })),
  });
}
