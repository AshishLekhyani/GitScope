/**
 * CSRF Protection Utilities
 * 
 * Implements Double Submit Cookie pattern with token-based validation
 * for state-changing operations (POST, PUT, PATCH, DELETE).
 */

import { randomBytes, createHmac } from "crypto";

const CSRF_SECRET = process.env.CSRF_SECRET || process.env.NEXTAUTH_SECRET;
if (!CSRF_SECRET) {
  throw new Error("CSRF_SECRET or NEXTAUTH_SECRET must be configured in environment variables");
}
const CSRF_TOKEN_LENGTH = 32;

export interface CsrfTokens {
  token: string;
  hashedToken: string;
}

/**
 * Generate a new CSRF token pair (public token + hashed version for cookie)
 */
export function generateCsrfToken(): CsrfTokens {
  const token = randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
  const hashedToken = hashToken(token);
  return { token, hashedToken };
}

/**
 * Hash a token using HMAC
 */
function hashToken(token: string): string {
  return createHmac("sha256", CSRF_SECRET as string).update(token).digest("hex");
}

/**
 * Validate a submitted CSRF token against the hashed version from cookie
 */
export function validateCsrfToken(token: string, hashedToken: string): boolean {
  if (!token || !hashedToken) return false;
  const expectedHash = hashToken(token);
  // Constant-time comparison to prevent timing attacks
  try {
    return timingSafeEqual(hashedToken, expectedHash);
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * CSRF cookie name
 */
export const CSRF_COOKIE_NAME = "__Host-csrf";

/**
 * Check if request method requires CSRF validation
 */
export function requiresCsrfValidation(method: string): boolean {
  const stateChangingMethods = ["POST", "PUT", "PATCH", "DELETE"];
  return stateChangingMethods.includes(method.toUpperCase());
}

/**
 * Extract CSRF token from request headers (X-CSRF-Token) or body
 */
export function extractCsrfToken(req: Request): string | null {
  // Check header first
  const headerToken = req.headers.get("x-csrf-token");
  if (headerToken) return headerToken;
  
  // Could also check form data or body if needed
  return null;
}

/**
 * Middleware-style CSRF validation for API routes
 * Returns { valid: true } or { valid: false, error: string }
 */
export async function validateCsrfForRequest(
  req: Request,
  cookieHeader: string | null
): Promise<{ valid: boolean; error?: string }> {
  if (!requiresCsrfValidation(req.method)) {
    return { valid: true };
  }

  // Skip CSRF for same-origin requests with proper Origin/Referer check
  // or if explicitly disabled (e.g., for API key auth)
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  
  // Allow if request is from same origin (Origin header matches host)
  if (origin && host && new URL(origin).host === host) {
    return { valid: true };
  }

  // Otherwise require CSRF token
  const submittedToken = extractCsrfToken(req);
  if (!submittedToken) {
    return { valid: false, error: "CSRF token missing" };
  }

  // Get hashed token from cookie
  const cookies = parseCookies(cookieHeader);
  const hashedToken = cookies[CSRF_COOKIE_NAME];
  if (!hashedToken) {
    return { valid: false, error: "CSRF cookie missing" };
  }

  if (!validateCsrfToken(submittedToken, hashedToken)) {
    return { valid: false, error: "Invalid CSRF token" };
  }

  return { valid: true };
}

/**
 * Parse cookie header into object
 */
function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(";");
  
  for (const pair of pairs) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) {
      cookies[name] = rest.join("=");
    }
  }
  
  return cookies;
}

/**
 * Generate CSRF cookie settings
 */
export function getCsrfCookieOptions(maxAge = 3600): {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "strict" | "lax" | "none";
    maxAge: number;
    path: string;
  };
} {
  const { hashedToken } = generateCsrfToken();
  
  return {
    name: CSRF_COOKIE_NAME,
    value: hashedToken,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge,
      path: "/",
    },
  };
}
