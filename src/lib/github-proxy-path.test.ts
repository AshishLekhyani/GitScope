import { describe, expect, it } from "vitest";
import { resolveProxyPath } from "./github-proxy-path";

describe("resolveProxyPath — allowed paths", () => {
  it("accepts a bare repo path", () => {
    expect(resolveProxyPath("/repos/octocat/hello-world")).toBe("/repos/octocat/hello-world");
  });

  it("accepts a path without a leading slash", () => {
    expect(resolveProxyPath("repos/octocat/hello-world")).toBe("/repos/octocat/hello-world");
  });

  it("preserves the query string", () => {
    expect(resolveProxyPath("/repos/o/r/contents/src?ref=main")).toBe("/repos/o/r/contents/src?ref=main");
  });

  it("accepts a dot-prefixed repo name like .github", () => {
    expect(resolveProxyPath("/repos/octocat/.github/contents")).toBe("/repos/octocat/.github/contents");
  });

  it("accepts a repo name containing a dot", () => {
    expect(resolveProxyPath("/repos/octocat/my.repo/pulls")).toBe("/repos/octocat/my.repo/pulls");
  });
});

describe("resolveProxyPath — traversal and scope escapes", () => {
  it("rejects literal ../ traversal", () => {
    expect(resolveProxyPath("/repos/o/r/../../../user/repos")).toBeNull();
  });

  it("rejects percent-encoded %2e%2e traversal", () => {
    // Regression: the WHATWG URL parser collapses %2e as a dot segment, so this
    // normalises to /user/repos and escapes the repos-only allowlist.
    expect(resolveProxyPath("/repos/o/r/%2e%2e/%2e%2e/%2e%2e/user/repos")).toBeNull();
  });

  it("rejects percent-encoded traversal regardless of case", () => {
    expect(resolveProxyPath("/repos/o/r/%2E%2E/%2e%2e/%2e%2e/user")).toBeNull();
  });

  it("rejects a single encoded dot segment", () => {
    expect(resolveProxyPath("/repos/o/r/%2e/%2e%2e/%2e%2e/user")).toBeNull();
  });

  it("rejects absolute URLs", () => {
    expect(resolveProxyPath("https://evil.example/repos/o/r")).toBeNull();
  });

  it("rejects non-repos endpoints", () => {
    expect(resolveProxyPath("/user/repos")).toBeNull();
    expect(resolveProxyPath("/notifications")).toBeNull();
  });

  it("rejects an incomplete repos path", () => {
    expect(resolveProxyPath("/repos/octocat")).toBeNull();
  });

  it("rejects an empty path", () => {
    expect(resolveProxyPath("")).toBeNull();
  });

  it("never resolves off api.github.com", () => {
    for (const candidate of [
      "/repos/o/r/%2e%2e/%2e%2e/%2e%2e/user",
      "//evil.example/repos/o/r",
      "/repos/o/r/../../..",
    ]) {
      const resolved = resolveProxyPath(candidate);
      if (resolved !== null) {
        expect(new URL(resolved, "https://api.github.com").origin).toBe("https://api.github.com");
        expect(new URL(resolved, "https://api.github.com").pathname.startsWith("/repos/")).toBe(true);
      }
    }
  });
});
