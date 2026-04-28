export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/internal/digest-cron
 * Runs every Monday at 08:00 UTC via the main daily cron.
 * Fans out weekly digest emails + Slack/Discord to all users with weeklyDigestEnabled=true
 * who haven't received a digest in the past 6 days.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, buildWeeklyDigestEmail } from "@/lib/email";
import { sendWeeklyDigestSlack } from "@/lib/slack";
import { sendDiscordDigest } from "@/lib/discord";
import { getCapabilitiesForPlan, fromPrismaTier } from "@/lib/ai-plan";

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.AI_JOBS_CRON_SECRET ?? process.env.CRON_SECRET ?? null;
  const auth = req.headers.get("authorization");
  if (process.env.NODE_ENV !== "production") return true;
  if (secret) return auth === `Bearer ${secret}`;
  return req.headers.get("x-vercel-cron") === "1";
}

async function sendDigestForUser(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const [user, bookmarks] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true, email: true, aiTier: true,
        slackWebhookUrl: true, discordWebhookUrl: true, githubHandle: true,
      },
    }),
    prisma.bookmark.findMany({ where: { userId }, select: { owner: true, repo: true } }),
  ]);

  if (!user?.email) return { ok: false, reason: "no email" };

  const caps = getCapabilitiesForPlan(fromPrismaTier(user.aiTier));
  const ownerHandle = user.githubHandle?.toLowerCase() ?? null;
  const bookmarkedSet = new Set(bookmarks.map((b) => `${b.owner}/${b.repo}`.toLowerCase()));
  const relevantRepo = (repo: string) => {
    const lower = repo.toLowerCase();
    if (ownerHandle && lower.startsWith(`${ownerHandle}/`)) return true;
    return bookmarkedSet.has(lower);
  };

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const allScans = await prisma.repoScanHistory.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
  const scans = allScans.filter((s) => relevantRepo(s.repo));
  if (scans.length === 0) return { ok: false, reason: "no scan data" };

  const latestByRepo = new Map<string, typeof scans[0]>();
  for (const s of scans) { if (!latestByRepo.has(s.repo)) latestByRepo.set(s.repo, s); }
  const repoEntries = [...latestByRepo.values()];
  const repoCount = repoEntries.length;
  const avgScore = repoCount > 0
    ? Math.round(repoEntries.reduce((s, r) => s + r.healthScore, 0) / repoCount) : 0;

  const prevSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const prevUntil = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const prevScans = (await prisma.repoScanHistory.findMany({
    where: { userId, createdAt: { gte: prevSince, lte: prevUntil } },
  })).filter((s) => relevantRepo(s.repo));
  const prevAvg = prevScans.length > 0
    ? Math.round(prevScans.reduce((s, r) => s + r.healthScore, 0) / prevScans.length) : avgScore;
  const weeklyDelta = avgScore - prevAvg;

  const sorted = repoEntries.sort((a, b) => b.healthScore - a.healthScore);
  const topRepos = sorted.slice(0, 3).map(r => ({ name: r.repo, score: r.healthScore }));
  const atRiskRepos = sorted.filter(r => r.healthScore < 50).slice(0, 3).map(r => ({ name: r.repo, score: r.healthScore }));

  await sendEmail({ to: user.email, ...buildWeeklyDigestEmail({
    name: user.name ?? "", repoCount, avgScore, weeklyDelta,
    atRiskRepos, topRepos, totalScans: scans.length,
  }) });

  if (user.slackWebhookUrl && caps.slackNotificationsAllowed) {
    await sendWeeklyDigestSlack(user.slackWebhookUrl, {
      repoCount, avgScore, atRiskCount: atRiskRepos.length,
      topRepo: topRepos[0]?.name ?? "—", topScore: topRepos[0]?.score ?? 0, weeklyDelta,
    }).catch(() => {});
  }

  if (user.discordWebhookUrl && caps.slackNotificationsAllowed) {
    await sendDiscordDigest(user.discordWebhookUrl, {
      repoCount, avgScore, atRiskCount: atRiskRepos.length,
      topRepo: topRepos[0]?.name ?? "—", topScore: topRepos[0]?.score ?? 0, weeklyDelta,
    }).catch(() => {});
  }

  await prisma.user.update({ where: { id: userId }, data: { weeklyDigestLastSent: new Date() } });
  return { ok: true };
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only Monday (day 1) — this cron may be called daily, we gate on day of week
  const today = new Date();
  if (today.getUTCDay() !== 1) {
    return NextResponse.json({ skipped: true, reason: "Not Monday" });
  }

  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  const users = await prisma.user.findMany({
    where: {
      weeklyDigestEnabled: true,
      email: { not: null },
      OR: [
        { weeklyDigestLastSent: null },
        { weeklyDigestLastSent: { lte: sixDaysAgo } },
      ],
    },
    select: { id: true },
    take: 50, // safety cap per invocation
  });

  let sent = 0;
  let skipped = 0;
  for (const u of users) {
    const result = await sendDigestForUser(u.id);
    if (result.ok) sent++; else skipped++;
  }

  return NextResponse.json({ ok: true, sent, skipped, total: users.length });
}

export async function POST(req: Request) { return GET(req); }
