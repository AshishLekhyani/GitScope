/**
 * POST /api/ai/security-deep
 * ===========================
 * Deep multi-agent security analysis using the full agent orchestration system.
 * The Security Agent uses actual tool_use to search the code before making claims.
 * Streams progress as SSE. Enterprise gets parallel specialist agents.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { getUserBYOKKeys } from "@/lib/byok";
import { runAgentOrchestrator, SECURITY_AGENT, DEPENDENCY_AGENT, SUPERVISOR_AGENT, buildScanAgentTeam } from "@/lib/ai-agents";
import { callHuggingFace } from "@/lib/hf-inference";

export const maxDuration = 120;

interface SecurityDeepBody {
  repo: string;
  files: Record<string, string>; // filename → content
  githubToken?: string;
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: unknown) => controller.enqueue(encoder.encode(sse(data)));
      const done = (result?: unknown, error?: string) => {
        emit({ type: "done", result, error });
        controller.close();
      };

      try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) { done(undefined, "Unauthorized"); return; }

        const body = (await req.json()) as SecurityDeepBody;
        const { repo, files } = body;
        if (!repo || !files || Object.keys(files).length === 0) {
          done(undefined, "repo and files are required"); return;
        }

        const plan = await resolveAiPlanFromSessionDb(session);
        const budget = await consumeUsageBudget({ userId: session.user.id, feature: "security-scan", plan, limit: 5 });
        if (!budget.allowed) { done(undefined, "Usage limit reached"); return; }

        const byokKeys = await getUserBYOKKeys(session.user.id);

        const hasAnyKey = byokKeys.anthropic || byokKeys.openai || byokKeys.gemini ||
          byokKeys.groq || byokKeys.cerebras || byokKeys.deepseek || byokKeys.mistral ||
          process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY ||
          process.env.GROQ_API_KEY || process.env.CEREBRAS_API_KEY;

        const fileList = Object.keys(files).map((f) => `- ${f} (${files[f].length} chars)`).join("\n");
        const basePrompt = `Perform a comprehensive security analysis of the GitHub repository **${repo}**.

## Files Available for Analysis
${fileList}

## Your Mission
1. Use your search_code tool to find specific security patterns BEFORE flagging them
2. Use check_dependency to verify CVEs in any packages you find in package.json
3. Use list_api_routes to audit the full API surface
4. Flag ONLY issues you can verify exist in the actual code
5. Provide complete, actionable remediation for every finding

Do not hallucinate — every finding must be grounded in evidence from the actual code.`;

        const toolCtx = { repo, fileContents: files };

        // ── With API keys: use full multi-agent system ───────────────────────
        if (hasAnyKey) {
          const isDeveloper = plan === "developer";
          const agents = isDeveloper
            ? [SECURITY_AGENT, DEPENDENCY_AGENT]
            : [SECURITY_AGENT];

          const result = await runAgentOrchestrator(
            {
              plan: plan as "free" | "developer",
              byokKeys,
              agents,
              supervisor: isDeveloper ? SUPERVISOR_AGENT : undefined,
              mode: isDeveloper ? "parallel" : "sequential",
              onProgress: (step, agentName, pct) => {
                emit({ type: "progress", step, agent: agentName, percent: pct });
              },
            },
            basePrompt,
            toolCtx
          );

          done({
            repo,
            agentResults: result.agentResults.map((r) => ({
              agentName: r.agentName,
              output: r.output,
              parsedOutput: r.parsedOutput,
              toolCallCount: r.toolCallCount,
              durationMs: r.durationMs,
              provider: r.provider,
              model: r.model,
            })),
            finalOutput: result.finalOutput,
            parsedFinal: result.parsedFinal,
            totalTokens: result.totalTokens,
            totalDurationMs: result.totalDurationMs,
            providers: result.providers,
            mode: isDeveloper ? "multi-agent-parallel" : "single-agent",
          });
        }

        // ── Without keys: use HuggingFace ─────────────────────────────────────
        else {
          emit({ type: "progress", step: "Using GitScope Free AI…", agent: "Security Agent", percent: 20 });
          const result = await callHuggingFace({
            tier: "balanced",
            messages: [
              { role: "system", content: SECURITY_AGENT.systemPrompt },
              { role: "user", content: basePrompt + "\n\nRespond with the JSON security report schema." },
            ],
            maxNewTokens: 2048,
            temperature: 0.1,
            apiKey: byokKeys.huggingface ?? undefined,
          });

          let parsedFinal: Record<string, unknown> | undefined;
          try {
            const jsonMatch = result?.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsedFinal = JSON.parse(jsonMatch[0]);
          } catch { /* fine */ }

          done({
            repo,
            agentResults: [{
              agentName: "Security Agent (Free AI)",
              output: result?.text ?? "",
              parsedOutput: parsedFinal,
              toolCallCount: 0,
              provider: "huggingface",
              model: result?.model ?? "Mistral-7B",
            }],
            finalOutput: result?.text ?? "",
            parsedFinal,
            providers: ["huggingface"],
            mode: "single-agent-free",
            note: "Add an API key in Settings → API Keys for multi-agent analysis with tool use.",
          });
        }
      } catch (err) {
        console.error("[Security Deep]", err);
        done(undefined, err instanceof Error ? err.message : "Analysis failed");
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
