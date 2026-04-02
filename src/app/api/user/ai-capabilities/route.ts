import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCapabilitiesForPlan, resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import { getUsageSnapshot } from "@/lib/ai-usage";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const capabilities = getCapabilitiesForPlan(plan);
  const { source } = await getGitHubTokenWithSource({
    allowEnvFallback: capabilities.allowSharedTokenFallback,
    session,
  });
  const usage = await getUsageSnapshot(session.user.id);

  return NextResponse.json({
    plan,
    capabilities,
    githubAuthSource: source,
    hasPersonalGitHubAuth: source === "session-oauth" || source === "user-pat",
    usage,
  });
}
