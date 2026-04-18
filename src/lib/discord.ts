/**
 * GitScope Discord Integration — incoming webhooks
 * Uses Discord's native webhook format with embeds.
 */

const APP_URL = (process.env.NEXTAUTH_URL ?? "https://git-scope-pi.vercel.app").replace(/\/$/, "");

function scoreColor(score: number): number {
  if (score >= 80) return 0x10b981; // emerald
  if (score >= 65) return 0x14b8a6; // teal
  if (score >= 50) return 0xf59e0b; // amber
  if (score >= 35) return 0xf97316; // orange
  return 0xef4444;                   // red
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  url?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

async function sendDiscordMessage(webhookUrl: string, content: string, embeds: DiscordEmbed[]): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "GitScope", avatar_url: `${APP_URL}/icon.png`, content, embeds }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discord webhook error ${res.status}: ${body}`);
  }
}

export async function sendDiscordScanAlert(
  webhookUrl: string,
  opts: {
    repo: string;
    prevScore: number;
    newScore: number;
    drop: number;
    criticalCount: number;
    highCount: number;
    summary: string;
    scanMode: string;
  },
): Promise<void> {
  const { repo, newScore, drop, criticalCount } = opts;
  const grade = newScore >= 80 ? "A" : newScore >= 65 ? "B" : newScore >= 50 ? "C" : newScore >= 35 ? "D" : "F";
  await sendDiscordMessage(webhookUrl, "", [{
    title: `⚠️ Health Drop Detected: ${repo}`,
    description: `Score dropped **${drop} pts** → **${newScore}/100** (Grade **${grade}**)`,
    color: scoreColor(newScore),
    url: `${APP_URL}/intelligence`,
    fields: [
      { name: "New Score", value: `${newScore}/100`, inline: true },
      { name: "Drop", value: `-${drop} pts`, inline: true },
      ...(criticalCount > 0 ? [{ name: "⚠️ Critical Issues", value: String(criticalCount), inline: true }] : []),
    ],
    footer: { text: "GitScope — Codebase Intelligence" },
    timestamp: new Date().toISOString(),
  }]);
}

export async function sendDiscordDigest(
  webhookUrl: string,
  opts: {
    repoCount: number;
    avgScore: number;
    atRiskCount: number;
    topRepo: string;
    topScore: number;
    weeklyDelta: number;
  },
): Promise<void> {
  const { avgScore, repoCount, atRiskCount, topRepo, topScore, weeklyDelta } = opts;
  const deltaStr = weeklyDelta === 0 ? "no change" : weeklyDelta > 0 ? `+${weeklyDelta} pts ↑` : `${weeklyDelta} pts ↓`;
  await sendDiscordMessage(webhookUrl, "📬 **Weekly Fleet Digest**", [{
    title: "GitScope Weekly Health Report",
    description: `Average fleet health: **${avgScore}/100** (${deltaStr})`,
    color: scoreColor(avgScore),
    url: `${APP_URL}/overview`,
    fields: [
      { name: "Repos Monitored", value: String(repoCount), inline: true },
      { name: "At Risk", value: String(atRiskCount), inline: true },
      { name: "Top Repo", value: `${topRepo} (${topScore}/100)`, inline: false },
    ],
    footer: { text: "GitScope — Codebase Intelligence" },
    timestamp: new Date().toISOString(),
  }]);
}

export async function testDiscordWebhook(webhookUrl: string): Promise<void> {
  await sendDiscordMessage(webhookUrl, "", [{
    title: "✅ GitScope Discord connected",
    description: "You'll receive scan alerts and weekly digests here.",
    color: 0x6366f1,
    footer: { text: "GitScope — Codebase Intelligence" },
    timestamp: new Date().toISOString(),
  }]);
}
