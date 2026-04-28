import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Initiates a GitHub OAuth connection for an already-signed-in user.
 * After OAuth completes, NextAuth links the account to the existing user
 * if the email matches (via adapter logic).
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider");

  if (provider !== "github") {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  // Redirect to NextAuth's OAuth flow for the chosen provider.
  // After OAuth completes, NextAuth will link the account to the existing user
  // if the email matches (via allowDangerousEmailAccountLinking or adapter logic).
  const callbackUrl = encodeURIComponent(`${new URL(req.url).origin}/settings?tab=account&connected=${provider}`);
  return NextResponse.redirect(
    `${new URL(req.url).origin}/api/auth/signin/${provider}?callbackUrl=${callbackUrl}`
  );
}
