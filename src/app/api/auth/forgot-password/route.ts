import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, buildPasswordResetEmail } from "@/lib/email";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  // 3 reset requests per email per 15 min
  const { allowed } = checkRateLimit(getRateLimitKey(req, "forgot-password"), {
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

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, password: true } });

  // Always return success to prevent user enumeration
  if (!user || !user.password) {
    return NextResponse.json({ ok: true });
  }

  // Delete any existing reset token for this email
  await prisma.verificationToken.deleteMany({ where: { identifier: `reset:${email}` } });

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.verificationToken.create({
    data: { identifier: `reset:${email}`, token, expires },
  });

  const { subject, html } = buildPasswordResetEmail(user.name ?? "", token);
  await sendEmail({ to: email, subject, html });

  return NextResponse.json({ ok: true });
}
