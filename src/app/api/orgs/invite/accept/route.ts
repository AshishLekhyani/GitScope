export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/orgs/invite/accept — accept an invite by token
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to accept this invite." }, { status: 401 });

  const body = await req.json() as { token?: string };
  const token = (body.token ?? "").trim();
  if (!token) return NextResponse.json({ error: "Invalid invite token." }, { status: 400 });

  const invite = await prisma.orgInvite.findUnique({
    where: { token },
    include: { org: { select: { id: true, name: true, maxSeats: true, _count: { select: { members: true } } } } },
  });

  if (!invite) return NextResponse.json({ error: "Invite not found or already used." }, { status: 404 });
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: "This invite has expired." }, { status: 410 });

  const userEmail = session.user.email ?? "";
  if (invite.email !== userEmail.toLowerCase()) {
    return NextResponse.json({ error: `This invite was sent to ${invite.email}. Sign in with that account to accept it.` }, { status: 403 });
  }

  if (invite.org._count.members >= invite.org.maxSeats) {
    return NextResponse.json({ error: "This workspace is at its seat limit." }, { status: 403 });
  }

  // Idempotent — upsert so re-clicking the link is harmless
  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: invite.orgId, userId: session.user.id } },
    create: { orgId: invite.orgId, userId: session.user.id, role: invite.role },
    update: {},
  });

  await prisma.orgInvite.delete({ where: { id: invite.id } });

  return NextResponse.json({ ok: true, orgId: invite.orgId, orgName: invite.org.name });
}
