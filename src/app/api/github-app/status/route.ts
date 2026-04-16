/**
 * GET  /api/github-app/status   — get GitHub App connection status
 * POST /api/github-app/status   — save installationId manually (or clear it)
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isGitHubAppConfigured } from "@/lib/github-app";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { githubAppInstallId: true },
  });

  return NextResponse.json({
    appConfigured: isGitHubAppConfigured(),
    installed: !!(user?.githubAppInstallId),
    installationId: user?.githubAppInstallId ?? null,
    installUrl: process.env.GITHUB_APP_INSTALL_URL ?? null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { installationId?: string | null } = {};
  try { body = await req.json(); } catch { /* empty body = clear */ }

  const installationId = body.installationId ?? null;

  // Basic validation — GitHub App installation IDs are positive integers
  if (installationId !== null && !/^\d+$/.test(installationId)) {
    return NextResponse.json({ error: "Invalid installation ID" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { githubAppInstallId: installationId },
  });

  return NextResponse.json({ ok: true, installed: installationId !== null });
}
