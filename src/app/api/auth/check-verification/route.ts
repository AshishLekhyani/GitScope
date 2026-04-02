import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Polled by the waiting tab (/verify-email page) every few seconds.
 * Returns { verified: true, at: token } once the user has clicked their email link.
 * The "at" token is a one-time autologin token for the waiting tab — claimed atomically.
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ verified: false });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { emailVerified: true },
  });

  if (!user?.emailVerified) {
    return NextResponse.json({ verified: false });
  }

  // Return the waiting-tab autologin token if it still exists.
  // Do NOT delete it here — the NextAuth token provider deletes it on sign-in.
  // This means multiple polling tabs all receive the same token; whichever calls
  // signIn first consumes it and the rest fall back gracefully to the login page.
  const waitRecord = await prisma.verificationToken.findFirst({
    where: {
      identifier: `autologin-wait:${email}`,
      expires: { gt: new Date() },
    },
    select: { token: true },
  }).catch(() => null);

  return NextResponse.json({ verified: true, at: waitRecord?.token ?? null });
}
