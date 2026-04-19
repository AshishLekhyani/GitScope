export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

// GET /api/orgs — list workspaces the user owns or belongs to
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [owned, memberships] = await Promise.all([
    prisma.organization.findMany({
      where: { ownerId: session.user.id },
      include: { members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } }, _count: { select: { members: true, invites: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.orgMember.findMany({
      where: { userId: session.user.id },
      include: { org: { include: { owner: { select: { id: true, name: true, email: true, image: true } }, _count: { select: { members: true } } } } },
      orderBy: { joinedAt: "desc" },
    }),
  ]);

  const ownedIds = new Set(owned.map((o) => o.id));
  const joined = memberships.filter((m) => !ownedIds.has(m.orgId));

  return NextResponse.json({ owned, joined });
}

// POST /api/orgs — create a workspace (Team+ plan required)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await resolveAiPlanFromSessionDb(session);
  if (plan !== "team" && plan !== "enterprise") {
    return NextResponse.json({ error: "Workspace creation requires a Team plan or higher.", upgradeRequired: true }, { status: 403 });
  }

  const body = await req.json() as { name?: string };
  const name = (body.name ?? "").trim();
  if (!name || name.length < 2 || name.length > 64) {
    return NextResponse.json({ error: "Workspace name must be 2–64 characters." }, { status: 400 });
  }

  const baseSlug = slugify(name);
  let slug = baseSlug;
  let attempt = 0;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${++attempt}`;
  }

  const org = await prisma.organization.create({
    data: {
      name,
      slug,
      ownerId: session.user.id,
      plan: plan === "enterprise" ? "enterprise" : "team",
      maxSeats: plan === "enterprise" ? 999 : 10,
      members: {
        create: { userId: session.user.id, role: "owner" },
      },
    },
    include: { members: true, _count: { select: { members: true } } },
  });

  return NextResponse.json({ org }, { status: 201 });
}
