import { NextResponse } from "next/server";
import { generateCsrfToken, getCsrfCookieOptions } from "@/lib/csrf";

/**
 * GET /api/csrf
 * Returns a fresh CSRF token for client-side requests
 * NOTE: This is separate from /api/auth/csrf to avoid conflicts with NextAuth
 */
export async function GET() {
  const { token } = generateCsrfToken();
  const cookie = getCsrfCookieOptions();

  const response = NextResponse.json({ csrfToken: token });

  // Set the cookie with the hashed token
  response.cookies.set(cookie.name, cookie.value, cookie.options);

  return response;
}
