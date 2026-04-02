import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidRepo } from "@/lib/validate-repo";
import { createDeepImpactJob } from "@/lib/ai-jobs";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await prisma.aiAnalysisJob.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      type: true,
      status: true,
      plan: true,
      attempts: true,
      error: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  });

  return NextResponse.json({ jobs });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { type?: string; repo?: string; prNumber?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.type !== "deep-impact") {
    return NextResponse.json({ error: "Unsupported job type" }, { status: 400 });
  }

  const repo = (body.repo ?? "").trim();
  const prNumber = Number(body.prNumber);
  if (!isValidRepo(repo)) {
    return NextResponse.json({ error: "Invalid repository format" }, { status: 400 });
  }
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    return NextResponse.json({ error: "Invalid PR number" }, { status: 400 });
  }

  const activeJobs = await prisma.aiAnalysisJob.count({
    where: {
      userId: session.user.id,
      status: { in: ["queued", "running"] },
    },
  });
  if (activeJobs >= 8) {
    return NextResponse.json(
      {
        error: "Too many active analysis jobs. Wait for running jobs to complete.",
      },
      { status: 429 }
    );
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const job = await createDeepImpactJob({
    userId: session.user.id,
    plan,
    repo,
    prNumber,
  });

  return NextResponse.json({ job }, { status: 201 });
}
