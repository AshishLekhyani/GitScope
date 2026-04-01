import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Initiates an OAuth provider connection for an already-signed-in user.
 * The user clicks "Connect GitHub/Google" in settings → we redirect them to
 * NextAuth's sign-in flow with their current session preserved via state.
 *
 * On return, NextAuth's `signIn` callback (if provider account matches an
 * existing user email) automatically links the account in the DB via the adapter.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider");

  if (!["github", "google"].includes(provider ?? "")) {
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
