/**
 * Path allowlist for the generic GitHub API proxy (`/api/github/proxy`).
 *
 * The proxy is deliberately narrow: only `/repos/{owner}/{repo}...` endpoints.
 * Everything else has a dedicated route with its own auth and rate-limit rules.
 */

/** Reject `.` / `..` segments in literal *and* percent-encoded form. */
const DOT_SEGMENT = /(^|\/)(\.|%2e){1,2}(\/|$)/i;

const REPOS_PATH = /^\/repos\/[\w.-]+\/[\w.-]+/;

/**
 * Returns the path to forward to GitHub, or null if it isn't allowed.
 *
 * Percent-encoded dots matter here: the WHATWG URL parser treats `%2e` as a dot
 * when collapsing path segments, so `/repos/o/r/%2e%2e/%2e%2e/%2e%2e/user/repos`
 * normalises to `/user/repos` and would otherwise escape this allowlist.
 */
export function resolveProxyPath(rawPath: string): string | null {
  if (!rawPath) return null;

  const apiPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const pathWithoutQuery = apiPath.split("?")[0];

  if (rawPath.startsWith("http")) return null;
  if (rawPath.includes("..")) return null;
  if (DOT_SEGMENT.test(pathWithoutQuery)) return null;
  if (!REPOS_PATH.test(pathWithoutQuery)) return null;

  // Belt-and-suspenders: confirm the fully-resolved URL still points at the
  // repos namespace on api.github.com once the URL parser has normalised it.
  let resolved: URL;
  try {
    resolved = new URL(apiPath, "https://api.github.com");
  } catch {
    return null;
  }
  if (resolved.origin !== "https://api.github.com") return null;
  if (!resolved.pathname.startsWith("/repos/")) return null;

  return apiPath;
}
