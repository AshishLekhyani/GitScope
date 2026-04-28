/**
 * POST /api/user/byok-preference
 * Toggle whether the user prefers GitScope's managed keys over their own BYOK keys.
 * Body: { preferPlatform: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { preferPlatform?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.preferPlatform !== "boolean") {
    return NextResponse.json({ error: "preferPlatform must be a boolean" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { byokPreferPlatform: body.preferPlatform },
  });

  return NextResponse.json({ ok: true, preferPlatform: body.preferPlatform });
}
