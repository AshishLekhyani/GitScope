import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { isValidRepo } from "@/lib/validate-repo";
import { getCapabilitiesForPlan, resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { DeepImpactError, runDeepImpactScan } from "@/lib/ai-deep-impact";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  const prNumber = searchParams.get("pr");

  if (!repo || !prNumber) {
    return NextResponse.json({ error: "repo and pr params required" }, { status: 400 });
  }
  if (!isValidRepo(repo)) {
    return NextResponse.json({ error: "Invalid repository format" }, { status: 400 });
  }
  const prNum = parseInt(prNumber, 10);
  if (Number.isNaN(prNum) || prNum < 1) {
    return NextResponse.json({ error: "Invalid PR number" }, { status: 400 });
  }

  const aiBudget = await consumeUsageBudget({
    userId: session.user.id,
    feature: "deep-impact",
    plan,
    limit: Math.max(8, Math.floor(caps.aiRequestsPerHour / 2)),
    metadata: { endpoint: "/api/user/code-impact" },
  });
  if (!aiBudget.allowed) {
    return NextResponse.json(
      {
        error: "Deep AI scan limit reached for this hour.",
        upgradeHint: "Upgrade your AI tier or wait for hourly reset.",
      },
      { status: 429 }
    );
  }

  try {
    const scan = await runDeepImpactScan({
      repo,
      prNumber: prNum,
      plan,
      maxFiles: caps.maxFilesPerDeepScan,
      allowEnvFallback: caps.allowSharedTokenFallback,
      session,
      userId: session.user.id,
    });

    return NextResponse.json({
      ...scan.report,
      meta: {
        plan,
        tokenSource: scan.tokenSource,
        rateRemaining: aiBudget.remaining,
        maxFilesAnalyzed: scan.maxFilesAnalyzed,
        githubCalls: scan.githubCalls,
      },
    });
  } catch (error) {
    if (error instanceof DeepImpactError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // Log error only in development
    if (process.env.NODE_ENV !== "production") {
      console.error("Code Impact Error:", error);
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
