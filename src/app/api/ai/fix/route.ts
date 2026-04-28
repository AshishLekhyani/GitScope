/**
 * POST /api/ai/fix
 * =================
 * Generate a concrete code fix for a specific finding from a scan.
 * Returns: original snippet, fixed snippet, explanation, and a unified diff.
 * Works with all providers — quality varies by provider/plan.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { getUserBYOKKeys } from "@/lib/byok";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { callAI } from "@/lib/ai-providers";
import { callHuggingFace } from "@/lib/hf-inference";

export const maxDuration = 45;

interface FixRequestBody {
  findingTitle: string;
  findingDescription: string;
  severity: string;
  category: string;
  filename: string;
  language?: string;
  codeSnippet: string;
  fullFileContent?: string; // optional: provide full file for better context
  additionalContext?: string;
}

interface FixResponse {
  original: string;
  fixed: string;
  diff: string;
  explanation: string;
  whyItWorks: string;
  additionalSteps?: string[];
  testsToAdd?: string;
  model: string;
  provider: string;
}

const FIX_SYSTEM = `You are GitScope's automated fix generator — a senior engineer who produces production-ready code fixes.

For every fix you generate:
1. Fix ONLY the specific security/quality/performance issue described — don't refactor unrelated code
2. Preserve the existing code style (indentation, naming conventions, patterns used nearby)
3. Add inline comments ONLY where the fix logic is non-obvious
4. Return valid, compilable code — no placeholder comments like "// your code here"
5. If the fix requires imports, include them
6. If the fix requires configuration changes (env vars, etc.), note them in additionalSteps

You MUST respond with valid JSON matching this exact schema:
{
  "original": "the original vulnerable/broken code snippet (exactly as provided)",
  "fixed": "the complete fixed version of the code",
  "diff": "unified diff showing the change (--- original\\n+++ fixed format)",
  "explanation": "1-2 sentences: what the fix does",
  "whyItWorks": "2-3 sentences: the security/quality principle behind the fix",
  "additionalSteps": ["step 1 if needed", "step 2 if needed"],
  "testsToAdd": "optional: test code that verifies the fix works"
}`;

function generateSimpleDiff(original: string, fixed: string, filename: string): string {
  const origLines = original.split("\n");
  const fixedLines = fixed.split("\n");
  const lines: string[] = [`--- a/${filename}`, `+++ b/${filename}`, "@@ -1,0 +1,0 @@"];
  for (const l of origLines) lines.push(`-${l}`);
  for (const l of fixedLines) lines.push(`+${l}`);
  return lines.join("\n");
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as FixRequestBody;
    const { findingTitle, findingDescription, severity, category, filename, language, codeSnippet, fullFileContent, additionalContext } = body;

    if (!findingTitle || !codeSnippet) {
      return Response.json({ error: "findingTitle and codeSnippet are required" }, { status: 400 });
    }

    const plan = await resolveAiPlanFromSessionDb(session);
    const budget = await consumeUsageBudget({ userId: session.user.id, feature: "code-review", plan, limit: plan === "free" ? 5 : 100 });
    if (!budget.allowed) {
      return Response.json({ error: "Usage limit reached" }, { status: 429 });
    }

    const byokKeys = await getUserBYOKKeys(session.user.id);

    const hasAnyKey = byokKeys.anthropic || byokKeys.openai || byokKeys.gemini ||
      byokKeys.groq || byokKeys.deepseek || byokKeys.mistral || byokKeys.cerebras ||
      process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.CEREBRAS_API_KEY;

    const userPrompt = `Generate a production-ready fix for this ${severity}-severity ${category} finding.

## Finding
**Title:** ${findingTitle}
**Description:** ${findingDescription}
**File:** \`${filename}\`
${additionalContext ? `**Additional context:** ${additionalContext}\n` : ""}
## Code to Fix
\`\`\`${language ?? "typescript"}
${codeSnippet.slice(0, 4000)}
\`\`\`

${fullFileContent ? `## Full File Context (for reference only — fix only the specific issue above)\n\`\`\`${language ?? "typescript"}\n${fullFileContent.slice(0, 3000)}\n\`\`\`` : ""}

Respond with the JSON fix schema. Make the fix minimal and surgical — only change what's needed to address this specific finding.`;

    let rawResponse: string;
    let modelUsed = "gitscope-internal";
    let providerUsed = "internal";

    if (hasAnyKey) {
      const result = await callAI({
        plan: plan as "free" | "developer",
        systemPrompt: FIX_SYSTEM,
        userPrompt,
        maxTokens: 3000,
        byokKeys,
      });
      rawResponse = result?.text ?? "";
      modelUsed = result?.model ?? "unknown";
      providerUsed = result?.provider ?? "unknown";
    } else {
      const result = await callHuggingFace({
        tier: "code", // Use code-specialized model for fix generation
        messages: [
          { role: "system", content: FIX_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        maxNewTokens: 2000,
        temperature: 0.1,
      });
      rawResponse = result?.text ?? "";
      modelUsed = result?.model ?? "huggingface";
      providerUsed = "huggingface";
    }

    // Parse the JSON response
    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]) as Partial<FixResponse>;

      // Ensure diff is present
      if (!parsed.diff && parsed.original && parsed.fixed) {
        parsed.diff = generateSimpleDiff(parsed.original, parsed.fixed, filename);
      }

      return Response.json({
        ...parsed,
        model: modelUsed,
        provider: providerUsed,
      });
    } catch {
      // If JSON parsing fails, return raw response as explanation
      return Response.json({
        original: codeSnippet,
        fixed: rawResponse,
        diff: generateSimpleDiff(codeSnippet, rawResponse, filename),
        explanation: "Fix generated (manual parsing required)",
        whyItWorks: rawResponse,
        model: modelUsed,
        provider: providerUsed,
      });
    }
  } catch (err) {
    console.error("[AI Fix]", err);
    return Response.json({ error: "Fix generation failed" }, { status: 500 });
  }
}
