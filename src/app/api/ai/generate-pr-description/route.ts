export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { callAI, hasAnyAIProvider } from "@/lib/ai-providers";
import type { AIPlan } from "@/lib/ai-providers";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";
import { getUserBYOKKeys } from "@/lib/byok";

async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await resolveAiPlanFromSessionDb(session);
  const byokKeys = await getUserBYOKKeys(session.user.id);
  const hasByok = !!(byokKeys.anthropic || byokKeys.openai || byokKeys.gemini || byokKeys.groq || byokKeys.cerebras || byokKeys.deepseek || byokKeys.mistral);
  if (plan === "free" && !hasByok) {
    return NextResponse.json({ error: "PR description generation requires Developer plan or a BYOK key." }, { status: 403 });
  }
  if (!hasAnyAIProvider()) {
    return NextResponse.json({ error: "No AI provider configured." }, { status: 503 });
  }

  let body: { repo?: string; prNumber?: number; baseBranch?: string; headBranch?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { repo, prNumber, baseBranch = "main", headBranch } = body;
  if (!repo) return NextResponse.json({ error: "repo is required (owner/name)" }, { status: 400 });
  if (!prNumber && !headBranch) return NextResponse.json({ error: "prNumber or headBranch is required" }, { status: 400 });

  const token = await getGitHubToken();
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers["Authorization"] = `token ${token}`;

  let commits: { sha: string; message: string }[] = [];
  let diff = "";
  let existingTitle = "";

  try {
    if (prNumber) {
      // Fetch PR data
      const prRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, { headers });
      if (prRes.ok) {
        const pr = await prRes.json();
        existingTitle = pr.title ?? "";
      }

      // Fetch PR commits
      const commitsRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/commits?per_page=30`, { headers });
      if (commitsRes.ok) {
        const data = await commitsRes.json();
        commits = (data as { sha: string; commit: { message: string } }[]).map((c) => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split("\n")[0],
        }));
      }

      // Fetch diff (truncated)
      const diffRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=30`, { headers });
      if (diffRes.ok) {
        const files = await diffRes.json() as { filename: string; status: string; additions: number; deletions: number; patch?: string }[];
        diff = files.slice(0, 25).map((f) =>
          `${f.status.toUpperCase()} ${f.filename} (+${f.additions}/-${f.deletions})\n${(f.patch ?? "").slice(0, 1200)}`
        ).join("\n\n");
      }
    } else if (headBranch) {
      // Compare branches
      const compareRes = await fetch(
        `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}?per_page=30`,
        { headers }
      );
      if (compareRes.ok) {
        const data = await compareRes.json();
        commits = ((data.commits ?? []) as { sha: string; commit: { message: string } }[]).slice(0, 30).map((c) => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split("\n")[0],
        }));
        diff = ((data.files ?? []) as { filename: string; status: string; additions: number; deletions: number; patch?: string }[])
          .slice(0, 25)
          .map((f) => `${f.status.toUpperCase()} ${f.filename} (+${f.additions}/-${f.deletions})\n${(f.patch ?? "").slice(0, 1200)}`)
          .join("\n\n");
      }
    }
  } catch {
    return NextResponse.json({ error: "Failed to fetch PR data from GitHub" }, { status: 502 });
  }

  if (commits.length === 0 && !diff) {
    return NextResponse.json({ error: "No commits or diff found. Ensure the branch has changes against the base." }, { status: 404 });
  }

  const systemPrompt = `You are a principal engineer who writes professional, high-signal GitHub pull request descriptions. You read actual diffs and produce descriptions that tell reviewers exactly what changed, why, and how to test it.

RULES:
1. Base every claim on the actual diff provided — never invent changes.
2. Group related file changes into themes (e.g., "Auth refactor", "UI changes", "Database migration").
3. Flag security-relevant changes (auth, secrets, permissions) explicitly.
4. If commits reference issue numbers or ticket IDs, include them.
5. Output ONLY the raw Markdown — no preamble, no "Here is your PR description:".`;

  const userPrompt = `Generate a professional PR description for this pull request.

Repository: ${repo}
${existingTitle ? `PR Title: "${existingTitle}"` : ""}
${prNumber ? `PR #${prNumber}` : `Comparing: ${baseBranch} → ${headBranch}`}

## Commits (${commits.length} total)
${commits.map((c) => `- \`${c.sha}\` ${c.message}`).join("\n")}

## Diff (key file changes)
${diff.slice(0, 6000)}

Write a PR description with exactly these sections:

## Summary
(3-5 bullet points — what this PR does and why, grounded in the actual diff)

## Changes
(Group related changes by concern. Name specific files/functions that changed. Highlight any breaking changes or security implications.)

## Testing
(How to verify this works — specific commands, test scenarios, or edge cases to check)

Use imperative mood ("Add", "Fix", "Remove"). Be specific.`;

  try {
    const result = await callAI({ plan: plan as AIPlan, byokKeys, systemPrompt, userPrompt, maxTokens: 1500 });
    if (!result) return NextResponse.json({ error: "AI generation failed — no provider available" }, { status: 500 });
    return NextResponse.json({ description: result.text, model: result.model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const POST = withRouteSecurity(handler, SecurityPresets.ai);
