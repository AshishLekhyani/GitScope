export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { prisma } from "@/lib/prisma";

// GET /api/v1/repos/{owner}/{repo}/scan
// Returns the latest scan result for the given repo (key scope: scans:read)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const auth = await authenticateApiKey(req, "scans:read");
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key", hint: "Pass your key as Bearer token or X-API-Key header" }, { status: 401 });
  }

  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const latest = await prisma.repoScanHistory.findFirst({
    where: { userId: auth.userId, repo: fullName },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      repo: true,
      scanMode: true,
      healthScore: true,
      securityScore: true,
      qualityScore: true,
      performanceScore: true,
      criticalCount: true,
      highCount: true,
      mediumCount: true,
      summary: true,
      createdAt: true,
    },
  });

  if (!latest) {
    return NextResponse.json({ error: "No scan found for this repository" }, { status: 404 });
  }

  return NextResponse.json({ object: "scan", ...latest });
}
