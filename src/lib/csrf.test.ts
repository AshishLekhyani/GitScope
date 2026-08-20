import { beforeAll, describe, expect, it } from "vitest";

// csrf.ts throws at import time without a secret, so set one before importing.
process.env.CSRF_SECRET = "test-csrf-secret-value";

type CsrfModule = typeof import("./csrf");
let csrf: CsrfModule;

beforeAll(async () => {
  csrf = await import("./csrf");
});

describe("token pairing", () => {
  it("validates a token against the hash from the same pair", () => {
    const { token, hashedToken } = csrf.generateCsrfToken();
    expect(csrf.validateCsrfToken(token, hashedToken)).toBe(true);
  });

  it("rejects a token against a hash from a different pair", () => {
    // Regression: /api/csrf used to generate one pair for the response body and
    // a second, unrelated pair for the cookie, so validation could never succeed.
    const first = csrf.generateCsrfToken();
    const second = csrf.generateCsrfToken();
    expect(csrf.validateCsrfToken(first.token, second.hashedToken)).toBe(false);
  });

  it("builds the cookie from the hash it is given, not a fresh one", () => {
    const { token, hashedToken } = csrf.generateCsrfToken();
    const cookie = csrf.getCsrfCookieOptions(hashedToken);
    expect(cookie.value).toBe(hashedToken);
    expect(csrf.validateCsrfToken(token, cookie.value)).toBe(true);
  });

  it("issues a distinct token each time", () => {
    expect(csrf.generateCsrfToken().token).not.toBe(csrf.generateCsrfToken().token);
  });

  it("rejects empty inputs", () => {
    const { token, hashedToken } = csrf.generateCsrfToken();
    expect(csrf.validateCsrfToken("", hashedToken)).toBe(false);
    expect(csrf.validateCsrfToken(token, "")).toBe(false);
  });
});

describe("cookie options", () => {
  it("is httpOnly, strict, and scoped to /", () => {
    const { hashedToken } = csrf.generateCsrfToken();
    const cookie = csrf.getCsrfCookieOptions(hashedToken);
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("strict");
    expect(cookie.options.path).toBe("/");
  });

  it("only uses the __Host- prefix when the cookie is also Secure", () => {
    // A __Host- cookie without Secure is dropped by the browser outright.
    const { hashedToken } = csrf.generateCsrfToken();
    const cookie = csrf.getCsrfCookieOptions(hashedToken);
    if (cookie.name.startsWith("__Host-")) {
      expect(cookie.options.secure).toBe(true);
    }
  });
});

function post(headers: Record<string, string>): Request {
  return new Request("https://gitscope.test/api/thing", { method: "POST", headers });
}

describe("validateCsrfForRequest", () => {
  it("skips validation for safe methods", async () => {
    const req = new Request("https://gitscope.test/api/thing", { method: "GET" });
    expect((await csrf.validateCsrfForRequest(req, null)).valid).toBe(true);
  });

  it("allows same-origin requests", async () => {
    const req = post({ origin: "https://gitscope.test", host: "gitscope.test" });
    expect((await csrf.validateCsrfForRequest(req, null)).valid).toBe(true);
  });

  it("does not throw on an opaque 'null' Origin", async () => {
    // Regression: new URL("null") threw, escaping the middleware as a 500.
    const req = post({ origin: "null", host: "gitscope.test" });
    const result = await csrf.validateCsrfForRequest(req, null);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("does not throw on a malformed Origin", async () => {
    const req = post({ origin: "not a url", host: "gitscope.test" });
    expect((await csrf.validateCsrfForRequest(req, null)).valid).toBe(false);
  });

  it("rejects a cross-origin request with no token", async () => {
    const req = post({ origin: "https://evil.example", host: "gitscope.test" });
    const result = await csrf.validateCsrfForRequest(req, null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("missing");
  });

  it("rejects a cross-origin request whose token does not match the cookie", async () => {
    const { token } = csrf.generateCsrfToken();
    const other = csrf.generateCsrfToken();
    const req = post({
      origin: "https://evil.example",
      host: "gitscope.test",
      "x-csrf-token": token,
    });
    const cookieHeader = `${csrf.CSRF_COOKIE_NAME}=${other.hashedToken}`;
    const result = await csrf.validateCsrfForRequest(req, cookieHeader);
    expect(result.valid).toBe(false);
  });

  it("accepts a cross-origin request carrying a correctly paired token", async () => {
    const { token, hashedToken } = csrf.generateCsrfToken();
    const req = post({
      origin: "https://evil.example",
      host: "gitscope.test",
      "x-csrf-token": token,
    });
    const cookieHeader = `${csrf.CSRF_COOKIE_NAME}=${hashedToken}`;
    expect((await csrf.validateCsrfForRequest(req, cookieHeader)).valid).toBe(true);
  });
});
