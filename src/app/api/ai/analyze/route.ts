import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";
import { callAI, hasAnyAIProvider } from "@/lib/ai-providers";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import type { AIPlan } from "@/lib/ai-providers";

interface RepoSummary {
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  topics: string[];
  recentCommitMessages: string[];
}

async function fetchRepoSummary(fullName: string, token: string): Promise<RepoSummary | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const [repoRes, commitsRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${fullName}`, {
      headers,
      next: { revalidate: 300 },
    }),
    fetch(`https://api.github.com/repos/${fullName}/commits?per_page=10`, {
      headers,
      next: { revalidate: 300 },
    }),
  ]);

  if (!repoRes.ok) return null;

  const repo = await repoRes.json();
  const commits = commitsRes.ok ? await commitsRes.json() : [];
  const recentCommitMessages: string[] = Array.isArray(commits)
    ? commits
        .slice(0, 5)
        .map((c: { commit: { message: string } }) => c.commit.message.split("\n")[0])
    : [];

  return {
    name: repo.full_name,
    description: repo.description,
    language: repo.language,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    topics: repo.topics ?? [],
    recentCommitMessages,
  };
}

async function handler(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!hasAnyAIProvider()) {
    return NextResponse.json(
      { error: "AI analysis not configured — no AI provider keys set" },
      { status: 503 }
    );
  }

  const plan = await resolveAiPlanFromSessionDb(session) as AIPlan;

  let body: { repo?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { repo, question } = body;
  if (!repo || typeof repo !== "string") {
    return NextResponse.json(
      { error: "repo field required (e.g. 'owner/repo')" },
      { status: 400 }
    );
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "Invalid repo format" }, { status: 400 });
  }

  const token = await getGitHubToken();
  const repoData = await fetchRepoSummary(repo, token ?? "");
  if (!repoData) {
    return NextResponse.json({ error: "Repository not found or inaccessible" }, { status: 404 });
  }

  const systemPrompt =
    "You are GitScope's AI analyst. Sound like a strong senior teammate: clear, practical, and human. Focus on engineering health, code quality signals, maintenance patterns, and concrete recommendations.";

  const userPrompt = question
    ? `Analyze the GitHub repository "${repoData.name}" and answer: ${question}

Repository context:
- Description: ${repoData.description ?? "None"}
- Primary language: ${repoData.language ?? "Unknown"}
- Stars: ${repoData.stars.toLocaleString()}, Forks: ${repoData.forks.toLocaleString()}, Open issues: ${repoData.openIssues}
- Topics: ${repoData.topics.join(", ") || "None"}
- Recent commit messages: ${repoData.recentCommitMessages
        .map((m, i) => `${i + 1}. "${m}"`)
        .join("; ") || "None available"}

Answer the specific question with technical depth in plain, human language. Keep it under 200 words.`
    : `Provide an engineering health readout for the GitHub repository "${repoData.name}".

Repository data:
- Description: ${repoData.description ?? "None"}
- Primary language: ${repoData.language ?? "Unknown"}
- Stars: ${repoData.stars.toLocaleString()}, Forks: ${repoData.forks.toLocaleString()}, Open issues: ${repoData.openIssues}
- Topics: ${repoData.topics.join(", ") || "None"}
- Recent commit messages: ${repoData.recentCommitMessages
        .map((m, i) => `${i + 1}. "${m}"`)
        .join("; ") || "None available"}

Provide:
1. Health Score (0-100) with one-line justification
2. Strengths (2-3 bullet points)
3. Risk Signals (2-3 bullet points)
4. Top Recommendation (1-2 sentences)

Keep the total response under 300 words. Be specific, technical, and easy to understand.`;

  try {
    const result = await callAI({
      plan,
      systemPrompt,
      userPrompt,
      maxTokens: 512,
    });

    if (!result) {
      return NextResponse.json({ error: "AI analysis failed — no provider available" }, { status: 500 });
    }

    return NextResponse.json({
      analysis: result.text,
      repo: repoData.name,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[AI analyze]", err);
    }
    return NextResponse.json({ error: "AI analysis failed" }, { status: 500 });
  }
}

// Apply security middleware with AI preset (rate limiting for expensive operations)
export const POST = withRouteSecurity(handler, SecurityPresets.ai);
