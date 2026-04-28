export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { validateAutomationActionUrl } from "@/lib/outbound-url";

const VALID_METRICS  = ["healthScore", "securityScore", "qualityScore", "criticalCount"] as const;
const VALID_OPS      = ["lt", "gt", "drop_by"] as const;
const VALID_ACTIONS  = ["slack", "discord", "github_issue", "webhook"] as const;
const MAX_RULES = 100;

// GET /api/webhook-rules — list user's automation rules
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rules = await prisma.webhookRule.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ rules });
}

// POST /api/webhook-rules — create a new automation rule (Team+ plan)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await resolveAiPlanFromSessionDb(session);
  if (plan !== "developer") {
    return NextResponse.json({ error: "Automation rules require a Developer plan.", upgradeRequired: true }, { status: 403 });
  }

  const maxRules = MAX_RULES;
  const existing = await prisma.webhookRule.count({ where: { userId: session.user.id } });
  if (existing >= maxRules) {
    return NextResponse.json({ error: `Rule limit reached (${maxRules}). Delete an existing rule to add a new one.` }, { status: 403 });
  }

  const body = await req.json() as {
    name?: string;
    triggerMetric?: string;
    triggerOp?: string;
    triggerThreshold?: number;
    actionType?: string;
    actionUrl?: string;
    repoFilter?: string;
  };

  const name             = (body.name ?? "").trim();
  const triggerMetric    = body.triggerMetric ?? "";
  const triggerOp        = body.triggerOp ?? "";
  const triggerThreshold = Number(body.triggerThreshold ?? 0);
  const actionType       = body.actionType ?? "";
  const actionUrl        = (body.actionUrl ?? "").trim() || null;
  const repoFilter       = (body.repoFilter ?? "").trim() || null;

  if (!name || name.length < 2 || name.length > 64) return NextResponse.json({ error: "Name must be 2–64 characters." }, { status: 400 });
  if (!VALID_METRICS.includes(triggerMetric as typeof VALID_METRICS[number]))  return NextResponse.json({ error: "Invalid trigger metric." }, { status: 400 });
  if (!VALID_OPS.includes(triggerOp as typeof VALID_OPS[number]))              return NextResponse.json({ error: "Invalid trigger operator." }, { status: 400 });
  if (!VALID_ACTIONS.includes(actionType as typeof VALID_ACTIONS[number]))     return NextResponse.json({ error: "Invalid action type." }, { status: 400 });
  if (isNaN(triggerThreshold)) return NextResponse.json({ error: "Threshold must be a number." }, { status: 400 });
  const actionUrlValidation = validateAutomationActionUrl(actionType, actionUrl);
  if (!actionUrlValidation.ok) return NextResponse.json({ error: actionUrlValidation.error }, { status: 400 });

  const rule = await prisma.webhookRule.create({
    data: {
      userId: session.user.id,
      name,
      triggerMetric,
      triggerOp,
      triggerThreshold,
      actionType,
      actionUrl: actionUrlValidation.url,
      repoFilter,
    },
  });

  return NextResponse.json({ rule }, { status: 201 });
}
