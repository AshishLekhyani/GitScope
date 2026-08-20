/**
 * Outbound Webhook Automation — fires user-defined rules after a scan completes.
 * Called non-blocking from the repo-scan route.
 */

import { prisma } from "@/lib/prisma";
import { validateAutomationActionUrl } from "@/lib/outbound-url";
import { getGitHubToken } from "@/lib/github-auth";
import type { Session } from "next-auth";

interface ScanMetrics {
  repo: string;
  healthScore: number;
  securityScore: number;
  qualityScore: number;
  criticalCount: number;
  prevHealthScore?: number | null; // last recorded score before this scan
}

function metricValue(metric: string, m: ScanMetrics): number {
  switch (metric) {
    case "healthScore":    return m.healthScore;
    case "securityScore":  return m.securityScore;
    case "qualityScore":   return m.qualityScore;
    case "criticalCount":  return m.criticalCount;
    default:               return 0;
  }
}

function conditionMet(op: string, value: number, threshold: number, prev: number | null | undefined): boolean {
  switch (op) {
    case "lt":      return value < threshold;
    case "gt":      return value > threshold;
    case "drop_by": return prev != null && (prev - value) >= threshold;
    default:        return false;
  }
}

async function postJson(
  url: string,
  body: string,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[Automation] POST ${new URL(url).host} responded ${res.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function fireAction(
  actionType: string,
  actionUrl: string | null,
  userSlack: string | null | undefined,
  userDiscord: string | null | undefined,
  payload: Record<string, unknown>,
  userId: string,
  session: Session | null,
): Promise<void> {
  const body = JSON.stringify(payload);

  try {
    switch (actionType) {
      case "slack": {
        const url = actionUrl || userSlack;
        if (!url) return;
        const validated = validateAutomationActionUrl("slack", url);
        if (!validated.ok || !validated.url) return;
        const slackBody = JSON.stringify({
          text: `*GitScope Automation Alert*\n*Rule triggered* for \`${payload.repo}\`\n${payload.message}`,
        });
        await postJson(validated.url, slackBody);
        break;
      }
      case "discord": {
        const url = actionUrl || userDiscord;
        if (!url) return;
        const validated = validateAutomationActionUrl("discord", url);
        if (!validated.ok || !validated.url) return;
        const discordBody = JSON.stringify({
          content: `**GitScope Automation Alert**\n**Rule triggered** for \`${payload.repo}\`\n${payload.message}`,
        });
        await postJson(validated.url, discordBody);
        break;
      }
      case "webhook": {
        const validated = validateAutomationActionUrl("webhook", actionUrl);
        if (!validated.ok || !validated.url) return;
        await postJson(validated.url, body);
        break;
      }
      case "github_issue": {
        const validated = validateAutomationActionUrl("github_issue", actionUrl);
        if (!validated.ok || !validated.url) return;
        // actionUrl should be the GitHub Issues API endpoint:
        // https://api.github.com/repos/{owner}/{repo}/issues
        // Creating an issue requires authentication — without a token GitHub
        // always answers 401, so skip rather than fire a request that cannot work.
        const token = await getGitHubToken({ userId, session });
        if (!token) {
          console.warn("[Automation] github_issue action skipped: no GitHub token for user");
          return;
        }
        const issueBody = JSON.stringify({
          title: `[GitScope] Automation alert: ${payload.ruleName}`,
          body: `## GitScope Automation Alert\n\n${payload.message}\n\n**Repo:** \`${payload.repo}\`\n**Health Score:** ${payload.healthScore}\n\n---\n*Triggered by [GitScope](https://gitscope.dev) automation rule: ${payload.ruleName}*`,
          labels: ["gitscope", "automated"],
        });
        await postJson(validated.url, issueBody, {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        });
        break;
      }
    }
  } catch {
    // Non-blocking — automation errors never break scans
  }
}

export async function triggerWebhookRules(
  userId: string,
  metrics: ScanMetrics,
  // Passed explicitly: this runs as a floating promise from the scan stream, so
  // request-scoped `getServerSession()` may no longer be available by the time
  // an action fires.
  session: Session | null = null,
): Promise<void> {
  try {
    const rules = await prisma.webhookRule.findMany({
      where: { userId, enabled: true },
    });
    if (!rules.length) return;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { slackWebhookUrl: true, discordWebhookUrl: true },
    });

    const fired: string[] = [];

    for (const rule of rules) {
      // Scope check
      if (rule.repoFilter && rule.repoFilter !== metrics.repo) continue;

      const value = metricValue(rule.triggerMetric, metrics);
      const prev  = rule.triggerOp === "drop_by" ? (metrics.prevHealthScore ?? null) : null;

      if (!conditionMet(rule.triggerOp, value, rule.triggerThreshold, prev)) continue;

      const metricLabel: Record<string, string> = {
        healthScore:   "Health Score",
        securityScore: "Security Score",
        qualityScore:  "Quality Score",
        criticalCount: "Critical Issues",
      };

      const opLabel: Record<string, string> = {
        lt:      "dropped below",
        gt:      "exceeded",
        drop_by: "dropped by",
      };

      const message = `**${metricLabel[rule.triggerMetric] ?? rule.triggerMetric}** ${opLabel[rule.triggerOp] ?? rule.triggerOp} **${rule.triggerThreshold}** (current: ${value})`;

      const payload = {
        ruleName:     rule.name,
        repo:         metrics.repo,
        metric:       rule.triggerMetric,
        value,
        threshold:    rule.triggerThreshold,
        healthScore:  metrics.healthScore,
        message,
        triggeredAt:  new Date().toISOString(),
      };

      await fireAction(rule.actionType, rule.actionUrl ?? null, user?.slackWebhookUrl, user?.discordWebhookUrl, payload, userId, session);
      fired.push(rule.id);
    }

    if (fired.length > 0) {
      await prisma.webhookRule.updateMany({
        where: { id: { in: fired } },
        data:  { lastTriggeredAt: new Date(), triggerCount: { increment: 1 } },
      });
    }
  } catch {
    // Never let automation errors surface to the user
  }
}
