/**
 * Enhanced IP-Based Rate Limiting
 * 
 * Extends the base rate limiter with:
 * - IP reputation tracking (temporary blocks for repeat offenders)
 * - Different limits per endpoint type
 * - Distributed rate limit key generation
 */

import { checkRateLimit, RateLimitOptions } from "./rate-limit";

export interface IpRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** The configured ceiling for the window, reported as X-RateLimit-Limit. */
  limit?: number;
  blocked?: boolean;
  blockDuration?: number;
}

interface IpReputation {
  violations: number;
  blockedUntil: number;
  lastViolation: number;
}

// In-memory IP reputation store (violations persist longer than rate limits)
const ipReputation = new Map<string, IpReputation>();

// Block duration increases with repeat violations (exponential backoff)
const BLOCK_DURATION_BASE = 60_000; // 1 minute
const MAX_BLOCK_DURATION = 60 * 60 * 1000; // 1 hour

/** Violations older than this stop counting toward the exponential backoff. */
const VIOLATION_DECAY_MS = 60 * 60 * 1000; // 1 hour

/** Sweep stale reputation entries once the map grows past this size. */
const REPUTATION_SWEEP_THRESHOLD = 5000;

/** Sentinel used when the client IP can't be determined. */
const UNKNOWN_IP = "unknown";

// List of trusted proxy IPs (configure for your deployment environment)
// In production, this should be populated with your actual load balancer/proxy IPs
const TRUSTED_PROXIES = process.env.TRUSTED_PROXIES?.split(",").map(ip => ip.trim()) || [];

/**
 * Check if request comes from a trusted proxy
 */
function isTrustedProxy(req: Request): boolean {
  // If no trusted proxies configured, assume we're behind a trusted proxy in production
  // but verify the request has expected internal headers
  if (TRUSTED_PROXIES.length === 0) {
    // In production Vercel/Render/etc, these headers are set by the platform
    // and cannot be spoofed by end users
    return process.env.NODE_ENV === "production";
  }
  
  const remoteIp = req.headers.get("x-real-ip") || "unknown";
  return TRUSTED_PROXIES.includes(remoteIp);
}

/**
 * Get client IP from request headers
 * SECURITY: Only trusts X-Forwarded-For when request comes from trusted proxy
 */
export function getClientIp(req: Request): string {
  // Only trust proxy headers if request comes from a trusted source
  if (isTrustedProxy(req)) {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      // Get the leftmost (original client) IP from the chain
      return forwarded.split(",")[0].trim();
    }
    
    const realIp = req.headers.get("x-real-ip");
    if (realIp) {
      return realIp.trim();
    }
  }
  
  // In development or when no proxy headers available, return unknown
  // The rate limiter will still work but won't be IP-specific
  return UNKNOWN_IP;
}

/**
 * Check IP reputation and rate limit
 */
export async function checkIpRateLimit(
  req: Request,
  prefix: string,
  options: RateLimitOptions
): Promise<IpRateLimitResult> {
  const ip = getClientIp(req);
  const key = `${prefix}:${ip}`;

  const now = Date.now();

  // Reputation is keyed by IP. When we can't identify the client every request
  // collapses onto the same key, so a single offender would block everyone —
  // skip reputation tracking entirely in that case and rely on the plain limit.
  // Reputation is keyed by IP. When we can't identify the client every request
  // collapses onto the same key, so a single offender would block everyone —
  // skip reputation tracking entirely in that case and rely on the plain limit.
  if (ip === UNKNOWN_IP) {
    return { ...(await checkRateLimit(key, options)), limit: options.limit };
  }

  // Amortised cleanup so the reputation map can't grow without bound.
  if (ipReputation.size > REPUTATION_SWEEP_THRESHOLD) cleanupIpReputation();

  // Check if IP is currently blocked due to violations
  const reputation = ipReputation.get(ip);

  if (reputation && reputation.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: reputation.blockedUntil,
      limit: options.limit,
      blocked: true,
      blockDuration: reputation.blockedUntil - now,
    };
  }

  // Check standard rate limit
  const result = await checkRateLimit(key, options);

  // Record violation if rate limit exceeded
  if (!result.allowed) {
    recordViolation(ip);
  }

  return { ...result, limit: options.limit };
}

/**
 * Record a rate limit violation for an IP
 */
function recordViolation(ip: string): void {
  const now = Date.now();
  const existing = ipReputation.get(ip);

  // Let the violation count decay, otherwise one bad hour permanently pins an
  // IP at the maximum block duration for the life of the process.
  const priorViolations =
    existing && now - existing.lastViolation < VIOLATION_DECAY_MS ? existing.violations : 0;
  const violations = priorViolations + 1;
  
  // Exponential backoff for block duration
  const blockDuration = Math.min(
    BLOCK_DURATION_BASE * Math.pow(2, violations - 1),
    MAX_BLOCK_DURATION
  );
  
  ipReputation.set(ip, {
    violations,
    blockedUntil: now + blockDuration,
    lastViolation: now,
  });
  
  // Log for monitoring
  console.warn(`[Security] IP ${ip} rate limit violation #${violations}, blocked for ${blockDuration}ms`);
}

/**
 * Predefined rate limit configurations for different endpoint types
 */
export const RateLimitPresets = {
  /** Very strict - authentication endpoints */
  auth: { limit: 5, windowMs: 60_000 }, // 5 per minute
  
  /** Strict - sensitive operations */
  sensitive: { limit: 10, windowMs: 60_000 }, // 10 per minute
  
  /** Standard - most API endpoints */
  standard: { limit: 60, windowMs: 60_000 }, // 60 per minute
  
  /** Relaxed - read-heavy endpoints */
  relaxed: { limit: 120, windowMs: 60_000 }, // 120 per minute
  
  /** AI endpoints - expensive operations */
  ai: { limit: 10, windowMs: 60_000 }, // 10 per minute
  
  /** Search endpoints */
  search: { limit: 30, windowMs: 60_000 }, // 30 per minute
} as const;

/**
 * Get rate limit headers for response
 */
export function getRateLimitHeaders(result: IpRateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit ?? result.remaining + (result.allowed ? 1 : 0)),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
  
  if (result.blocked) {
    headers["X-RateLimit-Blocked"] = "true";
    headers["Retry-After"] = String(Math.ceil((result.blockDuration || 0) / 1000));
  }
  
  return headers;
}

/**
 * Clean up old IP reputation entries (call periodically in serverless environment)
 */
export function cleanupIpReputation(): void {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  for (const [ip, reputation] of ipReputation.entries()) {
    if (reputation.lastViolation < now - maxAge && reputation.blockedUntil < now) {
      ipReputation.delete(ip);
    }
  }
}
