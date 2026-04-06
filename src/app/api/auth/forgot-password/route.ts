import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, buildPasswordResetEmail, buildSetPasswordEmail } from "@/lib/email";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";
import { logAuth } from "@/lib/audit-log";
import crypto from "crypto";

async function postHandler(req: NextRequest) {
  const genericSuccess = NextResponse.json({
    ok: true,
    message: "If an account exists for that email, a password reset link has been sent.",
  });

  // 3 reset requests per email per 15 min
  const { allowed } = await checkRateLimit(getRateLimitKey(req, "forgot-password"), {
    limit: 3,
    windowMs: 15 * 60 * 1000,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, password: true, emailVerified: true },
  });

  // User doesn't exist - return generic success (don't reveal account existence)
  if (!user) {
    return genericSuccess;
  }

  try {
    // Check if user has OAuth accounts (Google/GitHub)
    const oauthAccounts = await prisma.account.findMany({
      where: { userId: user.id, provider: { in: ["google", "github"] } },
      select: { provider: true },
    });
    const hasOAuth = oauthAccounts.length > 0;

    // Determine token type:
    // - "reset" if user has a password
    // - "set" if user has OAuth but no password
    const tokenType = user.password ? "reset" : hasOAuth ? "set" : null;

    // If user has no password AND no OAuth, they can't reset password
    // (they need to sign up or use OAuth)
    if (!tokenType) {
      return genericSuccess;
    }

    // Delete any existing token for this email
    await prisma.verificationToken.deleteMany({ 
      where: { identifier: { in: [`reset:${email}`, `set:${email}`] } } 
    });

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.verificationToken.create({
      data: { identifier: `${tokenType}:${email}`, token, expires },
    });

    // Send appropriate email based on token type
    const emailBuilder = tokenType === "reset" ? buildPasswordResetEmail : buildSetPasswordEmail;
    const { subject, html } = emailBuilder(user.name ?? "", token);
    await sendEmail({ to: email, subject, html });
  } catch (error) {
    // Log error only in development
    if (process.env.NODE_ENV !== "production") {
      console.error("FORGOT_PASSWORD_ERROR", error);
    }
  }

  return genericSuccess;
}

// Apply security middleware with auth preset (strict rate limiting + audit logging)
export const POST = withRouteSecurity(postHandler, SecurityPresets.auth);
