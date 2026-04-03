/**
 * Security Middleware
 * 
 * Combines all security features into reusable middleware wrappers:
 * - CSRF protection for state-changing operations
 * - IP-based rate limiting with reputation tracking
 * - Request signing for sensitive APIs
 * - Audit logging for security events
 */

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  validateCsrfForRequest,
  getCsrfCookieOptions,
  CSRF_COOKIE_NAME,
} from "./csrf";
import {
  checkIpRateLimit,
  RateLimitPresets,
  getRateLimitHeaders,
  getClientIp,
} from "./rate-limit-ip";
import { validateSignedRequest } from "./request-signing";
import { logCsrfViolation, logRateLimit, logAuth } from "./audit-log";

export interface SecurityMiddlewareOptions {
  /** Require CSRF token for state-changing methods */
  csrf?: boolean;
  /** Rate limit configuration */
  rateLimit?: keyof typeof RateLimitPresets | false;
  /** Require request signature for sensitive endpoints */
  requireSignature?: boolean;
  /** Log authentication events */
  auditAuth?: boolean;
  /** Skip security checks for OPTIONS requests */
  skipOptions?: boolean;
}

const defaultOptions: SecurityMiddlewareOptions = {
  csrf: true,
  rateLimit: "standard",
  requireSignature: false,
  auditAuth: true,
  skipOptions: true,
};

/**
 * Main security middleware wrapper for API routes
 * Applies CSRF, rate limiting, and request signing based on options
 */
export function withSecurity(
  handler: (req: NextRequest) => Promise<Response> | Response,
  options: SecurityMiddlewareOptions = {}
) {
  const opts = { ...defaultOptions, ...options };

  return async (req: NextRequest): Promise<Response> => {
    // Skip OPTIONS requests (CORS preflight)
    if (opts.skipOptions && req.method === "OPTIONS") {
      return handler(req);
    }

    const cookieHeader = req.headers.get("cookie");

    // 1. CSRF Validation for state-changing methods
    if (opts.csrf) {
      const csrfResult = await validateCsrfForRequest(req, cookieHeader);
      if (!csrfResult.valid) {
        await logCsrfViolation(req, {
          type: csrfResult.error?.includes("missing")
            ? "missing"
            : csrfResult.error?.includes("Invalid")
            ? "invalid"
            : "validation_failed",
          reason: csrfResult.error,
        });

        return NextResponse.json(
          { error: csrfResult.error || "CSRF validation failed" },
          { status: 403 }
        );
      }
    }

    // 2. IP-based Rate Limiting
    if (opts.rateLimit) {
      const rateLimitConfig = RateLimitPresets[opts.rateLimit];
      const rateLimitResult = checkIpRateLimit(
        req,
        `api:${opts.rateLimit}`,
        rateLimitConfig
      );

      const headers = getRateLimitHeaders(rateLimitResult);

      if (!rateLimitResult.allowed) {
        // Get user info for audit log
        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
        
        await logRateLimit(req, {
          userId: token?.sub,
          endpoint: req.nextUrl.pathname,
          limit: rateLimitConfig.limit,
          blocked: rateLimitResult.blocked || false,
        });

        return NextResponse.json(
          {
            error: rateLimitResult.blocked
              ? "IP temporarily blocked due to excessive requests"
              : "Rate limit exceeded",
            retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
          },
          {
            status: rateLimitResult.blocked ? 403 : 429,
            headers,
          }
        );
      }

      // Add rate limit headers to successful responses
      const originalHandler = await handler(req);
      const response = new NextResponse(originalHandler.body, {
        status: originalHandler.status,
        statusText: originalHandler.statusText,
        headers: originalHandler.headers,
      });
      
      Object.entries(headers).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      
      return response;
    }

    // 3. Request Signature Validation for sensitive endpoints
    if (opts.requireSignature) {
      const signatureResult = await validateSignedRequest(req);
      if (!signatureResult.valid) {
        return NextResponse.json(
          { error: signatureResult.error || "Invalid request signature" },
          { status: 401 }
        );
      }
    }

    return handler(req);
  };
}

/**
 * Middleware for Next.js edge runtime
 * Can be used in middleware.ts for route-level protection
 */
export async function securityMiddleware(
  req: NextRequest,
  options: SecurityMiddlewareOptions = {}
): Promise<NextResponse | null> {
  const opts = { ...defaultOptions, ...options };
  const pathname = req.nextUrl.pathname;

  // Skip OPTIONS
  if (opts.skipOptions && req.method === "OPTIONS") {
    return null; // Continue to next middleware/handler
  }

  const cookieHeader = req.headers.get("cookie");

  // CSRF check for API routes with state-changing methods
  if (opts.csrf && pathname.startsWith("/api/")) {
    const csrfResult = await validateCsrfForRequest(req, cookieHeader);
    if (!csrfResult.valid) {
      await logCsrfViolation(req, {
        type: "validation_failed",
        reason: csrfResult.error,
      });
      
      return NextResponse.json(
        { error: csrfResult.error || "CSRF validation failed" },
        { status: 403 }
      );
    }
  }

  // Rate limiting
  if (opts.rateLimit) {
    const rateLimitConfig = RateLimitPresets[opts.rateLimit];
    const rateLimitResult = checkIpRateLimit(
      req,
      `edge:${pathname}`,
      rateLimitConfig
    );

    if (!rateLimitResult.allowed) {
      const headers = getRateLimitHeaders(rateLimitResult);
      
      return NextResponse.json(
        {
          error: rateLimitResult.blocked
            ? "IP temporarily blocked"
            : "Rate limit exceeded",
        },
        {
          status: rateLimitResult.blocked ? 403 : 429,
          headers,
        }
      );
    }
  }

  return null; // Continue to next middleware/handler
}

/**
 * Helper to set CSRF cookie on responses
 */
export function setCsrfCookie(response: NextResponse): NextResponse {
  const cookie = getCsrfCookieOptions();
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

/**
 * Refresh CSRF token endpoint handler
 * Call this to get a fresh CSRF token
 */
export async function handleCsrfToken(req: NextRequest): Promise<NextResponse> {
  const response = NextResponse.json({ success: true });
  return setCsrfCookie(response);
}

/**
 * Audit logging wrapper for authentication routes
 */
export function withAudit(
  handler: (req: NextRequest) => Promise<Response> | Response,
  eventType: Parameters<typeof logAuth>[0]
) {
  return async (req: NextRequest): Promise<Response> => {
    const startTime = Date.now();
    let success = false;
    let error: string | undefined;

    try {
      const response = await handler(req);
      success = response.status >= 200 && response.status < 400;
      
      // Get user info from response or token
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
      
      if (success) {
        await logAuth(eventType, req, {
          userId: token?.sub,
          email: token?.email as string | undefined,
        });
      }
      
      return response;
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : "Unknown error";
      
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
      
      await logAuth(
        eventType === "login_success" ? "login_failure" : eventType,
        req,
        {
          userId: token?.sub,
          email: token?.email as string | undefined,
          reason: error,
        }
      );
      
      throw err;
    }
  };
}

/**
 * Higher-order function for applying security to route handlers
 * Usage:
 * export const POST = withRouteSecurity(async (req) => { ... }, { rateLimit: 'auth' })
 */
export function withRouteSecurity(
  handler: (req: NextRequest) => Promise<Response> | Response,
  options: SecurityMiddlewareOptions = {}
) {
  return withSecurity(handler, options);
}

/**
 * Convenience presets for common route types
 */
export const SecurityPresets = {
  /** Public read endpoints - minimal security */
  public: {
    csrf: false,
    rateLimit: "relaxed" as const,
    requireSignature: false,
  },
  
  /** Standard API endpoints */
  standard: {
    csrf: true,
    rateLimit: "standard" as const,
    requireSignature: false,
  },
  
  /** Authentication endpoints - strict rate limiting */
  auth: {
    csrf: true,
    rateLimit: "auth" as const,
    requireSignature: false,
    auditAuth: true,
  },
  
  /** Sensitive operations - all protections */
  sensitive: {
    csrf: true,
    rateLimit: "sensitive" as const,
    requireSignature: true,
    auditAuth: true,
  },
  
  /** AI endpoints - expensive operations */
  ai: {
    csrf: true,
    rateLimit: "ai" as const,
    requireSignature: false,
  },
  
  /** Webhook endpoints - signature required, no CSRF */
  webhook: {
    csrf: false,
    rateLimit: "standard" as const,
    requireSignature: true,
  },
};
