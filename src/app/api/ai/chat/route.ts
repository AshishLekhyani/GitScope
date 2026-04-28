/**
 * POST /api/ai/chat
 * =================
 * Conversational AI about any GitHub repository.
 * Maintains per-repo conversation history with sliding context window.
 * Streams responses as Server-Sent Events.
 *
 * Provider priority: Anthropic → OpenAI → Gemini → Groq → Cerebras → DeepSeek → Mistral → HuggingFace
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import { consumeUsageBudget } from "@/lib/ai-usage";
import { getUserBYOKKeys } from "@/lib/byok";
import {
  loadConversation,
  appendMessages,
  clearConversation,
  buildChatSystemPrompt,
  sessionToProviderMessages,
} from "@/lib/ai-memory";
import { loadRepoKnowledge, formatKnowledgeForPrompt } from "@/lib/repo-knowledge";
import { getGitHubTokenWithSource } from "@/lib/github-auth";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { callHuggingFace } from "@/lib/hf-inference";

export const maxDuration = 60;

interface ChatRequestBody {
  repo: string;
  message: string;
  repoContext?: string;
  clear?: boolean;
  effort?: "quick" | "balanced" | "thorough" | "maximum";
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function pickModels(plan: string, effort: string) {
  const isPaid = plan !== "free";
  const isHigh = effort === "thorough" || effort === "maximum";
  return {
    anthropic: isHigh && isPaid ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001",
    openai: isHigh && isPaid ? "gpt-4o" : "gpt-4o-mini",
    gemini: isHigh && isPaid ? "gemini-2.0-flash" : "gemini-1.5-flash",
    groq: isHigh ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant",
    cerebras: "llama3.1-8b",
    deepseek: "deepseek-chat",
    mistral: isHigh && isPaid ? "mistral-large-latest" : "mistral-small-latest",
  };
}

function maxTokensForEffort(effort: string): number {
  switch (effort) {
    case "quick":    return 1024;
    case "thorough": return 8192;
    case "maximum":  return 16000;
    default:         return 4096;
  }
}

function trimMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.65);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n\n[GitScope trimmed chat context to fit this provider]\n\n${text.slice(-tail)}`;
}

function fitChatMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxChars: number
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const next = [...messages];
  let total = next.reduce((sum, msg) => sum + (typeof msg.content === "string" ? msg.content.length : 0), 0);
  for (let i = 1; i < next.length - 1 && total > maxChars; i++) {
    const content = next[i].content;
    if (typeof content !== "string") continue;
    const trimmed = trimMiddle(content, Math.max(400, Math.floor(content.length * 0.5)));
    next[i] = { ...next[i], content: trimmed };
    total -= content.length - trimmed.length;
  }
  if (total > maxChars && typeof next[0]?.content === "string") {
    next[0] = { ...next[0], content: trimMiddle(next[0].content, Math.max(2_000, maxChars - 4_000)) };
  }
  return next;
}

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: unknown) => controller.enqueue(encoder.encode(sse(data)));
      const done = (text?: string, error?: string) => {
        emit({ type: "done", text, error });
        controller.close();
      };

      try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) { done(undefined, "Unauthorized"); return; }

        const body = (await req.json()) as ChatRequestBody;
        const { repo, message, repoContext, clear, effort = "balanced" } = body;

        if (!repo || typeof repo !== "string") { done(undefined, "repo is required"); return; }

        if (clear) {
          await clearConversation(repo, session.user.id);
          done("Conversation cleared.");
          return;
        }

        if (!message || typeof message !== "string" || message.trim().length < 2) {
          done(undefined, "message is required"); return;
        }

        const plan = await resolveAiPlanFromSessionDb(session);
        const byokKeys = await getUserBYOKKeys(session.user.id);

        const chatLimit = plan === "free" ? 10 : 200;
        const budget = await consumeUsageBudget({ userId: session.user.id, feature: "ai-chat", plan, limit: chatLimit });
        if (!budget.allowed) {
          const resetInMin = budget.resetAt ? Math.ceil((budget.resetAt - Date.now()) / 60000) : 0;
          done(undefined, `Usage limit reached. ${resetInMin > 0 ? `Resets in ${resetInMin} min.` : "Upgrade your plan for more."}`);
          return;
        }

        emit({ type: "status", step: "Loading conversation history…" });
        const conversation = await loadConversation(repo, session.user.id);

        // Auto-build repo context from: (1) user-provided, (2) prior scan knowledge, (3) live GitHub metadata
        const enrichedContext = repoContext ?? conversation.repoContext ?? "";

        // Load cached scan knowledge from prior repo scans
        const scanKnowledge = await loadRepoKnowledge(session.user.id, repo).catch(() => null);

        // Fetch live GitHub metadata to ground the AI in real repo data
        let githubMetaBlock = "";
        try {
          const { token: ghToken } = await getGitHubTokenWithSource({ session });
          const ghHeaders: Record<string, string> = {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(ghToken ? { Authorization: `Bearer ${ghToken}` } : {}),
          };
          const ghFetch = async (path: string) => {
            const res = await fetch(`https://api.github.com${path}`, { headers: ghHeaders, next: { revalidate: 0 } });
            return res.ok ? res.json() : null;
          };

          const [metaRaw, commitsRaw, treeRaw] = await Promise.all([
            ghFetch(`/repos/${repo}`),
            ghFetch(`/repos/${repo}/commits?per_page=8`),
            ghFetch(`/repos/${repo}/git/trees/HEAD?recursive=1`),
          ]);

          if (metaRaw) {
            const recentCommits = (Array.isArray(commitsRaw) ? commitsRaw : [])
              .slice(0, 8)
              .map((c: { commit: { message: string; author: { name: string } } }, i: number) =>
                `${i + 1}. [${c.commit.author?.name ?? "Unknown"}] ${c.commit.message.split("\n")[0].slice(0, 90)}`
              )
              .join("\n");

            // Top-level file tree (dirs + key files) so AI knows the structure
            const allPaths: string[] = Array.isArray(treeRaw?.tree)
              ? (treeRaw.tree as { path: string; type: string }[])
                  .filter((t) => t.type === "blob")
                  .map((t) => t.path)
                  .slice(0, 300)
              : [];

            // Highlight config + high-signal files
            const HIGH_SIGNAL = /auth|api[/\\]|\/lib\/|middleware|index\.|server\.|app\.|router|database|prisma|model|service|config|env/i;
            const EXCLUDE = /node_modules|\.next|dist\/|build\/|\.min\.js|\.d\.ts$/;
            const keyFiles = allPaths.filter((p) => HIGH_SIGNAL.test(p) && !EXCLUDE.test(p)).slice(0, 40);
            const otherFiles = allPaths.filter((p) => !HIGH_SIGNAL.test(p) && !EXCLUDE.test(p)).slice(0, 60);

            githubMetaBlock = [
              `### Live GitHub Metadata`,
              `Repo: ${metaRaw.full_name} | Language: ${metaRaw.language ?? "Unknown"} | Stars: ${metaRaw.stargazers_count ?? 0} | Forks: ${metaRaw.forks_count ?? 0}`,
              `Open Issues: ${metaRaw.open_issues_count ?? 0} | Default Branch: ${metaRaw.default_branch ?? "main"}`,
              metaRaw.description ? `Description: ${metaRaw.description}` : "",
              metaRaw.topics?.length ? `Topics: ${(metaRaw.topics as string[]).join(", ")}` : "",
              ``,
              `### Recent Commits`,
              recentCommits || "(none available)",
              ``,
              keyFiles.length > 0 ? `### Key Source Files (high-signal paths)\n${keyFiles.join("\n")}` : "",
              otherFiles.length > 0 ? `\n### Other Files (sample)\n${otherFiles.join("\n")}` : "",
            ].filter(Boolean).join("\n");
          }
        } catch {
          // GitHub fetch failed — proceed without live metadata
        }

        // Assemble the final context block
        const contextParts: string[] = [];
        if (githubMetaBlock) contextParts.push(githubMetaBlock);
        if (scanKnowledge) contextParts.push(formatKnowledgeForPrompt(scanKnowledge));
        if (enrichedContext) contextParts.push(`### Additional Context (user-provided)\n${enrichedContext}`);
        const finalContext = contextParts.join("\n\n") || undefined;

        const systemPrompt = buildChatSystemPrompt(repo, finalContext);
        const history = sessionToProviderMessages(conversation);
        const models = pickModels(plan, effort);
        const maxTokens = maxTokensForEffort(effort);

        // Resolve which keys to actually use
        const anthropicKey = byokKeys.anthropic ?? process.env.ANTHROPIC_API_KEY;
        const openaiKey    = byokKeys.openai    ?? process.env.OPENAI_API_KEY;
        const geminiKey    = byokKeys.gemini    ?? process.env.GEMINI_API_KEY;
        const groqKey      = byokKeys.groq      ?? process.env.GROQ_API_KEY;
        const cerebrasKey  = byokKeys.cerebras  ?? process.env.CEREBRAS_API_KEY;
        const deepseekKey  = byokKeys.deepseek  ?? process.env.DEEPSEEK_API_KEY;
        const mistralKey   = byokKeys.mistral   ?? process.env.MISTRAL_API_KEY;

        emit({ type: "status", step: "Thinking…" });

        let assistantText = "";

        // Helper: OpenAI-compatible streaming (works for OpenAI, Groq, Gemini, Cerebras, DeepSeek, Mistral)
        async function streamOpenAICompat(
          client: OpenAI,
          model: string,
          options?: { maxInputChars?: number; maxOutputTokens?: number }
        ): Promise<string> {
          let messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
            { role: "user", content: message },
          ];
          if (options?.maxInputChars) messages = fitChatMessages(messages, options.maxInputChars);
          const resp = await client.chat.completions.create({
            model,
            max_tokens: Math.min(maxTokens, options?.maxOutputTokens ?? maxTokens),
            stream: true,
            messages,
          });
          let out = "";
          for await (const chunk of resp) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            if (delta) { out += delta; emit({ type: "delta", text: delta }); }
          }
          return out;
        }

        // ── Provider cascade ────────────────────────────────────────────────────
        let providerSucceeded = false;

        if (anthropicKey && !providerSucceeded) {
          try {
            const client = new Anthropic({ apiKey: anthropicKey });
            const messages: Anthropic.MessageParam[] = [
              ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
              { role: "user", content: message },
            ];
            const streamResponse = client.messages.stream({ model: models.anthropic, max_tokens: maxTokens, system: systemPrompt, messages });
            for await (const chunk of streamResponse) {
              if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
                const delta = chunk.delta.text;
                assistantText += delta;
                emit({ type: "delta", text: delta });
              }
            }
            providerSucceeded = true;
          } catch (err) {
            console.warn("[AI Chat] Anthropic failed — trying next provider:", (err as { status?: number })?.status ?? err);
          }
        }

        if (openaiKey && !providerSucceeded) {
          try {
            assistantText = await streamOpenAICompat(new OpenAI({ apiKey: openaiKey }), models.openai);
            providerSucceeded = true;
          } catch (err) {
            console.warn("[AI Chat] OpenAI failed — trying next provider:", (err as { status?: number })?.status ?? err);
          }
        }

        if (geminiKey && !providerSucceeded) {
          try {
            assistantText = await streamOpenAICompat(
              new OpenAI({ apiKey: geminiKey, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" }),
              models.gemini
            );
            providerSucceeded = true;
          } catch (err) {
            console.warn("[AI Chat] Gemini failed — trying next provider:", (err as { status?: number })?.status ?? err);
          }
        }

        if (groqKey && !providerSucceeded) {
          try {
            emit({ type: "status", step: `Using Groq (${models.groq})…` });
            assistantText = await streamOpenAICompat(
              new OpenAI({ apiKey: groqKey, baseURL: "https://api.groq.com/openai/v1" }),
              models.groq,
              { maxInputChars: plan === "free" ? 18_000 : 38_000, maxOutputTokens: plan === "free" ? 1024 : 2048 }
            );
            providerSucceeded = true;
          } catch (err) {
            console.warn("[AI Chat] Groq failed — trying next provider:", (err as { status?: number })?.status ?? err);
          }
        }

        if (cerebrasKey && !providerSucceeded) {
          try {
            emit({ type: "status", step: `Using Cerebras (${models.cerebras})…` });
            assistantText = await streamOpenAICompat(
              new OpenAI({ apiKey: cerebrasKey, baseURL: "https://api.cerebras.ai/v1" }),
              models.cerebras,
              { maxInputChars: 28_000, maxOutputTokens: 2048 }
            );
            providerSucceeded = true;
          } catch (err) {
            console.warn("[AI Chat] Cerebras failed — trying next provider:", (err as { status?: number })?.status ?? err);
          }
        }

        if (deepseekKey && !providerSucceeded) {
          try {
            emit({ type: "status", step: "Using DeepSeek…" });
            assistantText = await streamOpenAICompat(
              new OpenAI({ apiKey: deepseekKey, baseURL: "https://api.deepseek.com/v1" }),
              models.deepseek
            );
            providerSucceeded = true;
          } catch (err) {
            console.warn("[AI Chat] DeepSeek failed — trying next provider:", (err as { status?: number })?.status ?? err);
          }
        }

        if (mistralKey && !providerSucceeded) {
          try {
            emit({ type: "status", step: "Using Mistral…" });
            assistantText = await streamOpenAICompat(
              new OpenAI({ apiKey: mistralKey, baseURL: "https://api.mistral.ai/v1" }),
              models.mistral
            );
            providerSucceeded = true;
          } catch (err) {
            console.warn("[AI Chat] Mistral failed — trying next provider:", (err as { status?: number })?.status ?? err);
          }
        }

        if (!providerSucceeded) {
          // Final fallback: HuggingFace (always available, no key needed)
          emit({ type: "status", step: "Using GitScope Free AI — add a key in Settings for better results" });
          try {
            const hfMessages = [
              { role: "system" as const, content: systemPrompt },
              ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
              { role: "user" as const, content: message },
            ];
            const result = await callHuggingFace({ tier: "balanced", messages: hfMessages, maxNewTokens: 1024, temperature: 0.4 });
            assistantText = result?.text ?? "";
          } catch {
            assistantText = "";
          }
          if (!assistantText) {
            assistantText = "All AI providers are temporarily unavailable. Please try again in a moment, or configure your own API key in Settings → API Keys for reliable access.";
          }
          emit({ type: "delta", text: assistantText });
        }

        await appendMessages(conversation, message, assistantText);
        done(assistantText);
      } catch (err) {
        console.error("[AI Chat]", err);
        done(undefined, err instanceof Error ? err.message : "An error occurred");
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

/** GET /api/ai/chat?repo=owner/repo — Load conversation history */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  if (!repo) return Response.json({ error: "repo required" }, { status: 400 });

  const conversation = await loadConversation(repo, session.user.id);
  return Response.json({
    messages: conversation.messages,
    messageCount: conversation.messages.length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  });
}
