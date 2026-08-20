import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubFetch } from "./github";

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-ratelimit-remaining": "42" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("githubFetch — success path", () => {
  it("returns parsed data and the rate limit header", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { full_name: "o/r" })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { data, rateLimitRemaining } = await githubFetch<{ full_name: string }>("/repos/o/r");

    expect(data.full_name).toBe("o/r");
    expect(rateLimitRemaining).toBe("42");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats 202 as an empty result without retrying", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { data } = await githubFetch("/repos/o/r/stats/commit_activity");

    expect(data).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("githubFetch — client errors are not retried", () => {
  // Regression: the non-retryable error was thrown from inside the try block and
  // caught by the loop's own catch, which retried it anyway — so every 404 burned
  // the full 1s + 2s + 4s backoff before surfacing.
  it.each([404, 403, 401, 422])("issues exactly one request for a %i", async (status) => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(status, { message: "nope" })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(githubFetch("/repos/o/r")).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 404 promptly rather than after the backoff schedule", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(404)));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const startedAt = Date.now();
    await expect(githubFetch("/repos/o/missing")).rejects.toThrow(/not found/i);

    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("keeps the friendly message and body on the thrown error", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(403, { message: "rate limited" })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(githubFetch("/repos/o/r")).rejects.toMatchObject({
      status: 403,
      body: JSON.stringify({ message: "rate limited" }),
    });
  });
});

describe("githubFetch — server errors are still retried", () => {
  it("retries a 500 and succeeds when the retry works", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(500, { message: "boom" })))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { ok: true })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { data } = await githubFetch<{ ok: boolean }>("/repos/o/r", { retries: 1 });

    expect(data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("retries network failures", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new TypeError("network down")))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { ok: true })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { data } = await githubFetch<{ ok: boolean }>("/repos/o/r", { retries: 1 });

    expect(data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("gives up after exhausting retries on a persistent 500", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(500, { message: "boom" })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(githubFetch("/repos/o/r", { retries: 1 })).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);
});

describe("githubFetch — auth headers", () => {
  /** Installs a fetch mock that records the headers of the first call. */
  function captureHeaders(): () => Headers {
    let seen: HeadersInit | undefined;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      seen ??= init?.headers;
      return Promise.resolve(jsonResponse(200));
    }) as unknown as typeof fetch;
    return () => new Headers(seen);
  }

  it("sends the user token when supplied", async () => {
    const headers = captureHeaders();

    await githubFetch("/repos/o/r", { userToken: "gho_usertoken" });

    expect(headers().get("authorization")).toBe("Bearer gho_usertoken");
  });

  it("omits authorization when there is no token and env fallback is off", async () => {
    const headers = captureHeaders();

    await githubFetch("/repos/o/r", { userToken: null, allowEnvFallback: false });

    expect(headers().get("authorization")).toBeNull();
  });

  it("always sends the GitHub API version header", async () => {
    const headers = captureHeaders();

    await githubFetch("/repos/o/r", { userToken: null, allowEnvFallback: false });

    expect(headers().get("x-github-api-version")).toBe("2022-11-28");
  });
});
