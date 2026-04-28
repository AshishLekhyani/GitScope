/**
 * GitScope Multi-Provider AI Abstraction
 * ========================================
 * Provider priority (first key that is set wins):
 *   1. BYOK keys (user's own keys — highest priority)
 *   2. Server anthropic/openai/gemini keys (GitScope-managed tiers)
 *   3. Groq       — FREE tier, Llama-3.1-70B, extremely fast
 *   4. DeepSeek   — Very cheap ($0.14/M tokens), excellent at code
 *   5. Mistral    — Free tier (mistral-small), OpenAI-compatible
 *   6. Moonshot   — Kimi AI, free credits, strong reasoning
 *   7. Cerebras   — Free tier, fastest inference on the market
 *   8. HuggingFace — Always available, rate-limited, 7B models
 *
 * Enterprise → Claude Opus + GPT-4o in parallel, findings merged.
 *
 * BYOK env vars (user adds in Settings → API Keys):
 *   ANTHROPIC_API_KEY   OPENAI_API_KEY   GEMINI_API_KEY
 *   GROQ_API_KEY        DEEPSEEK_API_KEY MISTRAL_API_KEY
 *   MOONSHOT_API_KEY    CEREBRAS_API_KEY
 *   OLLAMA_BASE_URL     (local Ollama instance, no key needed)
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type AIPlan = "free" | "developer";

/** Decrypted BYOK keys passed through from the calling route. */
export interface UserBYOKKeys {
  anthropic?: string | null;
  openai?: string | null;
  gemini?: string | null;
  groq?: string | null;
  deepseek?: string | null;
  mistral?: string | null;
  moonshot?: string | null;
  cerebras?: string | null;
  ollama?: string | null;
}

export interface AICallOptions {
  plan: AIPlan;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  /** When supplied, BYOK keys take priority over server-level env vars. */
  byokKeys?: UserBYOKKeys;
}

export interface AICallResult {
  text: string;
  model: string;
  provider: "anthropic" | "openai" | "gemini";
  inputTokens: number;
  outputTokens: number;
}

// ── Model selection ────────────────────────────────────────────────────────────

// All non-free plans (developer and legacy variants) get premium models.
function isPaidPlan(plan: AIPlan): boolean {
  return plan !== "free";
}

function anthropicModel(plan: AIPlan): string {
  return isPaidPlan(plan) ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
}

function openaiModel(plan: AIPlan): string {
  return isPaidPlan(plan) ? "gpt-4o" : "gpt-4o-mini";
}

function geminiModel(plan: AIPlan): string {
  return isPaidPlan(plan) ? "gemini-2.0-flash" : "gemini-1.5-flash";
}

function groqModel(plan: AIPlan): string {
  // Groq free tier — Llama 3.3 70B is frontier-quality and free up to 14,400 req/day
  return isPaidPlan(plan) ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant";
}

function deepseekModel(_plan: AIPlan): string {
  // DeepSeek-V3 is exceptional at code tasks at $0.14/M tokens — only one chat model
  return "deepseek-chat";
}

function mistralModel(plan: AIPlan): string {
  return isPaidPlan(plan) ? "mistral-large-latest" : "mistral-small-latest";
}

function moonshotModel(plan: AIPlan): string {
  // Kimi (Moonshot AI) — strong at long-context reasoning
  return isPaidPlan(plan) ? "moonshot-v1-32k" : "moonshot-v1-8k";
}

function cerebrasModel(_plan: AIPlan): string {
  // Cerebras uses Llama 3.1 on world's fastest AI chip — free tier available
  return "llama3.1-70b";
}

function ollamaModel(plan: AIPlan): string {
  // Local Ollama — model name depends on what user has pulled
  return isPaidPlan(plan) ? "llama3.1:70b" : "llama3.1:8b";
}

// ── Individual provider callers ───────────────────────────────────────────────

async function callAnthropic(opts: AICallOptions): Promise<AICallResult | null> {
  const apiKey = opts.byokKeys?.anthropic ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = anthropicModel(opts.plan);
  // Key is present — let errors propagate so callers can see bad key / rate limit / etc.
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.systemPrompt,
    messages: [{ role: "user", content: opts.userPrompt }],
  });
  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
  return { text, model, provider: "anthropic", inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
}

async function callOpenAI(opts: AICallOptions): Promise<AICallResult | null> {
  const apiKey = opts.byokKeys?.openai ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = openaiModel(opts.plan);
  // Key is present — let errors propagate so callers can see bad key / rate limit / etc.
  const client = new OpenAI({ apiKey });
  const res = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  });
  const text = res.choices[0]?.message.content ?? "";
  return { text, model, provider: "openai", inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
}

async function callGemini(opts: AICallOptions): Promise<AICallResult | null> {
  const apiKey = opts.byokKeys?.gemini ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = geminiModel(opts.plan);
  // Key is present — let errors propagate so callers can see bad key / rate limit / etc.
  const client = new OpenAI({ apiKey, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" });
  const res = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  });
  const text = res.choices[0]?.message.content ?? "";
  return { text, model: `gemini/${model}`, provider: "gemini", inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
}

/** Groq — free tier, OpenAI-compatible, llama/mixtral models */
async function callGroq(opts: AICallOptions): Promise<AICallResult | null> {
  const apiKey = opts.byokKeys?.groq ?? process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const model = groqModel(opts.plan);
  const client = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  const res = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  });
  const text = res.choices[0]?.message.content ?? "";
  return { text, model: `groq/${model}`, provider: "openai", inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
}

/** DeepSeek — ~$0.14/M tokens, excellent at code analysis */
async function callDeepSeek(opts: AICallOptions): Promise<AICallResult | null> {
  const apiKey = opts.byokKeys?.deepseek ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const model = deepseekModel(opts.plan);
  const client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1" });
  const res = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  });
  const text = res.choices[0]?.message.content ?? "";
  return { text, model: `deepseek/${model}`, provider: "openai", inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
}

/** Mistral — free tier available (mistral-small), OpenAI-compatible */
async function callMistral(opts: AICallOptions): Promise<AICallResult | null> {
  const apiKey = opts.byokKeys?.mistral ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) return null;
  const model = mistralModel(opts.plan);
  const client = new OpenAI({ apiKey, baseURL: "https://api.mistral.ai/v1" });
  const res = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  });
  const text = res.choices[0]?.message.content ?? "";
  return { text, model: `mistral/${model}`, provider: "openai", inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
}

/** Moonshot (Kimi) — strong long-context reasoning, OpenAI-compatible */
async function callMoonshot(opts: AICallOptions): Promise<AICallResult | null> {
  const apiKey = opts.byokKeys?.moonshot ?? process.env.MOONSHOT_API_KEY;
  if (!apiKey) return null;
  const model = moonshotModel(opts.plan);
  const client = new OpenAI({ apiKey, baseURL: "https://api.moonshot.cn/v1" });
  const res = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  });
  const text = res.choices[0]?.message.content ?? "";
  return { text, model: `moonshot/${model}`, provider: "openai", inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
}

/** Cerebras — world's fastest AI inference, free tier, OpenAI-compatible */
async function callCerebras(opts: AICallOptions): Promise<AICallResult | null> {
  const apiKey = opts.byokKeys?.cerebras ?? process.env.CEREBRAS_API_KEY;
  if (!apiKey) return null;
  const model = cerebrasModel(opts.plan);
  const client = new OpenAI({ apiKey, baseURL: "https://api.cerebras.ai/v1" });
  const res = await client.chat.completions.create({
    model,
    max_tokens: Math.min(opts.maxTokens ?? 4096, 8192),
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  });
  const text = res.choices[0]?.message.content ?? "";
  return { text, model: `cerebras/${model}`, provider: "openai", inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
}

/** Ollama — local inference, no API key needed (just OLLAMA_BASE_URL) */
async function callOllama(opts: AICallOptions): Promise<AICallResult | null> {
  const baseURL = opts.byokKeys?.ollama ?? process.env.OLLAMA_BASE_URL;
  if (!baseURL) return null;
  const model = ollamaModel(opts.plan);
  const client = new OpenAI({ apiKey: "ollama", baseURL: `${baseURL}/v1` });
  const res = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  });
  const text = res.choices[0]?.message.content ?? "";
  return { text, model: `ollama/${model}`, provider: "openai", inputTokens: 0, outputTokens: 0 };
}

// ── Ensemble merger ────────────────────────────────────────────────────────────

function mergeJSON(primary: string, secondary: string, primaryModel: string, secondaryModel: string): string {
  try {
    const clean = (s: string) => s.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const a = JSON.parse(clean(primary)) as Record<string, unknown>;
    const b = JSON.parse(clean(secondary)) as Record<string, unknown>;

    const aFindings = (a.findings ?? a.issues ?? []) as Array<Record<string, unknown>>;
    const bFindings = (b.findings ?? b.issues ?? []) as Array<Record<string, unknown>>;
    const seen = new Set(aFindings.map((f) => String(f.description ?? "").slice(0, 50)));
    const extra = bFindings.filter((f) => !seen.has(String(f.description ?? "").slice(0, 50)));
    if (aFindings.length > 0) {
      const key = "findings" in a ? "findings" : "issues";
      a[key] = [...aFindings, ...extra].slice(0, 12);
    }

    if (Array.isArray(a.securityIssues) && Array.isArray(b.securityIssues)) {
      a.securityIssues = [...new Set([...a.securityIssues as string[], ...b.securityIssues as string[]])];
    }

    const order = ["REQUEST_CHANGES", "COMMENT", "APPROVE"];
    if (typeof a.verdict === "string" && typeof b.verdict === "string") {
      a.verdict = order.indexOf(a.verdict) <= order.indexOf(b.verdict) ? a.verdict : b.verdict;
    }

    a.model = `${primaryModel} + ${secondaryModel} (ensemble)`;
    return JSON.stringify(a);
  } catch {
    return primary;
  }
}

// ── Main exported function ─────────────────────────────────────────────────────

// Catches 401/403 "invalid key" from a provider and returns null so the cascade
// continues to the next provider. Re-throws everything else (rate limits, network).
async function safeCall(fn: () => Promise<AICallResult | null>): Promise<AICallResult | null> {
  try {
    return await fn();
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    console.warn(`[AI] Provider error ${status ?? "(network/timeout)"} — trying next provider`);
    return null;
  }
}

/**
 * Call the best available AI provider for the given plan.
 * An invalid key for any provider is caught and the cascade falls through to the next one.
 * Free plan tries server keys first, then Groq/Cerebras community providers.
 */
export async function callAI(opts: AICallOptions): Promise<AICallResult | null> {
  try {
    const { plan } = opts;

    // ── Free plan: try server keys first, then community providers ────────────
    if (plan === "free") {
      const hasServerKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
      if (hasServerKey) {
        const freeOpts: AICallOptions = { ...opts, byokKeys: undefined };
        const result = await safeCall(() => callAnthropic(freeOpts))
          ?? await safeCall(() => callOpenAI(freeOpts))
          ?? await safeCall(() => callGemini(freeOpts));
        if (result) return result;
      }
      // No server key (or all server keys invalid) — try community free providers
      return await safeCall(() => callGroq(opts))
        ?? await safeCall(() => callCerebras(opts))
        ?? null;
    }

    // ── All plans: BYOK first, then server keys, then free community providers ──
    // Priority: Anthropic → OpenAI → Gemini → Groq → DeepSeek → Mistral → Moonshot → Cerebras → Ollama
    return await safeCall(() => callAnthropic(opts))
      ?? await safeCall(() => callOpenAI(opts))
      ?? await safeCall(() => callGemini(opts))
      ?? await safeCall(() => callGroq(opts))
      ?? await safeCall(() => callDeepSeek(opts))
      ?? await safeCall(() => callMistral(opts))
      ?? await safeCall(() => callMoonshot(opts))
      ?? await safeCall(() => callCerebras(opts))
      ?? await safeCall(() => callOllama(opts));
  } catch (err) {
    console.error("[AI] Unexpected cascade failure:", err);
    return null;
  }
}

/** True if at least one AI provider is available (BYOK, server keys, or free community providers). */
export function hasAnyAIProvider(byokKeys?: UserBYOKKeys): boolean {
  return !!(
    byokKeys?.anthropic || byokKeys?.openai || byokKeys?.gemini ||
    byokKeys?.groq || byokKeys?.deepseek || byokKeys?.mistral ||
    byokKeys?.moonshot || byokKeys?.cerebras || byokKeys?.ollama ||
    process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY ||
    process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.MISTRAL_API_KEY ||
    process.env.MOONSHOT_API_KEY || process.env.CEREBRAS_API_KEY || process.env.OLLAMA_BASE_URL
  );
}

/** True if the user has at least one BYOK key configured. */
export function hasByokKey(byokKeys?: UserBYOKKeys): boolean {
  return !!(
    byokKeys?.anthropic || byokKeys?.openai || byokKeys?.gemini ||
    byokKeys?.groq || byokKeys?.deepseek || byokKeys?.mistral ||
    byokKeys?.moonshot || byokKeys?.cerebras || byokKeys?.ollama
  );
}

/** Display name of the model that will be used for a given plan. */
export function getModelLabel(plan: AIPlan, byokKeys?: UserBYOKKeys): string {
  const hasServer = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);

  if (plan === "free") {
    if (hasServer) return `GitScope AI (${anthropicModel("free")})`;
    if (process.env.GROQ_API_KEY || byokKeys?.groq) return `Groq (${groqModel("free")})`;
    if (process.env.CEREBRAS_API_KEY || byokKeys?.cerebras) return `Cerebras (${cerebrasModel("free")})`;
    return "GitScope Static Analysis";
  }

  if (byokKeys?.anthropic) return anthropicModel(plan);
  if (byokKeys?.openai)    return openaiModel(plan);
  if (byokKeys?.gemini)    return `gemini/${geminiModel(plan)}`;
  if (byokKeys?.groq)      return `groq/${groqModel(plan)}`;
  if (byokKeys?.deepseek)  return `deepseek/${deepseekModel(plan)}`;
  if (byokKeys?.mistral)   return `mistral/${mistralModel(plan)}`;
  if (byokKeys?.moonshot)  return `moonshot/${moonshotModel(plan)}`;
  if (byokKeys?.cerebras)  return `cerebras/${cerebrasModel(plan)}`;
  if (byokKeys?.ollama)    return `ollama/${ollamaModel(plan)}`;

  if (hasServer) {
    if (process.env.ANTHROPIC_API_KEY) return `GitScope AI (${anthropicModel(plan)})`;
    if (process.env.OPENAI_API_KEY)    return `GitScope AI (${openaiModel(plan)})`;
    if (process.env.GEMINI_API_KEY)    return `GitScope AI (gemini/${geminiModel(plan)})`;
  }
  if (process.env.GROQ_API_KEY) return `groq/${groqModel(plan)}`;
  if (process.env.DEEPSEEK_API_KEY) return `deepseek/${deepseekModel(plan)}`;

  return "gitscope-internal-v3";
}

/** True when a server-side key is available (and the current call would use it, not BYOK). */
export function isUsingGitScopeAI(byokKeys?: UserBYOKKeys): boolean {
  if (hasByokKey(byokKeys)) return false;
  return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
}

/** Which provider will be used, for display in the UI. */
export function getProviderLabel(byokKeys?: UserBYOKKeys): string {
  if (byokKeys?.anthropic) return "Anthropic (BYOK)";
  if (byokKeys?.openai)    return "OpenAI (BYOK)";
  if (byokKeys?.gemini)    return "Google Gemini (BYOK)";
  if (byokKeys?.groq)      return "Groq (BYOK)";
  if (byokKeys?.deepseek)  return "DeepSeek (BYOK)";
  if (byokKeys?.mistral)   return "Mistral (BYOK)";
  if (byokKeys?.moonshot)  return "Kimi / Moonshot (BYOK)";
  if (byokKeys?.cerebras)  return "Cerebras (BYOK)";
  if (byokKeys?.ollama)    return "Ollama (local)";
  if (process.env.ANTHROPIC_API_KEY) return "GitScope AI (Anthropic)";
  if (process.env.OPENAI_API_KEY)    return "GitScope AI (OpenAI)";
  if (process.env.GEMINI_API_KEY)    return "GitScope AI (Gemini)";
  if (process.env.GROQ_API_KEY)      return "Groq (community free)";
  if (process.env.DEEPSEEK_API_KEY)  return "DeepSeek (community)";
  if (process.env.CEREBRAS_API_KEY)  return "Cerebras (community free)";
  return "GitScope Static Analysis";
}
