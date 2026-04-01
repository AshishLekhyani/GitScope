/** Validates that a string is a safe `owner/repo` GitHub identifier.
 *  Prevents SSRF by ensuring no URL injection can occur when interpolated
 *  into `https://api.github.com/repos/{input}/...`
 */
const REPO_RE = /^[a-zA-Z0-9_.-]{1,100}\/[a-zA-Z0-9_.-]{1,100}$/;

export function isValidRepo(value: string): boolean {
  return REPO_RE.test(value);
}

export function sanitizeRepoList(raw: string, max = 10): string[] | null {
  const list = raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, max);
  if (list.length === 0) return null;
  if (list.some((r) => !isValidRepo(r))) return null;
  return list;
}
