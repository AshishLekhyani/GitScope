export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import crypto from "crypto";

function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateApiKey(): { raw: string; prefix: string } {
  const bytes = crypto.randomBytes(32).toString("hex");
  const raw = `sk_gs_${bytes}`;
  return { raw, prefix: raw.slice(0, 12) }; // "sk_gs_XXXXXX" prefix for display
}

const MAX_KEYS: Record<string, number> = {
  free: 0,
  developer: 10,
};

// GET /api/user/api-keys — list keys (prefix only, never hash)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const plan = await resolveAiPlanFromSessionDb(session);
  return NextResponse.json({ keys, maxKeys: MAX_KEYS[plan] ?? 0, plan });
}

// POST /api/user/api-keys — create a new key (returns raw key ONCE)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await resolveAiPlanFromSessionDb(session);
  const maxKeys = MAX_KEYS[plan] ?? 0;
  if (maxKeys === 0) {
    return NextResponse.json({ error: "API keys require Developer plan" }, { status: 403 });
  }

  const existing = await prisma.apiKey.count({ where: { userId: session.user.id } });
  if (existing >= maxKeys) {
    return NextResponse.json({ error: `Key limit reached (${maxKeys} max on ${plan} plan)` }, { status: 429 });
  }

  const body = await req.json() as { name?: string; scopes?: string[]; expiresInDays?: number };
  const name = (body.name ?? "API Key").slice(0, 64);

  const VALID_SCOPES = new Set(["repos:read", "scans:read", "scans:write", "coverage:read", "dora:read"]);
  const scopes = (body.scopes ?? ["repos:read", "scans:read"]).filter((s) => VALID_SCOPES.has(s));

  let expiresAt: Date | null = null;
  if (body.expiresInDays && body.expiresInDays > 0 && body.expiresInDays <= 365) {
    expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000);
  }

  const { raw, prefix } = generateApiKey();
  const keyHash = hashKey(raw);

  const key = await prisma.apiKey.create({
    data: {
      userId: session.user.id,
      name,
      keyHash,
      prefix,
      scopes,
      ...(expiresAt ? { expiresAt } : {}),
    },
    select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, createdAt: true },
  });

  // Return raw key exactly once — never stored, never recoverable
  return NextResponse.json({ ...key, rawKey: raw }, { status: 201 });
}

// DELETE /api/user/api-keys?id=xxx
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const key = await prisma.apiKey.findUnique({ where: { id }, select: { userId: true } });
  if (!key || key.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.apiKey.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
