import type { Session } from "next-auth";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AiPlan } from "@/lib/ai-plan";
import { getCapabilitiesForPlan } from "@/lib/ai-plan";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { runDeepImpactScan } from "@/lib/ai-deep-impact";
import { isValidRepo } from "@/lib/validate-repo";

const RUNNING_STALE_MS = 10 * 60 * 1000;

interface DeepImpactInput {
  repo: string;
  prNumber: number;
}

function parseDeepImpactInput(input: Prisma.JsonValue): DeepImpactInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const repo = typeof raw.repo === "string" ? raw.repo : "";
  const prNumber = Number(raw.prNumber);

  if (!isValidRepo(repo)) return null;
  if (!Number.isInteger(prNumber) || prNumber < 1) return null;
  return { repo, prNumber };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function createDeepImpactJob(params: {
  userId: string;
  plan: AiPlan;
  repo: string;
  prNumber: number;
}) {
  return prisma.aiAnalysisJob.create({
    data: {
      userId: params.userId,
      type: "deepImpact",
      status: "queued",
      plan: params.plan,
      input: { repo: params.repo, prNumber: params.prNumber },
    },
    select: {
      id: true,
      status: true,
      type: true,
      plan: true,
      createdAt: true,
    },
  });
}

export async function getAnalysisJobForUser(jobId: string, userId: string) {
  return prisma.aiAnalysisJob.findFirst({
    where: { id: jobId, userId },
  });
}

async function recoverStaleRun(jobId: string) {
  await prisma.aiAnalysisJob.update({
    where: { id: jobId },
    data: {
      status: "queued",
      startedAt: null,
      error: "Recovered from stale run.",
    },
  });
}

async function markJobFailed(jobId: string, message: string) {
  await prisma.aiAnalysisJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      error: message.slice(0, 500),
      completedAt: new Date(),
    },
  });
}

export async function processAnalysisJob(jobId: string, userId: string, session?: Session | null) {
  let job = await getAnalysisJobForUser(jobId, userId);
  if (!job) return null;

  if (job.status === "running" && job.startedAt) {
    const runningFor = Date.now() - job.startedAt.getTime();
    if (runningFor > RUNNING_STALE_MS) {
      await recoverStaleRun(job.id);
      job = await getAnalysisJobForUser(job.id, userId);
      if (!job) return null;
    }
  }

  if (job.status !== "queued") {
    return job;
  }

  const claim = await prisma.aiAnalysisJob.updateMany({
    where: { id: job.id, userId, status: "queued" },
    data: {
      status: "running",
      startedAt: new Date(),
      error: null,
      attempts: { increment: 1 },
    },
  });

  if (claim.count !== 1) {
    return getAnalysisJobForUser(job.id, userId);
  }

  const running = await getAnalysisJobForUser(job.id, userId);
  if (!running) return null;

  if (running.type !== "deepImpact") {
    await markJobFailed(running.id, "Unsupported job type.");
    return getAnalysisJobForUser(running.id, userId);
  }

  const payload = parseDeepImpactInput(running.input);
  if (!payload) {
    await markJobFailed(running.id, "Invalid job payload.");
    return getAnalysisJobForUser(running.id, userId);
  }

  const plan = running.plan as AiPlan;
  const caps = getCapabilitiesForPlan(plan);

  const usage = await consumeUsageBudget({
    userId,
    feature: "deep-impact",
    plan,
    limit: Math.max(8, Math.floor(caps.aiRequestsPerHour / 2)),
    metadata: { jobId: running.id, repo: payload.repo, prNumber: payload.prNumber },
  });

  if (!usage.allowed) {
    await markJobFailed(running.id, "Deep AI scan hourly limit reached.");
    return getAnalysisJobForUser(running.id, userId);
  }

  try {
    const scan = await runDeepImpactScan({
      repo: payload.repo,
      prNumber: payload.prNumber,
      plan,
      maxFiles: caps.maxFilesPerDeepScan,
      allowEnvFallback: caps.allowSharedTokenFallback,
      session,
      userId,
    });

    await prisma.aiAnalysisJob.update({
      where: { id: running.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        result: toJson({
          ...scan.report,
          meta: {
            plan,
            tokenSource: scan.tokenSource,
            rateRemaining: usage.remaining,
            maxFilesAnalyzed: scan.maxFilesAnalyzed,
            githubCalls: scan.githubCalls,
          },
        }),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process analysis job.";
    await markJobFailed(running.id, message);
  }

  return getAnalysisJobForUser(running.id, userId);
}
