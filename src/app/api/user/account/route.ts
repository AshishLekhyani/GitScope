import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { encryptGitHubToken } from "@/lib/github-token-crypto";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

function validatePasswordComplexity(pass: string): string | null {
  if (pass.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pass)) return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(pass)) return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(pass)) return "Password must contain at least one number.";
  if (!/[^A-Za-z0-9]/.test(pass)) return "Password must contain at least one special character.";
  return null;
}

async function getHandler() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user details
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true, email: true },
  });

  // Get all connected OAuth accounts
  const accounts = await prisma.account.findMany({
    where: { userId: session.user.id },
    select: { provider: true },
  });

  const connectedProviders = accounts.map((a: { provider: string }) => a.provider);
  const hasPassword = !!user?.password;

  return NextResponse.json({
    connectedProviders,
    hasPassword,
    email: user?.email,
  });
}

async function patchHandler(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { newPassword?: string; currentPassword?: string; githubApiKey?: string | null; slackWebhookUrl?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Update Slack webhook URL
  if ("slackWebhookUrl" in body) {
    const url = body.slackWebhookUrl?.trim() || null;
    if (url && !url.startsWith("https://hooks.slack.com/")) {
      return NextResponse.json({ error: "Invalid Slack webhook URL." }, { status: 400 });
    }
    await prisma.user.update({
      where: { id: session.user.id },
      data: { slackWebhookUrl: url },
    });
    return NextResponse.json({ success: true });
  }

  // Update GitHub API key
  if ("githubApiKey" in body) {
    const key = body.githubApiKey?.trim() || null;

    // Basic format check: GitHub PATs start with ghp_, gho_, ghs_, ghu_, github_pat_, or classic 40-char hex
    if (key && !/^(ghp_|gho_|ghs_|ghu_|github_pat_|[0-9a-f]{40})/i.test(key)) {
      return NextResponse.json({ error: "That doesn't look like a valid GitHub token." }, { status: 400 });
    }

    const encrypted = key ? encryptGitHubToken(key) : null;
    if (key && !encrypted) {
      return NextResponse.json(
        {
          error:
            "Token encryption is not configured. Set GITHUB_PAT_ENCRYPTION_KEY (base64 32 bytes) in environment variables.",
        },
        { status: 503 }
      );
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { githubApiKey: encrypted },
    });

    return NextResponse.json({ success: true });
  }

  // Update password
  const { newPassword, currentPassword } = body;

  if (!newPassword) {
    return NextResponse.json({ error: "New password is required." }, { status: 400 });
  }

  const complexityError = validatePasswordComplexity(newPassword);
  if (complexityError) {
    return NextResponse.json({ error: complexityError }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (user.password) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required." }, { status: 400 });
    }
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }
  }

  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: session.user.id }, data: { password: hashed } });

  return NextResponse.json({ success: true });
}

async function deleteHandler() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.user.delete({ where: { id: session.user.id } });
  return NextResponse.json({ success: true });
}

// Apply security middleware
// PATCH/DELETE: CSRF + strict rate limiting, but no request-signature requirement
// (signature is for service-to-service; browser clients can't hold the server secret)
export const GET = withRouteSecurity(getHandler, { ...SecurityPresets.public, csrf: false });
export const PATCH = withRouteSecurity(patchHandler, { csrf: true, rateLimit: "sensitive", requireSignature: false, auditAuth: true });
export const DELETE = withRouteSecurity(deleteHandler, { csrf: true, rateLimit: "sensitive", requireSignature: false, auditAuth: true });
