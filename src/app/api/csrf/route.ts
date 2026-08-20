import { NextResponse } from "next/server";
import { generateCsrfToken, getCsrfCookieOptions } from "@/lib/csrf";

/**
 * GET /api/csrf
 * Returns a fresh CSRF token for client-side requests
 * NOTE: This is separate from /api/auth/csrf to avoid conflicts with NextAuth
 */
export async function GET() {
  // The cookie must carry the hash of *this* token — generating a second pair
  // for the cookie would hand the client a token that can never validate.
  const { token, hashedToken } = generateCsrfToken();
  const cookie = getCsrfCookieOptions(hashedToken);

  const response = NextResponse.json({ csrfToken: token });

  // Set the cookie with the hashed token
  response.cookies.set(cookie.name, cookie.value, cookie.options);

  return response;
}
