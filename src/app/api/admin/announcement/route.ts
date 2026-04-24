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

// GET /api/admin/announcement — active announcement (public, used by app shell)
export async function GET() {
  const ann = await prisma.announcement.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ announcement: ann ?? null });
}

// POST /api/admin/announcement — create/replace active announcement
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { message?: string; type?: string };
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "message required." }, { status: 400 });
  const type = ["info", "warning", "error", "success"].includes(body.type ?? "") ? body.type! : "info";

  // deactivate all existing, then create new
  await prisma.announcement.updateMany({ where: { active: true }, data: { active: false } });
  const ann = await prisma.announcement.create({ data: { message, type, active: true } });
  return NextResponse.json({ announcement: ann }, { status: 201 });
}

// DELETE /api/admin/announcement — clear active announcement
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.announcement.updateMany({ where: { active: true }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
