export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
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

// GET /api/admin/audit-log?page=1&limit=50&severity=critical&q=email
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const severity = searchParams.get("severity") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const skip = (page - 1) * limit;

  const VALID_SEVERITIES = ["info", "warning", "error", "critical"] as const;
  type Sev = (typeof VALID_SEVERITIES)[number];

  const where: Record<string, unknown> = {};
  if (severity && VALID_SEVERITIES.includes(severity as Sev)) where.severity = severity;
  if (q) where.OR = [{ email: { contains: q, mode: "insensitive" } }, { eventType: { contains: q, mode: "insensitive" } }, { ip: { contains: q } }];

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { timestamp: "desc" }, skip, take: limit }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, page, limit });
}
