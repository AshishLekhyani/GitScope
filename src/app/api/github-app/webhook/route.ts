/**
 * POST /api/github-app/webhook
 *
 * Receives GitHub App webhook events. Currently handles:
 *   - pull_request (opened, synchronize, reopened) → auto AI review
 *   - installation (created, deleted) → store/clear installationId
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyWebhookSignature,
  postPRComment,
  formatReviewComment,
  isGitHubAppConfigured,
} from "@/lib/github-app";
import { sendSlackMessage } from "@/lib/slack";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PullRequestPayload {
  action: string;
  installation?: { id: number };
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    head: { sha: string; ref: string };
    base: { ref: string };
    body: string | null;
    user: { login: string };
    draft: boolean;
    additions: number;
    deletions: number;
    changed_files: number;
  };
  repository: {
    full_name: string;
    owner: { login: string };
    name: string;
    private: boolean;
  };
  sender: { login: string };
}

interface InstallationPayload {
  action: "created" | "deleted" | "suspend" | "unsuspend";
  installation: {
    id: number;
    account: { login: string; type: string };
  };
  sender: { login: string };
}

// ── Main handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isGitHubAppConfigured()) {
    return NextResponse.json({ error: "GitHub App not configured" }, { status: 501 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const event     = req.headers.get("x-github-event") ?? "";

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // ── installation events ────────────────────────────────────────────────────
  if (event === "installation") {
    const p = payload as InstallationPayload;
    await handleInstallation(p);
    return NextResponse.json({ ok: true });
  }

  // ── pull_request events ────────────────────────────────────────────────────
  if (event === "pull_request") {
    const p = payload as PullRequestPayload;
    const triggerActions = ["opened", "synchronize", "reopened"];
    if (!triggerActions.includes(p.action)) {
      return NextResponse.json({ ok: true, skipped: `action=${p.action}` });
    }
    if (p.pull_request.draft) {
      return NextResponse.json({ ok: true, skipped: "draft PR" });
    }

    // Fire and forget — respond quickly to GitHub (10s limit)
    void handlePRReview(p).catch((err) => {
      if (process.env.NODE_ENV !== "production") console.error("[webhook] PR review error:", err);
    });

    return NextResponse.json({ ok: true, queued: true });
  }

  return NextResponse.json({ ok: true, event });
}

// ── Installation handler ───────────────────────────────────────────────────────

async function handleInstallation(p: InstallationPayload) {
  const senderLogin = p.sender.login.toLowerCase();
  const installId   = String(p.installation.id);

  if (p.action === "created") {
    // Match by githubHandle (user must have set this in their GitScope profile)
    // If no match, the user can enter the installation ID manually in Settings → Integrations
    await prisma.user.updateMany({
      where: {
        OR: [
          { githubHandle: senderLogin },
          { githubHandle: p.installation.account.login.toLowerCase() },
        ],
      },
      data: { githubAppInstallId: installId },
    });
  }

  if (p.action === "deleted" || p.action === "suspend") {
    await prisma.user.updateMany({
      where: { githubAppInstallId: installId },
      data: { githubAppInstallId: null },
    });
  }
}

// ── PR Review handler ──────────────────────────────────────────────────────────

async function handlePRReview(p: PullRequestPayload) {
  const { repository, pull_request: pr, installation } = p;
  if (!installation?.id) return;

  const installId  = String(installation.id);
  const repoFull   = repository.full_name;
  const [owner, repo] = repoFull.split("/");

  // Find user that owns this installation
  const user = await prisma.user.findFirst({
    where: { githubAppInstallId: installId },
    select: {
      id: true,
      email: true,
      name: true,
      aiTier: true,
      slackWebhookUrl: true,
    },
  });

  if (!user) {
    // No user associated — still post a basic static analysis comment
    await postBasicComment({ owner, repo, pr, installId });
    return;
  }

  // Call internal AI review route
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  let reviewResult: Record<string, unknown> | null = null;

  try {
    const res = await fetch(`${baseUrl}/api/ai/code-review`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Internal call — use a shared secret so the route trusts it
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify({
        repo: repoFull,
        prNumber: pr.number,
        userId: user.id,
        plan: user.aiTier,
        internalCall: true,
      }),
    });
    if (res.ok) reviewResult = await res.json() as Record<string, unknown>;
  } catch { /* fall through to static comment */ }

  const comment = reviewResult
    ? formatReviewComment(reviewResult as Parameters<typeof formatReviewComment>[0])
    : buildStaticComment(pr);

  await postPRComment({ owner, repo, prNumber: pr.number, installationId: installId, body: comment });

  // Slack notification
  if (user.slackWebhookUrl) {
    const verdict = (reviewResult?.verdict as string) ?? "COMMENT";
    const summary = (reviewResult?.summary as string) ?? `Auto-reviewed PR #${pr.number}: ${pr.title}`;
    const findings = (reviewResult?.findings as Array<{ severity: string }> | undefined) ?? [];
    await sendSlackMessage(user.slackWebhookUrl, {
      text: `*GitScope* reviewed \`${repoFull}\` PR #${pr.number}`,
      attachments: [{
        color: verdict === "APPROVE" ? "#10b981" : verdict === "REQUEST_CHANGES" ? "#ef4444" : "#f59e0b",
        title: `#${pr.number}: ${pr.title}`,
        title_link: pr.html_url,
        text: summary,
        fields: [
          { title: "Verdict", value: verdict.replace("_", " "), short: true },
          { title: "Issues",  value: String(findings.length),  short: true },
        ],
        footer: "GitScope GitHub App",
        ts: Math.floor(Date.now() / 1000),
      }],
    }).catch(() => { /* non-fatal */ });
  }
}

// ── Static fallback comment ────────────────────────────────────────────────────

async function postBasicComment(opts: {
  owner: string;
  repo: string;
  pr: PullRequestPayload["pull_request"];
  installId: string;
}) {
  const { owner, repo, pr, installId } = opts;
  const comment = buildStaticComment(pr);
  await postPRComment({ owner, repo, prNumber: pr.number, installationId: installId, body: comment });
}

function buildStaticComment(pr: PullRequestPayload["pull_request"]): string {
  const lines = [
    "## 🔍 GitScope Auto Review",
    "",
    `Thanks for opening **#${pr.number}: ${pr.title}**, @${pr.user.login}!`,
    "",
    `This PR changes **${pr.changed_files} file(s)** (+${pr.additions} / -${pr.deletions} lines).`,
    "",
    "**Quick checklist:**",
    "- [ ] Tests added/updated for new logic",
    "- [ ] No secrets or credentials in diff",
    "- [ ] Breaking changes documented",
    "- [ ] Error cases handled",
    "",
    "> Connect your GitScope account at [gitscope.dev](https://gitscope.dev) to get full AI-powered reviews on every PR.",
    "",
    "---",
    "*Powered by [GitScope](https://gitscope.dev) GitHub App*",
  ];
  return lines.join("\n");
}
