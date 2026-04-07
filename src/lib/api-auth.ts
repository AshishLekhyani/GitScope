import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Returns the session for authenticated API routes.
 * Returns a 401 NextResponse if the request has no valid session.
 *
 * Usage:
 *   const authResult = await requireApiAuth();
 *   if (authResult instanceof NextResponse) return authResult;
 *   const { session } = authResult;
 */
export async function requireApiAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized. Please sign in to access this resource." },
      { status: 401 }
    );
  }
  return { session };
}
