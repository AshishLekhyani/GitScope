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

// GET /api/admin/orgs?q=name&page=1&limit=20
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip = (page - 1) * limit;

  const where = q ? { name: { contains: q, mode: "insensitive" as const } } : {};

  const [orgs, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.organization.count({ where }),
  ]);

  return NextResponse.json({ orgs, total, page, limit });
}

// PATCH /api/admin/orgs — update org maxSeats or plan
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { orgId?: string; maxSeats?: number };
  const orgId = (body.orgId ?? "").trim();
  if (!orgId) return NextResponse.json({ error: "orgId required." }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (body.maxSeats !== undefined) data.maxSeats = Math.max(1, Number(body.maxSeats));

  const org = await prisma.organization.update({ where: { id: orgId }, data });
  return NextResponse.json({ org });
}
