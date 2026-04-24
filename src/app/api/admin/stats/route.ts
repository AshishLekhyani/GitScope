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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    newUsersToday,
    newUsersThisWeek,
    totalScans,
    scansToday,
    totalOrgs,
    totalApiKeys,
    totalAuditEvents,
    auditEventsToday,
    tierCounts,
    activeAnnouncement,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.user.count({ where: { createdAt: { gte: weekStart } } }),
    prisma.repoScanHistory.count(),
    prisma.repoScanHistory.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.organization.count(),
    prisma.apiKey.count(),
    prisma.auditLog.count(),
    prisma.auditLog.count({ where: { timestamp: { gte: todayStart } } }),
    prisma.user.groupBy({ by: ["aiTier"], _count: { id: true } }),
    prisma.announcement.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } }),
  ]);

  return NextResponse.json({
    totalUsers,
    newUsersToday,
    newUsersThisWeek,
    totalScans,
    scansToday,
    totalOrgs,
    totalApiKeys,
    totalAuditEvents,
    auditEventsToday,
    tierCounts: Object.fromEntries(tierCounts.map((t) => [t.aiTier, t._count.id])),
    activeAnnouncement,
  });
}
