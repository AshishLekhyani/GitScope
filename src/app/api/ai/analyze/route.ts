import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";
import { callAI, hasAnyAIProvider } from "@/lib/ai-providers";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { getUserBYOKKeys } from "@/lib/byok";
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

interface RepoSummaryExtended extends RepoSummary {
  fileTree?: string[];
  keyFileContents?: Record<string, string>;
}

async function fetchRepoSummary(fullName: string, token: string): Promise<RepoSummaryExtended | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const ghGet = async (path: string) => {
    const res = await fetch(`https://api.github.com${path}`, { headers, next: { revalidate: 300 } });
    return res.ok ? res.json() : null;
  };
  const ghText = async (path: string) => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { ...headers, Accept: "application/vnd.github.raw+json" },
      next: { revalidate: 300 },
    });
    return res.ok ? res.text() : null;
  };

  const [repoRaw, commitsRaw, treeRaw] = await Promise.all([
    ghGet(`/repos/${fullName}`),
    ghGet(`/repos/${fullName}/commits?per_page=10`),
    ghGet(`/repos/${fullName}/git/trees/HEAD?recursive=1`),
  ]);

  if (!repoRaw) return null;

  const recentCommitMessages: string[] = Array.isArray(commitsRaw)
    ? commitsRaw.slice(0, 8).map((c: { commit: { message: string; author?: { name: string } } }) =>
        `[${c.commit.author?.name ?? "Unknown"}] ${c.commit.message.split("\n")[0]}`)
    : [];

  // Build file tree
  const allPaths: string[] = Array.isArray(treeRaw?.tree)
    ? (treeRaw.tree as { path: string; type: string }[]).filter((t) => t.type === "blob").map((t) => t.path)
    : [];

  // Read a few key files for richer AI context
  const HIGH_SIGNAL = /package\.json|readme|auth|middleware|main\.|index\.|server\.|prisma/i;
  const EXCLUDE = /node_modules|\.next|dist\/|\.min\.js|\.d\.ts$/;
  const filesToRead = allPaths.filter((p) => HIGH_SIGNAL.test(p) && !EXCLUDE.test(p)).slice(0, 8);
  const keyFileContents: Record<string, string> = {};
  await Promise.all(
    filesToRead.map(async (f) => {
      const content = await ghText(`/repos/${fullName}/contents/${f}`);
      if (content) keyFileContents[f] = content.slice(0, 3000);
    })
  );

  return {
    name: repoRaw.full_name,
    description: repoRaw.description,
    language: repoRaw.language,
    stars: repoRaw.stargazers_count,
    forks: repoRaw.forks_count,
    openIssues: repoRaw.open_issues_count,
    topics: repoRaw.topics ?? [],
    recentCommitMessages,
    fileTree: allPaths.slice(0, 150),
    keyFileContents,
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
  const byokKeys = session.user.id ? await getUserBYOKKeys(session.user.id) : undefined;

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

  const systemPrompt = `You are GitScope's principal AI engineering advisor — a staff-level engineer with expertise across security, architecture, performance, and code quality. You give precise, evidence-based analysis grounded in the actual code and commit history provided.

RULES:
1. Ground every claim in the file contents or commit history provided — no speculation.
2. Name exact files, functions, and patterns. "hashPassword() in lib/auth.ts uses MD5" not "weak hashing detected".
3. When writing code fixes, show complete, production-ready snippets — never pseudocode.
4. Be concise: no filler, no re-stating the question, no bullet points that say nothing.`;

  const fileTreeSection = repoData.fileTree && repoData.fileTree.length > 0
    ? `\n## File Tree (${repoData.fileTree.length} files)\n${repoData.fileTree.slice(0, 100).join("\n")}`
    : "";

  const keyFilesSection = repoData.keyFileContents && Object.keys(repoData.keyFileContents).length > 0
    ? `\n## Key File Contents\n` + Object.entries(repoData.keyFileContents)
        .map(([name, content]) => `### ${name}\n\`\`\`\n${content}\n\`\`\``)
        .join("\n")
    : "";

  const repoBlock = `## Repository: ${repoData.name}
Description: ${repoData.description ?? "None"}
Language: ${repoData.language ?? "Unknown"} | Stars: ${repoData.stars.toLocaleString()} | Forks: ${repoData.forks.toLocaleString()} | Open issues: ${repoData.openIssues}
Topics: ${repoData.topics.join(", ") || "None"}

## Recent Commits
${repoData.recentCommitMessages.map((m, i) => `${i + 1}. ${m}`).join("\n") || "None available"}
${fileTreeSection}
${keyFilesSection}`;

  const userPrompt = question
    ? `Analyze the GitHub repository "${repoData.name}" and answer this question: ${question}

${repoBlock}

Answer with technical depth, citing specific files and patterns from the code above. Under 250 words.`
    : `Provide an engineering health readout for the GitHub repository "${repoData.name}".

${repoBlock}

Provide:
1. **Health Score** (0-100) with one-line justification tied to the actual code
2. **Strengths** (2-3 bullet points citing specific files or patterns)
3. **Risk Signals** (2-3 bullet points citing specific code evidence)
4. **Top Recommendation** (specific action with a code snippet if applicable)

Under 350 words. Be specific and evidence-based.`;

  try {
    const result = await callAI({
      plan,
      byokKeys,
      systemPrompt,
      userPrompt,
      maxTokens: 1024,
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
