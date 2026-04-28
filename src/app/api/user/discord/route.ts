export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";

const DISCORD_WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/.+$/;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { discordWebhookUrl: true },
  });

  return NextResponse.json({ saved: !!user?.discordWebhookUrl });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await resolveAiPlanFromSessionDb(session);
  if (plan === "free") {
    return NextResponse.json({ error: "Discord integration requires Developer plan." }, { status: 403 });
  }

  let body: { webhookUrl?: string; remove?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.remove) {
    await prisma.user.update({ where: { id: session.user.id }, data: { discordWebhookUrl: null } });
    return NextResponse.json({ ok: true });
  }

  const url = (body.webhookUrl ?? "").trim();
  if (!DISCORD_WEBHOOK_RE.test(url)) {
    return NextResponse.json({ error: "Invalid Discord webhook URL" }, { status: 400 });
  }

  await prisma.user.update({ where: { id: session.user.id }, data: { discordWebhookUrl: url } });
  return NextResponse.json({ ok: true });
}

// PATCH — test the webhook
export async function PATCH() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { discordWebhookUrl: true },
  });
  if (!user?.discordWebhookUrl) return NextResponse.json({ error: "No webhook configured" }, { status: 400 });

  try {
    const { testDiscordWebhook } = await import("@/lib/discord");
    await testDiscordWebhook(user.discordWebhookUrl);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Test failed" }, { status: 502 });
  }
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.user.update({ where: { id: session.user.id }, data: { discordWebhookUrl: null } });
  return NextResponse.json({ ok: true });
}
