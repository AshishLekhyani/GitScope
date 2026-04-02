import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAnalysisJobForUser, processAnalysisJob } from "@/lib/ai-jobs";

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

function serializeJob(job: Awaited<ReturnType<typeof getAnalysisJobForUser>>) {
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    plan: job.plan,
    attempts: job.attempts,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    result: job.result,
  };
}

export async function GET(_req: Request, context: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await context.params;
  if (!jobId) {
    return NextResponse.json({ error: "Job id is required" }, { status: 400 });
  }

  const existing = await getAnalysisJobForUser(jobId, session.user.id);
  if (!existing) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const job =
    existing.status === "queued" || existing.status === "running"
      ? await processAnalysisJob(jobId, session.user.id, session)
      : existing;

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job: serializeJob(job) });
}
