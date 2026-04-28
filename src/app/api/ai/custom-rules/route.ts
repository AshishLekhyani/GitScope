export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAiPlanFromSessionDb, getCapabilitiesForPlan } from "@/lib/ai-plan";

const VALID_SEVERITIES = ["critical", "high", "medium", "low"] as const;
const VALID_CATEGORIES = ["security", "performance", "quality", "config", "deps"] as const;

function isValidRegex(pattern: string): boolean {
  try { new RegExp(pattern); return true; } catch { return false; }
}

// GET /api/ai/custom-rules
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  if (!caps.customRulesAllowed) {
    return NextResponse.json({
      error: "Custom scan rules require a Developer plan.",
      upgradeRequired: true,
      requiredPlan: "developer",
      plan,
    }, { status: 403 });
  }

  const enabledOnly = new URL(req.url).searchParams.get("enabled") === "true";

  const rules = await prisma.customScanRule.findMany({
    where:   { userId: session.user.id, ...(enabledOnly ? { enabled: true } : {}) },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    rules,
    plan,
    maxCustomRules: caps.maxCustomRules,
    count: rules.length,
  });
}

// POST /api/ai/custom-rules  — create a new rule
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const plan = await resolveAiPlanFromSessionDb(session);
  const caps = getCapabilitiesForPlan(plan);

  if (!caps.customRulesAllowed) {
    return NextResponse.json({
      error: "Custom scan rules require a Developer plan.",
      upgradeRequired: true,
      requiredPlan: "developer",
    }, { status: 403 });
  }

  let body: {
    name?: string;
    description?: string;
    pattern?: string;
    fileGlob?: string;
    severity?: string;
    category?: string;
    suggestion?: string;
    enabled?: boolean;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { name, description, pattern, fileGlob, severity = "medium", category = "quality", suggestion, enabled = true } = body;

  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!pattern?.trim()) return NextResponse.json({ error: "pattern is required" }, { status: 400 });
  if (!suggestion?.trim()) return NextResponse.json({ error: "suggestion is required" }, { status: 400 });
  if (!isValidRegex(pattern)) return NextResponse.json({ error: "pattern is not a valid regular expression" }, { status: 400 });
  if (!VALID_SEVERITIES.includes(severity as typeof VALID_SEVERITIES[number])) {
    return NextResponse.json({ error: "severity must be critical | high | medium | low" }, { status: 400 });
  }
  if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
    return NextResponse.json({ error: "category must be security | performance | quality | config | deps" }, { status: 400 });
  }

  const count = await prisma.customScanRule.count({ where: { userId: session.user.id } });
  if (count >= caps.maxCustomRules) {
    return NextResponse.json({
      error: `Your plan allows up to ${caps.maxCustomRules} custom rules. Delete one to add another.`,
    }, { status: 403 });
  }

  const rule = await prisma.customScanRule.create({
    data: {
      userId:      session.user.id,
      name:        name.trim(),
      description: description?.trim() ?? null,
      pattern:     pattern.trim(),
      fileGlob:    fileGlob?.trim() ?? null,
      severity,
      category,
      suggestion:  suggestion.trim(),
      enabled,
    },
  });

  return NextResponse.json({ rule }, { status: 201 });
}

// PATCH /api/ai/custom-rules/:id  — update a rule
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id param required" }, { status: 400 });

  const existing = await prisma.customScanRule.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.pattern && !isValidRegex(body.pattern as string)) {
    return NextResponse.json({ error: "pattern is not a valid regular expression" }, { status: 400 });
  }

  const rule = await prisma.customScanRule.update({
    where: { id },
    data: {
      ...(body.name        !== undefined ? { name:        (body.name as string).trim() } : {}),
      ...(body.description !== undefined ? { description: (body.description as string).trim() } : {}),
      ...(body.pattern     !== undefined ? { pattern:     (body.pattern as string).trim() } : {}),
      ...(body.fileGlob    !== undefined ? { fileGlob:    (body.fileGlob as string | null) } : {}),
      ...(body.severity    !== undefined ? { severity:    body.severity as string } : {}),
      ...(body.category    !== undefined ? { category:    body.category as string } : {}),
      ...(body.suggestion  !== undefined ? { suggestion:  (body.suggestion as string).trim() } : {}),
      ...(body.enabled     !== undefined ? { enabled:     Boolean(body.enabled) } : {}),
    },
  });

  return NextResponse.json({ rule });
}

// DELETE /api/ai/custom-rules?id=xxx
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id param required" }, { status: 400 });

  const existing = await prisma.customScanRule.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  await prisma.customScanRule.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
