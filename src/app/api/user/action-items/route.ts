export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_STATUSES = ["open", "in_progress", "done", "dismissed"] as const;
type ItemStatus = typeof VALID_STATUSES[number];

// ── GET — list action items ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const repo   = searchParams.get("repo")   ?? undefined;

  const items = await prisma.actionItem.findMany({
    where: {
      userId: session.user.id,
      ...(status ? { status } : {}),
      ...(repo   ? { repo }   : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ items });
}

// ── POST — save a new action item ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { repo, title, description, suggestion, severity = "medium", category = "quality", file } = body;
  if (!repo || !title || !description || !suggestion) {
    return NextResponse.json({ error: "repo, title, description, and suggestion are required" }, { status: 400 });
  }

  // Cap at 200 action items per user to prevent abuse
  const count = await prisma.actionItem.count({ where: { userId: session.user.id } });
  if (count >= 200) {
    return NextResponse.json({ error: "Action item limit reached (200). Resolve or dismiss existing items first." }, { status: 429 });
  }

  const item = await prisma.actionItem.create({
    data: {
      userId:      session.user.id,
      repo:        String(repo),
      title:       String(title).slice(0, 200),
      description: String(description).slice(0, 2000),
      suggestion:  String(suggestion).slice(0, 2000),
      severity:    String(severity),
      category:    String(category),
      file:        file ? String(file).slice(0, 500) : null,
    },
  });

  return NextResponse.json({ item }, { status: 201 });
}

// ── PATCH — update status ──────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { id, status } = body;
  if (!id || !status || !VALID_STATUSES.includes(status as ItemStatus)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }

  const item = await prisma.actionItem.updateMany({
    where: { id: String(id), userId: session.user.id },
    data:  { status: status as string },
  });

  if (item.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// ── DELETE — remove an action item ────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await prisma.actionItem.deleteMany({ where: { id, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
