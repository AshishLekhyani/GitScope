export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAiPlanFromSessionDb, getCapabilitiesForPlan } from "@/lib/ai-plan";

// GET /api/ai/scan-history?repo=owner/repo&limit=60
// Returns historical scan scores for the requesting user's repo.
// Free users get a 403 with upgradeRequired — history is Pro+.

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const repo  = searchParams.get("repo") ?? "";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "60", 10), 120);
  const overviewOnly = searchParams.get("overview") === "1";

  if (!overviewOnly && repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "Invalid repo format" }, { status: 400 });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  if (caps.scanHistoryDays === 0) {
    return NextResponse.json({
      error: "Scan history requires a Developer plan.",
      upgradeRequired: true,
      requiredPlan: "developer",
      plan,
    }, { status: 403 });
  }

  const history = overviewOnly || !repo ? [] : await prisma.repoScanHistory.findMany({
    where:   { userId: session.user.id, repo },
    orderBy: { createdAt: "asc" },
    take:    limit,
    select: {
      id:              true,
      healthScore:     true,
      securityScore:   true,
      qualityScore:    true,
      performanceScore: true,
      criticalCount:   true,
      highCount:       true,
      mediumCount:     true,
      scanMode:        true,
      locEstimate:     true,
      filesScanned:    true,
      model:           true,
      createdAt:       true,
    },
  });

  // All scanned repos for this user (for org-level dashboard)
  const allRepos = await prisma.repoScanHistory.groupBy({
    by:      ["repo"],
    where:   { userId: session.user.id },
    _max:    { healthScore: true, createdAt: true },
    _count:  { id: true },
    orderBy: { _max: { createdAt: "desc" } },
    take:    50,
  });

  return NextResponse.json({
    repo,
    plan,
    historyDays: caps.scanHistoryDays,
    history,
    allRepos: allRepos.map((r) => ({
      repo:        r.repo,
      lastScore:   r._max.healthScore,
      lastScanned: r._max.createdAt,
      scanCount:   r._count.id,
    })),
  });
}

// DELETE /api/ai/scan-history?repo=owner/repo  — clear history for a repo
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo") ?? "";
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "Invalid repo format" }, { status: 400 });
  }

  const { count } = await prisma.repoScanHistory.deleteMany({
    where: { userId: session.user.id, repo },
  });

  return NextResponse.json({ deleted: count });
}
