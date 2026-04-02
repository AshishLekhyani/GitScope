import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { sendEmail, buildVerificationEmail } from "@/lib/email";
import crypto from "crypto";

const VERIFY_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export async function POST(request: Request) {
  const { allowed } = checkRateLimit(getRateLimitKey(request, "register"), {
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!allowed) {
    return new NextResponse("Too many registration attempts. Try again later.", { status: 429 });
  }

  try {
    const body = await request.json();
    const { email, name, password } = body;

    if (!email || !name || !password) {
      return new NextResponse("Missing information", { status: 400 });
    }

    const validateEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    const validatePassword = (pass: string) =>
      pass.length >= 8 &&
      /[A-Z]/.test(pass) &&
      /[a-z]/.test(pass) &&
      /[0-9]/.test(pass) &&
      /[^A-Za-z0-9]/.test(pass);

    if (!validateEmail(email)) return new NextResponse("Invalid email format.", { status: 400 });
    if (!validatePassword(password)) return new NextResponse("Password does not meet security requirements.", { status: 400 });

    const normalizedEmail = email.trim().toLowerCase();

    // Block if a verified user already exists with this email
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { emailVerified: true },
    });
    if (existingUser) {
      return new NextResponse("Email already exists", { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + VERIFY_EXPIRY_MS);

    // Upsert pending signup — replaces any previous unverified attempt for this email
    await prisma.pendingSignup.upsert({
      where: { email: normalizedEmail },
      update: { name, hashedPassword, token, expires },
      create: { email: normalizedEmail, name, hashedPassword, token, expires },
    });

    const { subject, html } = buildVerificationEmail(name, token);
    await sendEmail({ to: normalizedEmail, subject, html });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("REGISTRATION_ERROR", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
