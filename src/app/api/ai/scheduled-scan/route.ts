export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAiPlanFromSessionDb, getCapabilitiesForPlan } from "@/lib/ai-plan";
import type { ScheduleFrequency } from "@prisma/client";

const VALID_SCHEDULES: ScheduleFrequency[] = ["daily", "weekly", "monthly"];

function nextRunDate(schedule: ScheduleFrequency): Date {
  const d = new Date();
  if (schedule === "daily")   d.setDate(d.getDate() + 1);
  if (schedule === "weekly")  d.setDate(d.getDate() + 7);
  if (schedule === "monthly") d.setMonth(d.getMonth() + 1);
  return d;
}

// GET /api/ai/scheduled-scan?repo=owner/repo
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const repo = new URL(req.url).searchParams.get("repo") ?? "";
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "Invalid repo format" }, { status: 400 });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  if (!caps.scheduledScansAllowed) {
    return NextResponse.json({
      error: "Scheduled scans require a Professional plan or higher.",
      upgradeRequired: true,
      requiredPlan: "professional",
      plan,
    }, { status: 403 });
  }

  const where = repo
    ? { userId: session.user.id, repo }
    : { userId: session.user.id };

  const scheduled = await prisma.scheduledScan.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, repo: true, scanMode: true, schedule: true,
      alertOnDrop: true, alertEmail: true,
      lastRunAt: true, lastScore: true, nextRunAt: true, enabled: true, createdAt: true,
    },
  });

  return NextResponse.json({
    scheduled,
    plan,
    maxScheduledScans: caps.maxScheduledScans,
    count: scheduled.length,
  });
}

// POST /api/ai/scheduled-scan  — create or update a schedule
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  if (!caps.scheduledScansAllowed) {
    return NextResponse.json({
      error: "Scheduled scans require a Professional plan or higher.",
      upgradeRequired: true,
      requiredPlan: "professional",
    }, { status: 403 });
  }

  let body: {
    repo?: string;
    schedule?: string;
    scanMode?: string;
    alertOnDrop?: number | null;
    alertEmail?: string | null;
    enabled?: boolean;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { repo, schedule = "weekly", scanMode = "quick", alertOnDrop = null, alertEmail = null, enabled = true } = body;

  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "Invalid repo format" }, { status: 400 });
  }
  if (!VALID_SCHEDULES.includes(schedule as ScheduleFrequency)) {
    return NextResponse.json({ error: "schedule must be daily | weekly | monthly" }, { status: 400 });
  }
  if (!["quick", "deep"].includes(scanMode)) {
    return NextResponse.json({ error: "scanMode must be quick | deep" }, { status: 400 });
  }
  if (scanMode === "deep" && !caps.deepScanAllowed) {
    return NextResponse.json({ error: "Deep scan requires Team plan or higher." }, { status: 403 });
  }
  if (alertEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail)) {
    return NextResponse.json({ error: "Invalid alert email" }, { status: 400 });
  }

  // Check cap
  const existing = await prisma.scheduledScan.findUnique({
    where: { userId_repo: { userId: session.user.id, repo } },
  });
  if (!existing) {
    const count = await prisma.scheduledScan.count({ where: { userId: session.user.id } });
    if (count >= caps.maxScheduledScans) {
      return NextResponse.json({
        error: `Your plan allows up to ${caps.maxScheduledScans} scheduled scans. Delete one to add another.`,
      }, { status: 403 });
    }
  }

  const record = await prisma.scheduledScan.upsert({
    where:  { userId_repo: { userId: session.user.id, repo } },
    create: {
      userId:      session.user.id,
      repo,
      schedule:    schedule as ScheduleFrequency,
      scanMode,
      alertOnDrop: alertOnDrop ?? null,
      alertEmail:  alertEmail ?? null,
      enabled,
      nextRunAt:   nextRunDate(schedule as ScheduleFrequency),
    },
    update: {
      schedule:    schedule as ScheduleFrequency,
      scanMode,
      alertOnDrop: alertOnDrop ?? null,
      alertEmail:  alertEmail ?? null,
      enabled,
      nextRunAt:   nextRunDate(schedule as ScheduleFrequency),
    },
  });

  return NextResponse.json({ scheduled: record });
}

// DELETE /api/ai/scheduled-scan?repo=owner/repo
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const repo = new URL(req.url).searchParams.get("repo") ?? "";
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "Invalid repo format" }, { status: 400 });
  }

  await prisma.scheduledScan.deleteMany({
    where: { userId: session.user.id, repo },
  });

  return NextResponse.json({ deleted: true });
}
