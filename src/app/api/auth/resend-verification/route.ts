import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, buildVerificationEmail } from "@/lib/email";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import crypto from "crypto";

const VERIFY_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export async function POST(req: NextRequest) {
  const { allowed } = checkRateLimit(getRateLimitKey(req, "resend-verify"), {
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
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  // Always return ok to prevent enumeration
  const pending = await prisma.pendingSignup.findUnique({ where: { email } });
  if (!pending) {
    return NextResponse.json({ ok: true });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + VERIFY_EXPIRY_MS);

  await prisma.pendingSignup.update({
    where: { email },
    data: { token, expires },
  });

  const { subject, html } = buildVerificationEmail(pending.name, token);
  await sendEmail({ to: email, subject, html });

  return NextResponse.json({ ok: true });
}
