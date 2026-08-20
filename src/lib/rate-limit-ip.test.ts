import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// TRUSTED_PROXIES is read at module load, so it must be set before the import.
process.env.TRUSTED_PROXIES = "10.0.0.1";

type RateLimitIpModule = typeof import("./rate-limit-ip");
let mod: RateLimitIpModule;

beforeAll(async () => {
  mod = await import("./rate-limit-ip");
});

afterAll(() => {
  vi.useRealTimers();
});

/** A request that getClientIp() can attribute to a specific client. */
function reqFrom(ip: string): Request {
  return new Request("https://gitscope.test/api/thing", {
    headers: { "x-real-ip": "10.0.0.1", "x-forwarded-for": ip },
  });
}

/** A request with no usable client identity. */
function reqAnonymous(): Request {
  return new Request("https://gitscope.test/api/thing");
}

describe("getClientIp", () => {
  it("takes the leftmost forwarded IP when the proxy is trusted", () => {
    const req = new Request("https://gitscope.test/", {
      headers: { "x-real-ip": "10.0.0.1", "x-forwarded-for": "203.0.113.5, 70.41.3.18" },
    });
    expect(mod.getClientIp(req)).toBe("203.0.113.5");
  });

  it("ignores forwarded headers from an untrusted proxy", () => {
    const req = new Request("https://gitscope.test/", {
      headers: { "x-real-ip": "192.0.2.99", "x-forwarded-for": "203.0.113.5" },
    });
    expect(mod.getClientIp(req)).toBe("unknown");
  });

  it("returns unknown when there are no proxy headers", () => {
    expect(mod.getClientIp(reqAnonymous())).toBe("unknown");
  });
});

describe("per-IP limiting", () => {
  const options = { limit: 3, windowMs: 60_000 };

  it("allows up to the limit then denies", async () => {
    const ip = "203.0.113.10";
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await mod.checkIpRateLimit(reqFrom(ip), "test:basic", options));
    }
    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
    expect(results[3].allowed).toBe(false);
  });

  it("keeps separate buckets per IP", async () => {
    const a = await mod.checkIpRateLimit(reqFrom("203.0.113.11"), "test:isolated", options);
    const b = await mod.checkIpRateLimit(reqFrom("203.0.113.12"), "test:isolated", options);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  it("reports the configured ceiling as the limit", async () => {
    // Regression: X-RateLimit-Limit was derived from `remaining`, not the config.
    const result = await mod.checkIpRateLimit(reqFrom("203.0.113.13"), "test:hdr", options);
    expect(result.limit).toBe(3);
    expect(mod.getRateLimitHeaders(result)["X-RateLimit-Limit"]).toBe("3");
  });

  it("blocks a repeat offender via reputation", async () => {
    const ip = "203.0.113.14";
    for (let i = 0; i < 5; i++) {
      await mod.checkIpRateLimit(reqFrom(ip), "test:rep", options);
    }
    const result = await mod.checkIpRateLimit(reqFrom(ip), "test:rep", options);
    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);
  });
});

describe("unidentified clients share a bucket and must not block each other", () => {
  it("never marks an unknown-IP client as reputation-blocked", async () => {
    // Regression: every unattributable request collapses onto the key "unknown",
    // so recording a reputation violation there blocked *all* such clients at once
    // — up to an hour of exponential backoff triggered by a single offender.
    const options = { limit: 2, windowMs: 60_000 };

    for (let i = 0; i < 25; i++) {
      await mod.checkIpRateLimit(reqAnonymous(), "test:anon", options);
    }

    const result = await mod.checkIpRateLimit(reqAnonymous(), "test:anon", options);
    expect(result.blocked).toBeFalsy();
  });

  it("still applies the plain rate limit to unknown clients", async () => {
    const options = { limit: 2, windowMs: 60_000 };
    const first = await mod.checkIpRateLimit(reqAnonymous(), "test:anon2", options);
    await mod.checkIpRateLimit(reqAnonymous(), "test:anon2", options);
    const third = await mod.checkIpRateLimit(reqAnonymous(), "test:anon2", options);

    expect(first.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.limit).toBe(2);
  });
});

describe("violation decay", () => {
  it("escalates on repeat offences but forgets violations after a quiet period", async () => {
    // Regression: `violations` only ever incremented, so after ~12 trips an IP was
    // blocked for the full hour on every subsequent violation, for process lifetime.
    // Escalation only advances once a block expires and the IP re-offends, so the
    // clock has to be moved past each block.
    const ip = "203.0.113.20";
    const options = { limit: 1, windowMs: 1_000 };
    const check = () => mod.checkIpRateLimit(reqFrom(ip), "test:decay", options);

    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-01-01T00:00:00Z").getTime();
      vi.setSystemTime(t0);

      await check();
      const firstBlock = await check();
      expect(firstBlock.blocked).toBeFalsy(); // the trip itself, not yet reputation-blocked
      const firstDuration = (await check()).blockDuration ?? 0;
      expect(firstDuration).toBeGreaterThan(0);

      // Let the block lapse, then re-offend inside the decay window.
      vi.setSystemTime(t0 + 2 * 60_000);
      await check();
      await check();
      const escalated = await check();
      expect(escalated.blocked).toBe(true);
      const escalatedDuration = escalated.blockDuration ?? 0;
      expect(escalatedDuration).toBeGreaterThan(firstDuration);

      // Now stay quiet for longer than the decay window and re-offend.
      vi.setSystemTime(t0 + 2 * 60_000 + 90 * 60_000);
      const afterQuietPeriod = await check();
      expect(afterQuietPeriod.allowed).toBe(true);
      expect(afterQuietPeriod.blocked).toBeFalsy();

      await check();
      const reblocked = await check();
      expect(reblocked.blocked).toBe(true);
      expect(reblocked.blockDuration ?? 0).toBeLessThan(escalatedDuration);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getRateLimitHeaders", () => {
  it("includes Retry-After only when blocked", () => {
    const open = mod.getRateLimitHeaders({
      allowed: true,
      remaining: 5,
      resetAt: Date.now() + 1000,
      limit: 10,
    });
    expect(open["Retry-After"]).toBeUndefined();

    const blocked = mod.getRateLimitHeaders({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      limit: 10,
      blocked: true,
      blockDuration: 60_000,
    });
    expect(blocked["Retry-After"]).toBe("60");
    expect(blocked["X-RateLimit-Blocked"]).toBe("true");
  });
});
