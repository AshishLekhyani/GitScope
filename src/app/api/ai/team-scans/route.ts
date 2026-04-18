export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

// Returns scan history for repos belonging to a given org prefix, across all users who
// have scanned them. Used for the Shared Workspace view in the Organizations page.
async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const org = req.nextUrl.searchParams.get("org");
  if (!org) return NextResponse.json({ error: "org param required" }, { status: 400 });

  // Fetch the 50 most recent scans for repos in this org, from ALL users.
  // We only surface aggregate/anonymous data — no PII beyond GitHub usernames.
  const scans = await prisma.repoScanHistory.findMany({
    where: { repo: { startsWith: `${org}/` } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      repo: true,
      healthScore: true,
      securityScore: true,
      qualityScore: true,
      criticalCount: true,
      highCount: true,
      summary: true,
      createdAt: true,
      user: { select: { name: true, image: true, githubHandle: true } },
    },
  });

  // Group by repo — latest scan per repo
  const byRepo = new Map<string, typeof scans[number]>();
  for (const scan of scans) {
    if (!byRepo.has(scan.repo)) byRepo.set(scan.repo, scan);
  }

  const repos = [...byRepo.values()].sort((a, b) => b.healthScore - a.healthScore);

  // Fleet-level aggregates
  const avgHealth = repos.length > 0
    ? Math.round(repos.reduce((s, r) => s + r.healthScore, 0) / repos.length)
    : 0;
  const criticalRepos = repos.filter((r) => r.criticalCount > 0 || r.healthScore < 40).length;

  return NextResponse.json({ repos, avgHealth, criticalRepos, total: repos.length });
}

export const GET = withRouteSecurity(handler, SecurityPresets.standard);
