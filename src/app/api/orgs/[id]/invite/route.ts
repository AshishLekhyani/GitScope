export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { OrgRole } from "@prisma/client";

const VALID_ROLES: OrgRole[] = ["admin", "member", "viewer"];

// POST /api/orgs/[id]/invite — invite a user by email
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const member = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: id, userId: session.user.id } } });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.json({ error: "Only admins can invite members." }, { status: 403 });
  }

  const body = await req.json() as { email?: string; role?: OrgRole };
  const email = (body.email ?? "").trim().toLowerCase();
  const role: OrgRole = VALID_ROLES.includes(body.role as OrgRole) ? (body.role as OrgRole) : "member";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, maxSeats: true, _count: { select: { members: true } } } });
  if (!org) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });

  if (org._count.members >= org.maxSeats) {
    return NextResponse.json({ error: `Seat limit reached (${org.maxSeats}). Upgrade your plan to add more members.` }, { status: 403 });
  }

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    const alreadyMember = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: id, userId: existingUser.id } } });
    if (alreadyMember) return NextResponse.json({ error: "This user is already a member." }, { status: 409 });
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invite = await prisma.orgInvite.upsert({
    where: { orgId_email: { orgId: id, email } },
    create: { orgId: id, email, role, expiresAt },
    update: { role, expiresAt, token: undefined },
  });

  return NextResponse.json({ invite }, { status: 201 });
}

// DELETE /api/orgs/[id]/invite?inviteId=xxx — cancel an invite
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const member = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: id, userId: session.user.id } } });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.json({ error: "Only admins can cancel invites." }, { status: 403 });
  }

  const inviteId = new URL(req.url).searchParams.get("inviteId") ?? "";
  if (!inviteId) return NextResponse.json({ error: "inviteId required." }, { status: 400 });

  const deleted = await prisma.orgInvite.deleteMany({ where: { id: inviteId, orgId: id } });
  if (deleted.count === 0) return NextResponse.json({ error: "Invite not found." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
