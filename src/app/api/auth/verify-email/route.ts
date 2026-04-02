import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const origin = req.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(new URL("/verify-email?error=missing_token", origin));
  }

  const pending = await prisma.pendingSignup.findUnique({ where: { token } });

  if (!pending) {
    return NextResponse.redirect(new URL("/verify-email?error=invalid_token", origin));
  }

  if (pending.expires < new Date()) {
    await prisma.pendingSignup.delete({ where: { token } }).catch(() => {});
    return NextResponse.redirect(new URL("/verify-email?error=expired_token", origin));
  }

  const existing = await prisma.user.findUnique({ where: { email: pending.email } });
  if (existing) {
    await prisma.pendingSignup.delete({ where: { token } }).catch(() => {});
    return NextResponse.redirect(new URL("/verify-email?error=already_exists", origin));
  }

  // Create the real verified user
  await prisma.user.create({
    data: {
      email: pending.email,
      name: pending.name,
      password: pending.hashedPassword,
      emailVerified: new Date(),
    },
  });

  await prisma.pendingSignup.delete({ where: { token } });

  // Create two one-time autologin tokens:
  // - "at" in the redirect URL for the clicking tab (5 min)
  // - "autologin-wait:" in DB for any polling waiting tabs (10 min)
  const autologinToken = crypto.randomBytes(32).toString("hex");
  const waitToken = crypto.randomBytes(32).toString("hex");

  await prisma.verificationToken.createMany({
    data: [
      {
        identifier: `autologin:${pending.email}`,
        token: autologinToken,
        expires: new Date(Date.now() + 5 * 60 * 1000),
      },
      {
        identifier: `autologin-wait:${pending.email}`,
        token: waitToken,
        expires: new Date(Date.now() + 10 * 60 * 1000),
      },
    ],
  });

  const url = new URL("/verify-email", origin);
  url.searchParams.set("success", "1");
  url.searchParams.set("at", autologinToken);
  url.searchParams.set("email", pending.email);
  return NextResponse.redirect(url);
}
