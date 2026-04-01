/**
 * Simple in-memory rate limiter for API routes.
 * Resets per-key counters after the window expires.
 * Uses IP address as key — suitable for serverless since each instance
 * has independent memory, but still throttles single-IP bursts within a pod.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export interface RateLimitOptions {
  /** Max requests allowed in the window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);
  const allowed = entry.count <= limit;
  return { allowed, remaining, resetAt: entry.resetAt };
}

/** Extract a usable key from a Request — IP or fallback */
export function getRateLimitKey(req: Request, prefix: string): string {
  // Next.js forwards the real IP via these headers
  const forwarded = (req.headers as Headers).get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  return `${prefix}:${ip}`;
}
