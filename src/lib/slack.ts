/**
 * GitScope Slack Integration — incoming webhooks
 *
 * Set SLACK_WEBHOOK_URL in env (global default) or store per-user in DB.
 * No package needed — Slack webhooks are plain HTTPS POST with JSON.
 */

export interface SlackField {
  title: string;
  value: string;
  short?: boolean;
}

export interface SlackAttachment {
  color: string;      // hex or "good" | "warning" | "danger"
  title: string;
  title_link?: string;
  text?: string;
  fields?: SlackField[];
  footer?: string;
  ts?: number;
}

export interface SlackMessage {
  text?: string;
  username?: string;
  icon_emoji?: string;
  attachments?: SlackAttachment[];
}

// ── Core send function ─────────────────────────────────────────────────────────

export async function sendSlackMessage(webhookUrl: string, message: SlackMessage): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: message.username ?? "GitScope",
      icon_emoji: message.icon_emoji ?? ":telescope:",
      ...message,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook error ${res.status}: ${body}`);
  }
}

// ── High-level notification builders ──────────────────────────────────────────

const APP_URL = (process.env.NEXTAUTH_URL ?? "https://git-scope-pi.vercel.app").replace(/\/$/, "");

function tierColor(score: number): string {
  if (score >= 80) return "#10b981";   // green
  if (score >= 65) return "#14b8a6";   // teal
  if (score >= 50) return "#f59e0b";   // amber
  if (score >= 35) return "#f97316";   // orange
  return "#ef4444";                     // red
}

export async function sendScanAlert(webhookUrl: string, opts: {
  repo: string;
  prevScore: number;
  newScore: number;
  drop: number;
  criticalCount: number;
  highCount: number;
  summary: string;
  scanMode: string;
}) {
  const { repo, prevScore, newScore, drop, criticalCount, highCount, summary, scanMode } = opts;
  const fields: SlackField[] = [
    { title: "Previous Score", value: String(prevScore), short: true },
    { title: "New Score", value: `${newScore} (−${drop})`, short: true },
  ];
  if (criticalCount > 0) fields.push({ title: "Critical Issues", value: String(criticalCount), short: true });
  if (highCount > 0)     fields.push({ title: "High Issues",     value: String(highCount),     short: true });

  return sendSlackMessage(webhookUrl, {
    text: `*Health score alert* for \`${repo}\``,
    attachments: [{
      color: "#ef4444",
      title: `Score dropped ${drop} pts — ${scanMode} scan`,
      title_link: `${APP_URL}/intelligence`,
      text: summary,
      fields,
      footer: "GitScope Repo Scanner",
      ts: Math.floor(Date.now() / 1000),
    }],
  });
}

export async function sendWeeklyDigestSlack(webhookUrl: string, opts: {
  repoCount: number;
  avgScore: number;
  atRiskCount: number;
  topRepo: string;
  topScore: number;
  weeklyDelta: number;
}) {
  const { repoCount, avgScore, atRiskCount, topRepo, topScore, weeklyDelta } = opts;
  const deltaStr = weeklyDelta >= 0 ? `+${weeklyDelta}` : String(weeklyDelta);

  return sendSlackMessage(webhookUrl, {
    text: "*GitScope Weekly Digest*",
    attachments: [{
      color: tierColor(avgScore),
      title: `Fleet Health Report — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}`,
      title_link: `${APP_URL}/intelligence`,
      fields: [
        { title: "Repos Tracked",   value: String(repoCount),           short: true },
        { title: "Avg Health Score", value: `${avgScore} (${deltaStr} vs last week)`, short: true },
        { title: "At-Risk Repos",   value: String(atRiskCount),         short: true },
        { title: "Top Repo",        value: `${topRepo} (${topScore}/100)`, short: true },
      ],
      footer: "GitScope · Weekly Digest",
      ts: Math.floor(Date.now() / 1000),
    }],
  });
}

export async function sendPRReviewSlack(webhookUrl: string, opts: {
  repo: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  verdict: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  summary: string;
  issueCount: number;
}) {
  const { repo, prNumber, prTitle, prUrl, verdict, summary, issueCount } = opts;
  const colorMap = { APPROVE: "#10b981", COMMENT: "#f59e0b", REQUEST_CHANGES: "#ef4444" } as const;
  const emojiMap = { APPROVE: ":white_check_mark:", COMMENT: ":speech_balloon:", REQUEST_CHANGES: ":x:" } as const;

  return sendSlackMessage(webhookUrl, {
    text: `${emojiMap[verdict]} *PR Review* for \`${repo}\``,
    attachments: [{
      color: colorMap[verdict],
      title: `#${prNumber}: ${prTitle}`,
      title_link: prUrl,
      text: summary,
      fields: [
        { title: "Verdict",      value: verdict.replace("_", " "), short: true },
        { title: "Issues Found", value: String(issueCount),        short: true },
      ],
      footer: "GitScope Code Lens",
      ts: Math.floor(Date.now() / 1000),
    }],
  });
}
