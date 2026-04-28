/**
 * POST /api/ai/refactor
 * ======================
 * Suggest and apply refactoring to improve code quality, readability,
 * and maintainability. Returns before/after with explanation.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { getUserBYOKKeys } from "@/lib/byok";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { callAI } from "@/lib/ai-providers";
import { callHuggingFace } from "@/lib/hf-inference";

export const maxDuration = 45;

interface RefactorBody {
  code: string;
  filename: string;
  language?: string;
  goal?: "readability" | "performance" | "dry" | "solid" | "testability" | "all";
  preserveSignature?: boolean; // don't change public API
  aggressiveness?: "conservative" | "moderate" | "aggressive";
}

const REFACTOR_SYSTEM = `You are GitScope's refactoring assistant — a principal engineer who improves code quality without changing external behavior.

Refactoring principles you apply:
- DRY: extract repeated logic into shared functions/constants
- SRP: split functions/classes that do too many things
- Naming: rename vague names (tmp, data, result) to descriptive ones
- Complexity: break up functions with cyclomatic complexity > 10
- Early returns: reduce nesting with guard clauses
- Pure functions: isolate side effects to the edges, keep core logic pure
- Type safety: add missing TypeScript types, remove 'any'
- Error handling: replace silent catches with proper error propagation

CRITICAL: You MUST preserve all existing behavior. The refactored code must be 100% functionally equivalent.

Respond with valid JSON:
{
  "original": "original code as provided",
  "refactored": "complete refactored version",
  "diff": "unified diff (--- original\\n+++ refactored)",
  "changes": [
    {
      "type": "extract-function|rename|simplify|dry|type-safety|error-handling|...",
      "description": "what was changed and why",
      "linesAffected": "approximate line range"
    }
  ],
  "improvements": {
    "linesReduced": N,
    "complexityReduction": "estimated % reduction",
    "readabilityGain": "high|medium|low"
  },
  "breakingChanges": false,
  "notes": "any caveats or things the developer should review"
}`;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as RefactorBody;
    const {
      code, filename, language,
      goal = "all",
      preserveSignature = true,
      aggressiveness = "moderate"
    } = body;

    if (!code || code.trim().length < 10) {
      return Response.json({ error: "code is required" }, { status: 400 });
    }

    const plan = await resolveAiPlanFromSessionDb(session);
    const budget = await consumeUsageBudget({ userId: session.user.id, feature: "code-review", plan, limit: 2 });
    if (!budget.allowed) return Response.json({ error: "Usage limit reached" }, { status: 429 });

    const byokKeys = await getUserBYOKKeys(session.user.id);

    const userPrompt = `Refactor this code with the following constraints.

**File:** \`${filename}\`
**Language:** ${language ?? "TypeScript"}
**Refactoring goal:** ${goal === "all" ? "comprehensive quality improvement" : goal}
**Aggressiveness:** ${aggressiveness} (${aggressiveness === "conservative" ? "minimal changes, low risk" : aggressiveness === "moderate" ? "meaningful improvements, medium risk" : "substantial restructuring, verify carefully"})
**Preserve public API:** ${preserveSignature ? "YES — do not rename exported symbols or change function signatures" : "NO — API changes are acceptable if they improve the design"}

\`\`\`${language ?? "typescript"}
${code.slice(0, 6000)}
\`\`\`

Focus on: ${goal === "all" ? "DRY, readability, complexity reduction, type safety, error handling" : goal}
Return the complete JSON schema.`;

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
        systemPrompt: REFACTOR_SYSTEM,
        userPrompt,
        maxTokens: 5000,
        byokKeys,
      });
      rawResponse = result?.text ?? "";
      modelUsed = result?.model ?? "unknown";
      providerUsed = result?.provider ?? "unknown";
    } else {
      const result = await callHuggingFace({
        tier: "code",
        messages: [{ role: "system", content: REFACTOR_SYSTEM }, { role: "user", content: userPrompt }],
        maxNewTokens: 3000,
        temperature: 0.15,
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
      return Response.json({
        original: code,
        refactored: rawResponse,
        diff: "",
        changes: [],
        improvements: { linesReduced: 0, complexityReduction: "unknown", readabilityGain: "unknown" },
        model: modelUsed,
        provider: providerUsed,
      });
    }
  } catch (err) {
    console.error("[AI Refactor]", err);
    return Response.json({ error: "Refactor failed" }, { status: 500 });
  }
}
