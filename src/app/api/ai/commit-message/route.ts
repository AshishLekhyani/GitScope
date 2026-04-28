/**
 * POST /api/ai/commit-message
 * ============================
 * Generate conventional commit messages from a diff or description.
 * Supports: Conventional Commits, Angular, Semantic, or free-form styles.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { getUserBYOKKeys } from "@/lib/byok";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { callAI } from "@/lib/ai-providers";
import { callHuggingFace } from "@/lib/hf-inference";

export const maxDuration = 20;

interface CommitMsgBody {
  diff?: string;
  description?: string;
  changedFiles?: string[];
  style?: "conventional" | "angular" | "semantic" | "free";
  scope?: string;
  count?: number; // how many alternatives to generate (1-5)
}

const COMMIT_SYSTEM = `You are a commit message expert. Generate precise, conventional commit messages that explain WHY the change was made, not just what changed.

Conventional Commits format:
<type>(<scope>): <description>

[optional body: more detail in imperative mood]

[optional footer: BREAKING CHANGE, Closes #issue]

Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

Rules:
- Subject line: 50 chars max, imperative mood ("add" not "added"), no period at end
- Body: wrapped at 72 chars, explains motivation and context
- Be specific: "fix: handle null user in auth middleware" not "fix: bug fix"

Respond with valid JSON:
{
  "messages": [
    {
      "subject": "feat(auth): add OAuth2 PKCE flow for SPA clients",
      "body": "Implements PKCE (Proof Key for Code Exchange) extension...",
      "footer": "Closes #142",
      "type": "feat",
      "scope": "auth",
      "breaking": false
    }
  ]
}`;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as CommitMsgBody;
    const { diff, description, changedFiles, style = "conventional", scope, count = 3 } = body;

    if (!diff && !description) {
      return Response.json({ error: "Either diff or description is required" }, { status: 400 });
    }

    const plan = await resolveAiPlanFromSessionDb(session);
    const budget = await consumeUsageBudget({ userId: session.user.id, feature: "repo-analysis", plan, limit: plan === "free" ? 10 : 100 });
    if (!budget.allowed) return Response.json({ error: "Usage limit reached" }, { status: 429 });

    const byokKeys = await getUserBYOKKeys(session.user.id);

    const userPrompt = `Generate ${count} ${style} commit message alternative(s) for this change.
${scope ? `Suggested scope: ${scope}` : ""}
${changedFiles?.length ? `Changed files: ${changedFiles.slice(0, 10).join(", ")}` : ""}

${description ? `## Developer's description\n${description}\n` : ""}
${diff ? `## Diff (first 3000 chars)\n\`\`\`diff\n${diff.slice(0, 3000)}\n\`\`\`` : ""}

Return the JSON schema with ${count} message option(s). Make each option meaningfully different.`;

    const hasAnyKey = byokKeys.anthropic || byokKeys.openai || byokKeys.gemini ||
      byokKeys.groq || byokKeys.deepseek || byokKeys.mistral || byokKeys.cerebras ||
      process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.CEREBRAS_API_KEY;

    let rawResponse: string;
    let modelUsed = "huggingface";
    let providerUsed = "huggingface";

    if (hasAnyKey) {
      const result = await callAI({
        plan: plan as "free" | "developer",
        systemPrompt: COMMIT_SYSTEM,
        userPrompt,
        maxTokens: 1200,
        byokKeys,
      });
      rawResponse = result?.text ?? "";
      modelUsed = result?.model ?? "unknown";
      providerUsed = result?.provider ?? "unknown";
    } else {
      const result = await callHuggingFace({
        tier: "balanced",
        messages: [{ role: "system", content: COMMIT_SYSTEM }, { role: "user", content: userPrompt }],
        maxNewTokens: 600,
        temperature: 0.5,
        apiKey: byokKeys.huggingface ?? undefined,
      });
      rawResponse = result?.text ?? "";
      modelUsed = result?.model ?? "huggingface";
    }

    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON");
      const parsed = JSON.parse(jsonMatch[0]);
      return Response.json({ ...parsed, model: modelUsed, provider: providerUsed });
    } catch {
      // Fallback: parse the text as a simple message
      const firstLine = rawResponse.split("\n")[0]?.trim() ?? "chore: update code";
      return Response.json({
        messages: [{ subject: firstLine, body: "", footer: "", type: "chore", breaking: false }],
        model: modelUsed,
        provider: providerUsed,
      });
    }
  } catch (err) {
    console.error("[Commit Message]", err);
    return Response.json({ error: "Failed to generate commit message" }, { status: 500 });
  }
}
