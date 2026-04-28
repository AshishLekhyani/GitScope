export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prunePublicScanCache } from "@/lib/scan-cache";

// GET /api/internal/prune-scan-cache
// Called by a cron job (Vercel Cron, uptime monitor, etc.) to clean expired entries.
// Protected by a simple shared secret so it can't be triggered externally at will.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const secret = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret");
  if (!cronSecret || secret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted = await prunePublicScanCache();
  return NextResponse.json({ ok: true, deleted, prunedAt: new Date().toISOString() });
}
