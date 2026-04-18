import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processAnalysisJob } from "@/lib/ai-jobs";

function getCronSecret(): string | null {
  return process.env.AI_JOBS_CRON_SECRET ?? process.env.CRON_SECRET ?? null;
}

function isCronAuthorized(req: Request): boolean {
  const secret = getCronSecret();
  const auth = req.headers.get("authorization");

  // Dev: always allow
  if (process.env.NODE_ENV !== "production") return true;

  // If a secret is configured, it must match
  if (secret) return auth === `Bearer ${secret}`;

  // No secret set — fall back to Vercel's built-in cron header.
  // Note: x-vercel-cron can't be spoofed from outside Vercel's network.
  return req.headers.get("x-vercel-cron") === "1";
}

function getBatchSize(): number {
  const parsed = Number(process.env.AI_JOBS_CRON_BATCH ?? "2");
  if (!Number.isFinite(parsed) || parsed < 1) return 2;
  return Math.min(10, Math.floor(parsed));
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batchSize = getBatchSize();
  const candidates = await prisma.aiAnalysisJob.findMany({
    where: {
      status: {
        in: ["queued", "running"],
      },
    },
    orderBy: [
      { createdAt: "asc" },
    ],
    take: batchSize,
    select: {
      id: true,
      userId: true,
      status: true,
    },
  });

  const processed: Array<{
    id: string;
    before: string;
    after: string;
    error: string | null;
  }> = [];

  for (const job of candidates) {
    try {
      const updated = await processAnalysisJob(job.id, job.userId);
      processed.push({
        id: job.id,
        before: job.status,
        after: updated?.status ?? "missing",
        error: updated?.error ?? null,
      });
    } catch (error) {
      processed.push({
        id: job.id,
        before: job.status,
        after: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // ── Also queue any due scheduled scans ────────────────────────────────────
  const now = new Date();
  const dueScans = await prisma.scheduledScan.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    include: { user: { select: { aiTier: true } } },
    take: 10,
  });

  let scheduledQueued = 0;
  for (const scan of dueScans) {
    try {
      // Skip if user already has a queued/running repoScan job (rough dedup)
      const existing = await prisma.aiAnalysisJob.findFirst({
        where: { userId: scan.userId, type: "repoScan", status: { in: ["queued", "running"] } },
      });
      if (existing) continue;

      await prisma.aiAnalysisJob.create({
        data: {
          userId: scan.userId,
          type: "repoScan",
          status: "queued",
          plan: scan.user.aiTier,
          input: { repo: scan.repo, scanMode: "standard", triggeredBy: "scheduled" },
        },
      });

      const next = new Date(now);
      if (scan.schedule === "daily")   next.setDate(next.getDate() + 1);
      if (scan.schedule === "weekly")  next.setDate(next.getDate() + 7);
      if (scan.schedule === "monthly") next.setMonth(next.getMonth() + 1);

      await prisma.scheduledScan.update({ where: { id: scan.id }, data: { nextRunAt: next } });
      scheduledQueued++;
    } catch { /* non-fatal */ }
  }

  // ── Monday: fire weekly digest for all opted-in users ─────────────────────
  let digestResult: { sent?: number; skipped?: boolean } = {};
  if (now.getUTCDay() === 1) {
    try {
      const digestRes = await fetch(
        `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/internal/digest-cron`,
        { headers: { authorization: `Bearer ${process.env.AI_JOBS_CRON_SECRET ?? process.env.CRON_SECRET ?? ""}` } }
      );
      digestResult = digestRes.ok ? await digestRes.json() : { skipped: true };
    } catch { digestResult = { skipped: true }; }
  }

  return NextResponse.json({
    ok: true,
    batchSize,
    picked: candidates.length,
    processed,
    scheduledQueued,
    digest: digestResult,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(req: Request) {
  return GET(req);
}
