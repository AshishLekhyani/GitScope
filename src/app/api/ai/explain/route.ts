/**
 * POST /api/ai/explain
 * =====================
 * Explain any piece of code — what it does, how it works, why it's designed
 * this way, and what edge cases / risks exist. Works with all providers.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { getUserBYOKKeys } from "@/lib/byok";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { callAI } from "@/lib/ai-providers";
import { callHuggingFace } from "@/lib/hf-inference";

export const maxDuration = 30;

interface ExplainBody {
  code: string;
  language?: string;
  filename?: string;
  question?: string; // specific question to answer about the code
  depth?: "brief" | "normal" | "deep"; // how detailed the explanation should be
}

const EXPLAIN_SYSTEM = `You are GitScope's code explanation engine — an expert engineer who can read any code and explain it clearly to developers at all levels.

Your explanations follow this structure:
1. **What it does** (1-2 sentences, plain English)
2. **How it works** (step-by-step walkthrough of the logic)
3. **Key design decisions** (why it's written this way)
4. **Edge cases & risks** (what could go wrong, what assumptions are made)
5. **Improvement suggestions** (optional: 1-3 concrete ways to make it better)

Rules:
- Reference specific variable/function names from the code
- Use code snippets to illustrate points
- Match explanation depth to the 'depth' parameter (brief=3-4 sentences, normal=full structure, deep=comprehensive with examples)
- Never be vague — every statement should be grounded in the actual code shown`;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as ExplainBody;
    const { code, language, filename, question, depth = "normal" } = body;

    if (!code || code.trim().length < 5) {
      return Response.json({ error: "code is required" }, { status: 400 });
    }

    const plan = await resolveAiPlanFromSessionDb(session);
    const budget = await consumeUsageBudget({ userId: session.user.id, feature: "repo-analysis", plan, limit: plan === "free" ? 10 : 100 });
    if (!budget.allowed) {
      return Response.json({ error: "Usage limit reached" }, { status: 429 });
    }

    const byokKeys = await getUserBYOKKeys(session.user.id);

    const hasAnyKey = byokKeys.anthropic || byokKeys.openai || byokKeys.gemini ||
      byokKeys.groq || byokKeys.deepseek || byokKeys.mistral || byokKeys.cerebras ||
      process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.CEREBRAS_API_KEY;

    const userPrompt = `${filename ? `File: \`${filename}\`\n` : ""}${language ? `Language: ${language}\n` : ""}Explanation depth: ${depth}

${question ? `Specific question: ${question}\n\n` : ""}## Code to Explain
\`\`\`${language ?? ""}
${code.slice(0, 8000)}
\`\`\`

Provide a clear, engineer-grade explanation following the structure in your instructions. ${question ? `Focus particularly on answering: "${question}"` : ""}`;

    let explanation: string;

    if (hasAnyKey) {
      const result = await callAI({
        plan: plan as "free" | "developer",
        systemPrompt: EXPLAIN_SYSTEM,
        userPrompt,
        maxTokens: depth === "deep" ? 3000 : depth === "brief" ? 600 : 1500,
        byokKeys,
      });
      explanation = result?.text ?? "";
    } else {
      // HuggingFace fallback
      const result = await callHuggingFace({
        tier: "balanced",
        messages: [
          { role: "system", content: EXPLAIN_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        maxNewTokens: depth === "deep" ? 2000 : depth === "brief" ? 400 : 1000,
      });
      explanation = result?.text ?? "Could not generate explanation. Add an API key in Settings for better results.";
    }

    return Response.json({
      explanation,
      filename: filename ?? null,
      language: language ?? null,
      depth,
      question: question ?? null,
    });
  } catch (err) {
    console.error("[AI Explain]", err);
    return Response.json({ error: "Explanation failed" }, { status: 500 });
  }
}
