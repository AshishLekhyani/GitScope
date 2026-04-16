/**
 * GET  /api/user/digest          — get digest preferences
 * POST /api/user/digest          — update digest preferences
 * POST /api/user/digest?send=1   — trigger a digest send immediately (dev / manual)
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAiPlanFromSessionDb, getCapabilitiesForPlan } from "@/lib/ai-plan";
import { sendEmail, buildWeeklyDigestEmail } from "@/lib/email";
import { sendWeeklyDigestSlack } from "@/lib/slack";

// ── GET — return digest settings ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      weeklyDigestEnabled: true,
      weeklyDigestLastSent: true,
      slackWebhookUrl: true,
      email: true,
    },
  });

  return NextResponse.json({
    weeklyDigestEnabled: user?.weeklyDigestEnabled ?? false,
    weeklyDigestLastSent: user?.weeklyDigestLastSent ?? null,
    hasSlack: !!(user?.slackWebhookUrl),
    email: user?.email ?? null,
  });
}

// ── POST — update settings or send digest ─────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  // Only pro+ can use weekly digest
  if (plan === "free") {
    return NextResponse.json({
      error: "Weekly digest requires a Professional plan or higher.",
      upgradeRequired: true,
    }, { status: 403 });
  }

  const sendNow = new URL(req.url).searchParams.get("send") === "1";

  let body: { weeklyDigestEnabled?: boolean } = {};
  try { body = await req.json(); } catch { /* no body = send-only */ }

  // Update preference if provided
  if (typeof body.weeklyDigestEnabled === "boolean") {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { weeklyDigestEnabled: body.weeklyDigestEnabled },
    });
    if (!sendNow) return NextResponse.json({ ok: true });
  }

  if (!sendNow) return NextResponse.json({ ok: true });

  // ── Build digest data ───────────────────────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      slackWebhookUrl: true,
    },
  });
  if (!user?.email) return NextResponse.json({ error: "No email on account" }, { status: 400 });

  // Fetch latest scan per repo in last 30 days
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const scans = await prisma.repoScanHistory.findMany({
    where: { userId: session.user.id, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });

  // Group: latest scan per repo
  const latestByRepo = new Map<string, typeof scans[0]>();
  for (const s of scans) {
    if (!latestByRepo.has(s.repo)) latestByRepo.set(s.repo, s);
  }
  const repoEntries = [...latestByRepo.values()];
  const repoCount = repoEntries.length;
  const avgScore = repoCount > 0
    ? Math.round(repoEntries.reduce((s, r) => s + r.healthScore, 0) / repoCount)
    : 0;

  // Previous week average (7-14 days ago)
  const prevSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const prevUntil = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
  const prevScans = await prisma.repoScanHistory.findMany({
    where: { userId: session.user.id, createdAt: { gte: prevSince, lte: prevUntil } },
  });
  const prevAvg = prevScans.length > 0
    ? Math.round(prevScans.reduce((s, r) => s + r.healthScore, 0) / prevScans.length)
    : avgScore;
  const weeklyDelta = avgScore - prevAvg;

  const sorted = repoEntries.sort((a, b) => b.healthScore - a.healthScore);
  const topRepos    = sorted.slice(0, 3).map(r => ({ name: r.repo, score: r.healthScore }));
  const atRiskRepos = sorted.filter(r => r.healthScore < 50).slice(0, 3).map(r => ({ name: r.repo, score: r.healthScore }));
  const totalScans  = scans.length;

  // ── Send email ──────────────────────────────────────────────────────────────
  const emailContent = buildWeeklyDigestEmail({
    name: user.name ?? "",
    repoCount,
    avgScore,
    weeklyDelta,
    atRiskRepos,
    topRepos,
    totalScans,
  });
  await sendEmail({ to: user.email, ...emailContent });

  // ── Send Slack if configured ────────────────────────────────────────────────
  if (user.slackWebhookUrl && caps.slackNotificationsAllowed) {
    await sendWeeklyDigestSlack(user.slackWebhookUrl, {
      repoCount,
      avgScore,
      atRiskCount: atRiskRepos.length,
      topRepo: topRepos[0]?.name ?? "—",
      topScore: topRepos[0]?.score ?? 0,
      weeklyDelta,
    }).catch(() => { /* slack failure should not block email */ });
  }

  // Update last sent timestamp
  await prisma.user.update({
    where: { id: session.user.id },
    data: { weeklyDigestLastSent: new Date() },
  });

  return NextResponse.json({ ok: true, sent: true, repoCount, avgScore });
}
