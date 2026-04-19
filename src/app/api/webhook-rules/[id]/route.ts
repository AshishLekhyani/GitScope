export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// PATCH /api/webhook-rules/[id] — update rule (name, enabled, threshold, actionUrl, repoFilter)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const rule = await prisma.webhookRule.findUnique({ where: { id } });
  if (!rule || rule.userId !== session.user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await req.json() as {
    name?: string;
    enabled?: boolean;
    triggerThreshold?: number;
    actionUrl?: string;
    repoFilter?: string;
  };

  const updated = await prisma.webhookRule.update({
    where: { id },
    data: {
      ...(body.name             !== undefined && { name: (body.name ?? "").trim() }),
      ...(body.enabled          !== undefined && { enabled: Boolean(body.enabled) }),
      ...(body.triggerThreshold !== undefined && { triggerThreshold: Number(body.triggerThreshold) }),
      ...(body.actionUrl        !== undefined && { actionUrl: (body.actionUrl ?? "").trim() || null }),
      ...(body.repoFilter       !== undefined && { repoFilter: (body.repoFilter ?? "").trim() || null }),
    },
  });
  return NextResponse.json({ rule: updated });
}

// DELETE /api/webhook-rules/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const rule = await prisma.webhookRule.findUnique({ where: { id } });
  if (!rule || rule.userId !== session.user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.webhookRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
