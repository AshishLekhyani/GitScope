export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/orgs/[id] — org detail + members + pending invites
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, email: true, image: true } },
      members: {
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
        orderBy: { joinedAt: "asc" },
      },
      invites: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!org) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });

  const isMember = org.members.some((m) => m.userId === session.user.id);
  if (!isMember) return NextResponse.json({ error: "Access denied." }, { status: 403 });

  return NextResponse.json({ org });
}

// PATCH /api/orgs/[id] — rename or update SSO domain (owner/admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const member = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: id, userId: session.user.id } } });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.json({ error: "Only admins can update this workspace." }, { status: 403 });
  }

  const body = await req.json() as { name?: string; allowedDomain?: string | null };
  const name = (body.name ?? "").trim();
  if (!name || name.length < 2 || name.length > 64) {
    return NextResponse.json({ error: "Name must be 2–64 characters." }, { status: 400 });
  }

  let allowedDomain: string | null | undefined = undefined;
  if ("allowedDomain" in body) {
    const d = (body.allowedDomain ?? "").trim().toLowerCase().replace(/^@/, "");
    allowedDomain = d.length > 0 && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
  }

  const org = await prisma.organization.update({
    where: { id },
    data: { name, ...(allowedDomain !== undefined ? { allowedDomain } : {}) },
  });
  return NextResponse.json({ org });
}

// DELETE /api/orgs/[id] — delete workspace (owner only)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const org = await prisma.organization.findUnique({ where: { id }, select: { ownerId: true } });
  if (!org) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (org.ownerId !== session.user.id) return NextResponse.json({ error: "Only the owner can delete a workspace." }, { status: 403 });

  await prisma.organization.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
