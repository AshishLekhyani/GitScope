/**
 * GET /api/ai/benchmarks?metric=healthScore&language=all&sizeClass=all
 *
 * Returns benchmark percentiles for comparison ("your repo vs community median").
 *
 * If no BenchmarkStat rows exist yet, computes them on-the-fly from the
 * RepoScanHistory table (across all users, anonymised) and caches for 24h.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAiPlanFromSessionDb, getCapabilitiesForPlan } from "@/lib/ai-plan";

const VALID_METRICS  = ["healthScore", "securityScore", "qualityScore", "performanceScore"] as const;
type Metric = typeof VALID_METRICS[number];

// ── Percentile helper ─────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

// ── Compute benchmarks from raw scan history ──────────────────────────────────

async function computeBenchmarks(metric: Metric) {
  const field = metric as "healthScore" | "securityScore" | "qualityScore" | "performanceScore";

  // Pull the latest scan per repo per user (to avoid one active repo skewing)
  const rows = await prisma.repoScanHistory.findMany({
    select: { [field]: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const values = rows
    .map((r) => (r as Record<string, unknown>)[field] as number)
    .filter((v) => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);

  if (values.length < 3) return null;

  return {
    p25: Math.round(percentile(values, 25)),
    p50: Math.round(percentile(values, 50)),
    p75: Math.round(percentile(values, 75)),
    p90: Math.round(percentile(values, 90)),
    sampleCount: values.length,
  };
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  if (!caps.benchmarkComparisonAllowed) {
    return NextResponse.json({
      error: "Benchmark comparison requires a Professional plan or higher.",
      upgradeRequired: true,
      requiredPlan: "professional",
    }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const metric    = (searchParams.get("metric") ?? "healthScore") as Metric;
  const language  = searchParams.get("language") ?? "all";
  const sizeClass = searchParams.get("sizeClass") ?? "all";

  if (!VALID_METRICS.includes(metric)) {
    return NextResponse.json({ error: `metric must be one of: ${VALID_METRICS.join(", ")}` }, { status: 400 });
  }

  // Try cached benchmark
  const cached = await prisma.benchmarkStat.findUnique({
    where: { language_sizeClass_metric: { language, sizeClass, metric } },
  });

  // Use cache if < 24 hours old
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  if (cached && Date.now() - cached.computedAt.getTime() < CACHE_TTL_MS) {
    return NextResponse.json({ benchmark: cached, cached: true });
  }

  // Recompute
  const stats = await computeBenchmarks(metric);
  if (!stats) {
    return NextResponse.json({
      benchmark: null,
      message: "Not enough data yet — benchmarks will appear once more repos are scanned.",
    });
  }

  // Upsert cache
  const benchmark = await prisma.benchmarkStat.upsert({
    where:  { language_sizeClass_metric: { language, sizeClass, metric } },
    create: { language, sizeClass, metric, ...stats },
    update: { ...stats, computedAt: new Date() },
  });

  return NextResponse.json({ benchmark, cached: false });
}
