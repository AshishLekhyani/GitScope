const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/i,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
];

export function parseSafeHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) return null;
    return url;
  } catch {
    return null;
  }
}

export function validateAutomationActionUrl(
  actionType: string,
  raw: string | null
): { ok: true; url: string | null } | { ok: false; error: string } {
  if (!raw) {
    if (actionType === "webhook" || actionType === "github_issue") {
      return { ok: false, error: "actionUrl is required for webhook and github_issue actions." };
    }
    return { ok: true, url: null };
  }

  const url = parseSafeHttpsUrl(raw);
  if (!url) return { ok: false, error: "actionUrl must be a public HTTPS URL." };

  if (actionType === "slack" && url.hostname !== "hooks.slack.com") {
    return { ok: false, error: "Slack actions must use a hooks.slack.com webhook URL." };
  }

  if (actionType === "discord" && url.hostname !== "discord.com" && url.hostname !== "discordapp.com") {
    return { ok: false, error: "Discord actions must use a Discord webhook URL." };
  }

  if (actionType === "github_issue") {
    const pathOk = /^\/repos\/[^/]+\/[^/]+\/issues$/.test(url.pathname);
    if (url.hostname !== "api.github.com" || !pathOk) {
      return { ok: false, error: "GitHub issue actions must use https://api.github.com/repos/{owner}/{repo}/issues." };
    }
  }

  return { ok: true, url: url.toString() };
}
