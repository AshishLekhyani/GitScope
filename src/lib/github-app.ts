/**
 * GitScope GitHub App Integration
 * ================================
 * Handles JWT auth, installation tokens, and PR comment posting.
 *
 * Required env vars (set after registering your GitHub App):
 *   GITHUB_APP_ID          — numeric app ID from app settings page
 *   GITHUB_APP_PRIVATE_KEY — PEM private key (base64-encoded for env safety)
 *   GITHUB_WEBHOOK_SECRET  — secret you set when creating the app
 *
 * GitHub App registration:
 *   1. github.com/settings/apps/new
 *   2. Permissions: Pull requests (Read & Write), Contents (Read)
 *   3. Subscribe to events: pull_request
 *   4. Webhook URL: https://yourdomain.com/api/github-app/webhook
 */

import * as crypto from "crypto";

// ── JWT helpers ────────────────────────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Create a GitHub App JWT (10 min TTL).
 * GitHub Apps authenticate as the app itself using RS256 JWTs signed with the private key.
 */
export function createAppJWT(): string {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKeyRaw) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY env vars are required");
  }

  // Support base64-encoded key (newlines break some env systems)
  const pem = privateKeyRaw.includes("-----BEGIN")
    ? privateKeyRaw.replace(/\\n/g, "\n")
    : Buffer.from(privateKeyRaw, "base64").toString("utf8");

  const now = Math.floor(Date.now() / 1000);
  const header  = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signingInput = `${header}.${payload}`;

  const sig = crypto.createSign("RSA-SHA256").update(signingInput).sign(pem);
  return `${signingInput}.${base64url(sig)}`;
}

// ── Installation token ─────────────────────────────────────────────────────────

export async function getInstallationToken(installationId: string): Promise<string> {
  const jwt = createAppJWT();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub App token error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

// ── PR comment posting ─────────────────────────────────────────────────────────

export async function postPRComment(opts: {
  owner: string;
  repo: string;
  prNumber: number;
  installationId: string;
  body: string;
}): Promise<void> {
  const token = await getInstallationToken(opts.installationId);
  const res = await fetch(
    `https://api.github.com/repos/${opts.owner}/${opts.repo}/issues/${opts.prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: opts.body }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub comment error ${res.status}: ${body}`);
  }
}

export async function submitPRReview(opts: {
  owner: string;
  repo: string;
  prNumber: number;
  commitId: string;
  installationId: string;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  body: string;
}): Promise<void> {
  const token = await getInstallationToken(opts.installationId);
  const res = await fetch(
    `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls/${opts.prNumber}/reviews`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ commit_id: opts.commitId, body: opts.body, event: opts.verdict }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub review error ${res.status}: ${body}`);
  }
}

// ── Webhook signature verification ────────────────────────────────────────────

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Format AI review as a readable PR comment ─────────────────────────────────

export function formatReviewComment(result: {
  verdict: string;
  summary: string;
  findings?: Array<{ severity: string; description: string; suggestion?: string }>;
  securityIssues?: string[];
  model?: string;
}): string {
  const { verdict, summary, findings = [], securityIssues = [], model } = result;
  const verdictEmoji: Record<string, string> = {
    APPROVE: "✅",
    COMMENT: "💬",
    REQUEST_CHANGES: "🔴",
  };
  const emoji = verdictEmoji[verdict] ?? "🔍";

  const lines: string[] = [
    `## ${emoji} GitScope AI Review — ${verdict.replace("_", " ")}`,
    "",
    summary,
    "",
  ];

  if (findings.length > 0) {
    lines.push("### Findings", "");
    const sevEmoji: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" };
    for (const f of findings.slice(0, 8)) {
      lines.push(`${sevEmoji[f.severity] ?? "•"} **${f.severity.toUpperCase()}** — ${f.description}`);
      if (f.suggestion) lines.push(`  > ${f.suggestion}`);
    }
    lines.push("");
  }

  if (securityIssues.length > 0) {
    lines.push("### Security Concerns", "");
    for (const s of securityIssues.slice(0, 5)) lines.push(`- 🔐 ${s}`);
    lines.push("");
  }

  lines.push(
    "---",
    `*Powered by [GitScope](https://gitscope.dev) AI Code Review${model ? ` · ${model}` : ""}*`
  );

  return lines.join("\n");
}

// ── Check if GitHub App is configured ─────────────────────────────────────────

export function isGitHubAppConfigured(): boolean {
  return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
}
