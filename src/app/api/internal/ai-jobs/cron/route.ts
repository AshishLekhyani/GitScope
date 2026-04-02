import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processAnalysisJob } from "@/lib/ai-jobs";

function getCronSecret(): string | null {
  return process.env.AI_JOBS_CRON_SECRET ?? process.env.CRON_SECRET ?? null;
}

function isCronAuthorized(req: Request): boolean {
  const secret = getCronSecret();
  const auth = req.headers.get("authorization");
  const vercelCronHeader = req.headers.get("x-vercel-cron");

  if (secret) {
    return auth === `Bearer ${secret}`;
  }

  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(vercelCronHeader);
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

  return NextResponse.json({
    ok: true,
    batchSize,
    picked: candidates.length,
    processed,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(req: Request) {
  return GET(req);
}
