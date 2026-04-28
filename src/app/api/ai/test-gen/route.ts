/**
 * POST /api/ai/test-gen
 * =====================
 * Generate comprehensive test cases for any function/file.
 * Detects the testing framework in use and generates matching test code.
 * Covers: happy path, edge cases, error paths, boundary conditions.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { getUserBYOKKeys } from "@/lib/byok";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { callAI } from "@/lib/ai-providers";
import { callHuggingFace } from "@/lib/hf-inference";

export const maxDuration = 60;

interface TestGenBody {
  code: string;
  filename: string;
  language?: string;
  framework?: "jest" | "vitest" | "mocha" | "pytest" | "go-testing" | "auto";
  testType?: "unit" | "integration" | "all";
  existingTests?: string; // existing test file content to avoid duplication
  mockStrategy?: "jest-mocks" | "msw" | "manual" | "none";
}

const TESTGEN_SYSTEM = `You are GitScope's test generation engine — a test-driven development expert who writes comprehensive, maintainable test suites.

Your tests follow these principles:
- AAA pattern: Arrange (set up), Act (call the function), Assert (verify)
- Test behavior, not implementation — tests should not break if internal logic is refactored
- Cover ALL of: happy path, edge cases, error paths, boundary conditions, null/undefined inputs
- Use descriptive test names: "should throw ValidationError when email is missing"
- Group tests with describe() blocks by function or feature area
- Mock external dependencies (DB, HTTP, file system) — tests must be deterministic
- Each test is independent — no shared mutable state between tests

FRAMEWORK INSTRUCTIONS:
- Jest/Vitest: use describe/it/expect, jest.fn() or vi.fn() for mocks
- Pytest: use def test_*, pytest.raises(), monkeypatch, pytest.fixture
- Go: use func TestXxx(t *testing.T), t.Run for subtests, testify assertions

You MUST respond with valid JSON:
{
  "framework": "jest|vitest|pytest|go-testing",
  "filename": "suggested test filename",
  "imports": ["imports needed in the test file"],
  "testCode": "complete test file content",
  "testCount": N,
  "coveredCases": ["happy path", "null input", "error thrown", "..."],
  "setupInstructions": "any setup needed (install packages, config, etc.)",
  "mockedDependencies": ["list of dependencies that are mocked"]
}`;

function detectFramework(code: string, filename: string): string {
  if (filename.endsWith(".py") || code.includes("import pytest")) return "pytest";
  if (filename.endsWith(".go") || code.includes(`"testing"`)) return "go-testing";
  if (code.includes("from vitest") || code.includes("import { vi }")) return "vitest";
  if (code.includes("from jest") || code.includes("jest.fn")) return "jest";
  // Default for TS/JS
  if (filename.endsWith(".ts") || filename.endsWith(".tsx")) return "vitest";
  return "jest";
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as TestGenBody;
    const {
      code, filename, language, framework = "auto",
      testType = "unit", existingTests, mockStrategy = "jest-mocks"
    } = body;

    if (!code || code.trim().length < 10) {
      return Response.json({ error: "code is required" }, { status: 400 });
    }

    const plan = await resolveAiPlanFromSessionDb(session);
    const budget = await consumeUsageBudget({ userId: session.user.id, feature: "code-review", plan, limit: 2 });
    if (!budget.allowed) {
      return Response.json({ error: "Usage limit reached" }, { status: 429 });
    }

    const byokKeys = await getUserBYOKKeys(session.user.id);

    const resolvedFramework = framework === "auto" ? detectFramework(code, filename) : framework;

    const userPrompt = `Generate comprehensive ${testType} tests for this code.

## Source File
**Filename:** \`${filename}\`
**Language:** ${language ?? "TypeScript"}
**Framework:** ${resolvedFramework}
**Mock strategy:** ${mockStrategy}
**Test type:** ${testType}

\`\`\`${language ?? "typescript"}
${code.slice(0, 6000)}
\`\`\`

${existingTests ? `## Existing Tests (DO NOT duplicate these)\n\`\`\`\n${existingTests.slice(0, 2000)}\n\`\`\`` : ""}

Requirements:
1. Cover EVERY exported function/class
2. Include at minimum: happy path, 2+ edge cases, error/exception paths
3. ${testType === "integration" ? "Write integration tests that test the full flow including DB/HTTP interactions (mock external services)" : "Write pure unit tests with all external deps mocked"}
4. Use ${resolvedFramework} syntax exclusively
5. Generate at least ${plan === "developer" ? "15" : "6"} test cases

Return the JSON schema exactly as specified.`;

    let rawResponse: string;
    let modelUsed = "gitscope-internal";
    let providerUsed = "internal";

    const hasAnyKey = byokKeys.anthropic || byokKeys.openai || byokKeys.gemini ||
      byokKeys.groq || byokKeys.deepseek || byokKeys.mistral || byokKeys.cerebras ||
      process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.CEREBRAS_API_KEY;

    if (hasAnyKey) {
      const result = await callAI({
        plan: plan as "free" | "developer",
        systemPrompt: TESTGEN_SYSTEM,
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
        messages: [
          { role: "system", content: TESTGEN_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        maxNewTokens: 3000,
        temperature: 0.1,
      });
      rawResponse = result?.text ?? "";
      modelUsed = result?.model ?? "huggingface";
      providerUsed = "huggingface";
    }

    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]);
      return Response.json({ ...parsed, model: modelUsed, provider: providerUsed });
    } catch {
      // Return raw as testCode if JSON parsing fails
      return Response.json({
        framework: resolvedFramework,
        filename: filename.replace(/\.(ts|js|py|go)$/, ".test.$1"),
        testCode: rawResponse,
        testCount: 0,
        coveredCases: [],
        model: modelUsed,
        provider: providerUsed,
      });
    }
  } catch (err) {
    console.error("[AI TestGen]", err);
    return Response.json({ error: "Test generation failed" }, { status: 500 });
  }
}
