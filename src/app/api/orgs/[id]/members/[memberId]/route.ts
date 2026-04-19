export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { OrgRole } from "@prisma/client";

const VALID_ROLES: OrgRole[] = ["admin", "member", "viewer"];

// PATCH /api/orgs/[id]/members/[memberId] — change role
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, memberId } = await params;

  const actor = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: id, userId: session.user.id } } });
  if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
    return NextResponse.json({ error: "Only admins can change roles." }, { status: 403 });
  }

  const target = await prisma.orgMember.findUnique({ where: { id: memberId } });
  if (!target || target.orgId !== id) return NextResponse.json({ error: "Member not found." }, { status: 404 });
  if (target.role === "owner") return NextResponse.json({ error: "Cannot change the owner's role." }, { status: 403 });

  const body = await req.json() as { role?: OrgRole };
  const role: OrgRole = VALID_ROLES.includes(body.role as OrgRole) ? (body.role as OrgRole) : "member";

  const updated = await prisma.orgMember.update({ where: { id: memberId }, data: { role } });
  return NextResponse.json({ member: updated });
}

// DELETE /api/orgs/[id]/members/[memberId] — remove member or leave
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, memberId } = await params;

  const target = await prisma.orgMember.findUnique({ where: { id: memberId } });
  if (!target || target.orgId !== id) return NextResponse.json({ error: "Member not found." }, { status: 404 });
  if (target.role === "owner") return NextResponse.json({ error: "Cannot remove the workspace owner." }, { status: 403 });

  const isSelf = target.userId === session.user.id;
  if (!isSelf) {
    const actor = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: id, userId: session.user.id } } });
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
      return NextResponse.json({ error: "Only admins can remove members." }, { status: 403 });
    }
  }

  await prisma.orgMember.delete({ where: { id: memberId } });
  return NextResponse.json({ ok: true });
}
