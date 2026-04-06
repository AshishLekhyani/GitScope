/**
 * Rate limiter for API routes.
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set
 * (production-safe, survives serverless cold starts and concurrent instances).
 * Falls back to an in-memory Map when those env vars are absent (dev / hobby).
 */

import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

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

// ── Upstash singleton (lazy) ──────────────────────────────────────────────────

let _redis: Redis | null = null;
const _limiters = new Map<string, Ratelimit>();

function upstashEnabled(): boolean {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

function getUpstashLimiter(limit: number, windowMs: number): Ratelimit | null {
  if (!upstashEnabled()) return null;

  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }

  const cacheKey = `${limit}:${windowMs}`;
  if (!_limiters.has(cacheKey)) {
    _limiters.set(
      cacheKey,
      new Ratelimit({
        redis: _redis,
        limiter: Ratelimit.fixedWindow(limit, `${Math.round(windowMs / 1000)} s`),
      })
    );
  }
  return _limiters.get(cacheKey)!;
}

// ── In-memory fallback ────────────────────────────────────────────────────────

function checkRateLimitMemory(
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
  return { allowed: entry.count <= limit, remaining, resetAt: entry.resetAt };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const limiter = getUpstashLimiter(options.limit, options.windowMs);

  if (limiter) {
    try {
      const { success, remaining, reset } = await limiter.limit(key);
      return { allowed: success, remaining, resetAt: reset };
    } catch (err) {
      console.error("[RateLimit] Upstash error, falling back to in-memory:", err);
    }
  }

  return checkRateLimitMemory(key, options);
}

/** Extract a usable key from a Request — IP or fallback */
export function getRateLimitKey(req: Request, prefix: string): string {
  const forwarded = (req.headers as Headers).get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  return `${prefix}:${ip}`;
}
