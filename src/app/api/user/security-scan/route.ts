import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { getCapabilitiesForPlan, resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { consumeUsageBudget } from "@/lib/ai-usage";

interface NpmAdvisory {
  id: number;
  severity: "critical" | "high" | "moderate" | "low" | "info";
  title: string;
  url: string;
  recommendation: string;
  vulnerable_versions: string;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  let deps: string[] = [];
  try {
    const body = await req.json();
    deps = body.deps ?? [];
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!Array.isArray(deps) || deps.length === 0) {
    return NextResponse.json({ vulnerabilities: [] });
  }

  // Only npm-safe package names (covers scoped packages like @org/pkg)
  const safeDeps = deps
    .filter((d) => typeof d === "string" && /^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/.test(d))
    .slice(0, caps.maxPackagesPerSecurityScan);

  if (safeDeps.length === 0) {
    return NextResponse.json({ vulnerabilities: [] });
  }

  const budget = await consumeUsageBudget({
    userId: session.user.id,
    feature: "security-scan",
    plan,
    limit: Math.max(10, Math.floor(caps.aiRequestsPerHour / 3)),
    metadata: { endpoint: "/api/user/security-scan" },
  });
  if (!budget.allowed) {
    return NextResponse.json(
      { error: "Security scan limit reached for this hour." },
      { status: 429 }
    );
  }

  try {
    // npm bulk advisory API — returns known vulnerabilities for package names
    const query: Record<string, string[]> = {};
    for (const dep of safeDeps) {
      query[dep] = ["*"];
    }

    const res = await fetch(
      "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      }
    );

    if (!res.ok) {
      return NextResponse.json({ vulnerabilities: [] });
    }

    const data: Record<string, NpmAdvisory[]> = await res.json();

    const vulnerabilities = Object.entries(data)
      .filter(([, advs]) => Array.isArray(advs) && advs.length > 0)
      .map(([pkg, advs]) => ({
        package: pkg,
        advisories: advs.map((a) => ({
          id: a.id,
          severity: a.severity,
          title: a.title,
          url: a.url,
          fixedIn: a.recommendation ?? "Update to latest version",
          vulnerableVersions: a.vulnerable_versions ?? "*",
        })),
      }));

    return NextResponse.json({
      vulnerabilities,
      scanned: safeDeps.length,
      meta: {
        plan,
        packageLimit: caps.maxPackagesPerSecurityScan,
        rateRemaining: budget.remaining,
      },
    });
  } catch (error) {
    // Log error only in development
    if (process.env.NODE_ENV !== "production") {
      console.error("Security scan error:", error);
    }
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}
