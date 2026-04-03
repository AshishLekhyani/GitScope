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

/**
 * Get client IP from request headers
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  
  // Fallback - less reliable
  return "unknown";
}

/**
 * Check IP reputation and rate limit
 */
export function checkIpRateLimit(
  req: Request,
  prefix: string,
  options: RateLimitOptions
): IpRateLimitResult {
  const ip = getClientIp(req);
  const key = `${prefix}:${ip}`;
  
  // Check if IP is currently blocked due to violations
  const reputation = ipReputation.get(ip);
  const now = Date.now();
  
  if (reputation && reputation.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: reputation.blockedUntil,
      blocked: true,
      blockDuration: reputation.blockedUntil - now,
    };
  }
  
  // Check standard rate limit
  const result = checkRateLimit(key, options);
  
  // Record violation if rate limit exceeded
  if (!result.allowed) {
    recordViolation(ip);
  }
  
  return result;
}

/**
 * Record a rate limit violation for an IP
 */
function recordViolation(ip: string): void {
  const now = Date.now();
  const existing = ipReputation.get(ip);
  
  const violations = (existing?.violations || 0) + 1;
  
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
    "X-RateLimit-Limit": String(result.remaining + (result.allowed ? 1 : 0)),
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
    if (reputation.lastViolation < now - maxAge) {
      ipReputation.delete(ip);
    }
  }
}
