/**
 * POST /api/github-app/webhook
 *
 * Receives GitHub App webhook events. Currently handles:
 *   - pull_request (opened, synchronize, reopened) → auto AI review
 *   - installation (created, deleted) → store/clear installationId
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyWebhookSignature,
  postPRComment,
  formatReviewComment,
  isGitHubAppConfigured,
  getInstallationToken,
} from "@/lib/github-app";
import { sendSlackMessage } from "@/lib/slack";
import { analyzeWithInternalAI } from "@/lib/internal-ai";
import { importSpecifiers, readAliases, resolveImport } from "@/lib/internal-ai-graph";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PullRequestPayload {
  action: string;
  installation?: { id: number };
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    head: { sha: string; ref: string };
    base: { ref: string; sha?: string };
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
    after(() => handlePRReview(p).catch((err) => {
      if (process.env.NODE_ENV !== "production") console.error("[webhook] PR review error:", err);
    }));

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

// Safe GitHub name pattern — only alphanumeric, hyphens, underscores, dots
const SAFE_GH_NAME = /^[a-zA-Z0-9_.-]{1,100}$/;

async function handlePRReview(p: PullRequestPayload) {
  const { repository, pull_request: pr, installation } = p;
  if (!installation?.id) return;

  const installId  = String(installation.id);
  const repoFull   = repository.full_name;
  const parts = repoFull.split("/");
  if (parts.length !== 2) return;
  const [owner, repo] = parts;

  // Validate owner/repo to prevent malformed API calls
  if (!SAFE_GH_NAME.test(owner) || !SAFE_GH_NAME.test(repo)) return;

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
    // No user associated — post a basic static analysis comment
    await postBasicComment({ owner, repo, pr, installId });
    return;
  }

  // ── Direct analysis — no HTTP round-trip (code-review route is SSE, not JSON) ──
  let reviewResult: ReturnType<typeof analyzeWithInternalAI> | null = null;

  try {
    // Fetch PR files with diffs using the installation token
    const token = await getInstallationToken(installId);
    const filesRes = await fetch(
      `https://api.github.com/repos/${repoFull}/pulls/${pr.number}/files?per_page=25`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }
    );

    interface GHFile { filename: string; status: string; additions: number; deletions: number; patch?: string; previous_filename?: string; }
    const files: GHFile[] = filesRes.ok ? (await filesRes.json() as GHFile[]) : [];

    const ghHeaders = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
    const readFile = async (path: string, ref: string | undefined): Promise<string | null> => {
      if (!ref) return null;
      try {
        const res = await fetch(`https://api.github.com/repos/${repoFull}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
          headers: { ...ghHeaders, Accept: "application/vnd.github.raw+json" },
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok ? await res.text() : null;
      } catch {
        return null;
      }
    };
    const fileContents: Record<string, string> = {};
    const baseContents: Record<string, string> = {};
    const codeFiles = files
      .filter((f) => f.status !== "removed" && /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|rb|php)$/.test(f.filename))
      .slice(0, 10);
    await Promise.all(codeFiles.map(async (f) => {
      const [after, before] = await Promise.all([
        readFile(f.filename, pr.head.sha),
        f.status === "added" ? Promise.resolve(null) : readFile(f.previous_filename ?? f.filename, pr.base.sha),
      ]);
      if (after) fileContents[f.filename] = after;
      if (before) baseContents[f.filename] = before;
    }));

    let repoFiles: string[] | undefined;
    try {
      const treeRes = await fetch(`https://api.github.com/repos/${repoFull}/git/trees/${pr.head.sha}?recursive=1`, {
        headers: { ...ghHeaders, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      });
      const tree = treeRes.ok ? (await treeRes.json() as { tree: Array<{ path: string; type: string }>; truncated?: boolean }) : null;
      if (tree && !tree.truncated) repoFiles = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
    } catch {
      repoFiles = undefined;
    }
    if (repoFiles) {
      const fileSet = new Set(repoFiles);
      const projectFiles = ["tsconfig.json", "package.json", "proxy.ts", "middleware.ts", "src/proxy.ts", "src/middleware.ts", "next.config.ts", "next.config.js", "next.config.mjs"]
        .filter((p) => fileSet.has(p));
      await Promise.all(projectFiles.map(async (p) => {
        const content = await readFile(p, pr.head.sha);
        if (content) fileContents[p] = content;
      }));
      const aliases = readAliases(fileContents["tsconfig.json"]);
      const imported = new Set<string>();
      for (const f of codeFiles) {
        const content = fileContents[f.filename];
        if (!content) continue;
        for (const spec of importSpecifiers(content, f.filename)) {
          const target = resolveImport(f.filename, spec, fileSet, aliases);
          if (target && !(target in fileContents) && /\.(?:[cm]?[jt]sx?|py)$/.test(target)) imported.add(target);
        }
      }
      await Promise.all([...imported].slice(0, 8).map(async (p) => {
        const content = await readFile(p, pr.head.sha);
        if (content) fileContents[p] = content;
      }));
    }

    // Run internal static analysis directly (avoids the SSE code-review route)
    reviewResult = analyzeWithInternalAI({
      repo: repoFull,
      analysisType: "pr",
      prMeta: {
        title: pr.title, body: pr.body, user: pr.user,
        additions: pr.additions, deletions: pr.deletions,
        changed_files: pr.changed_files, draft: pr.draft,
        labels: [],
      },
      files,
      prNumber: pr.number,
      fileContents,
      baseContents,
      repoFiles,
    });
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
