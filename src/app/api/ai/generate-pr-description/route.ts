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

async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await resolveAiPlanFromSessionDb(session);
  if (plan === "free") {
    return NextResponse.json({ error: "PR description generation requires Professional plan or higher." }, { status: 403 });
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
        diff = files.slice(0, 20).map((f) =>
          `${f.status.toUpperCase()} ${f.filename} (+${f.additions}/-${f.deletions})\n${(f.patch ?? "").slice(0, 400)}`
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
          .slice(0, 20)
          .map((f) => `${f.status.toUpperCase()} ${f.filename} (+${f.additions}/-${f.deletions})\n${(f.patch ?? "").slice(0, 300)}`)
          .join("\n\n");
      }
    }
  } catch {
    return NextResponse.json({ error: "Failed to fetch PR data from GitHub" }, { status: 502 });
  }

  if (commits.length === 0 && !diff) {
    return NextResponse.json({ error: "No commits or diff found. Ensure the branch has changes against the base." }, { status: 404 });
  }

  const systemPrompt = `You are a senior software engineer who writes clear, professional GitHub pull request descriptions. Be concise, factual, and base everything on the actual diff provided. Do not invent changes that aren't in the diff.`;

  const userPrompt = `Repository: ${repo}
${existingTitle ? `PR Title: ${existingTitle}` : ""}
${prNumber ? `PR #${prNumber}` : `Comparing: ${baseBranch}...${headBranch}`}

Commits (${commits.length}):
${commits.map((c) => `• ${c.sha} ${c.message}`).join("\n")}

Changed files (sample):
${diff.slice(0, 3000)}

Write a concise PR description in Markdown with these exact sections:
## Summary
(2-4 bullet points — what was changed and why)

## Changes
(key technical changes, grouped by concern)

## Testing
(how to verify this works)

Use imperative mood. No fluff.`;

  try {
    const result = await callAI({ plan: plan as AIPlan, systemPrompt, userPrompt, maxTokens: 1024 });
    if (!result) return NextResponse.json({ error: "AI generation failed — no provider available" }, { status: 500 });
    return NextResponse.json({ description: result.text, model: result.model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const POST = withRouteSecurity(handler, SecurityPresets.ai);
