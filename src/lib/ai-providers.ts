/**
 * GitScope Multi-Provider AI Abstraction
 * ========================================
 * Free plan  → internal static analysis only (no LLM called)
 * Paid plans → Anthropic → OpenAI → Gemini (first key that's set wins)
 * Enterprise → Claude Opus + GPT-4o in parallel, findings merged
 *
 * Configure via env vars (at least one required for paid-tier LLM features):
 *   ANTHROPIC_API_KEY  — Anthropic Claude
 *   OPENAI_API_KEY     — OpenAI GPT
 *   GEMINI_API_KEY     — Google Gemini
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type AIPlan = "free" | "pro" | "professional" | "developer" | "team" | "enterprise";

/** Decrypted BYOK keys passed through from the calling route. */
export interface UserBYOKKeys {
  anthropic?: string | null;
  openai?: string | null;
  gemini?: string | null;
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

function anthropicModel(plan: AIPlan): string {
  // Sonnet for all paid plans — Opus costs 5× more with negligible quality gain on scan tasks.
  // Enterprise advantage comes from ensemble (parallel Anthropic + OpenAI), not a heavier model.
  if (plan === "enterprise" || plan === "team" || plan === "developer" || plan === "professional") return "claude-sonnet-4-6";
  return "claude-haiku-4-5-20251001";
}

function openaiModel(plan: AIPlan): string {
  if (plan === "enterprise" || plan === "team" || plan === "developer" || plan === "professional") return "gpt-4o";
  return "gpt-4o-mini";
}

function geminiModel(plan: AIPlan): string {
  if (plan === "enterprise" || plan === "team" || plan === "developer" || plan === "professional") return "gemini-2.0-flash";
  return "gemini-1.5-flash";
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

// ── Ensemble merger (enterprise only) ─────────────────────────────────────────

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

/**
 * Call the best available AI provider for the given plan.
 * Free plan gets limited GitScope AI (haiku) when server keys are set.
 * Paid plans try providers in order; returns null if no keys configured.
 */
export async function callAI(opts: AICallOptions): Promise<AICallResult | null> {
  const { plan } = opts;

  // Free plan: use server-side key if set (haiku model), else internal AI
  if (plan === "free") {
    const hasServerKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
    if (!hasServerKey) return null;
    // No BYOK for free — server key only, haiku model only
    const freeOpts: AICallOptions = { ...opts, byokKeys: undefined };
    return await callAnthropic(freeOpts) ?? await callOpenAI(freeOpts) ?? await callGemini(freeOpts);
  }

  if (plan === "enterprise") {
    // Run both in parallel; if one fails, still use the other
    const [ar, or_] = await Promise.all([
      callAnthropic(opts).catch(() => null),
      callOpenAI(opts).catch(() => null),
    ]);
    if (ar && or_) {
      return { ...ar, text: mergeJSON(ar.text, or_.text, ar.model, or_.model), model: `${ar.model} + ${or_.model} (ensemble)` };
    }
    const single = ar ?? or_;
    if (single) return single;
    return callGemini(opts).catch(() => null);
  }

  // Pro / Professional / Team: Anthropic → OpenAI → Gemini (errors propagate to caller)
  return await callAnthropic(opts) ?? await callOpenAI(opts) ?? await callGemini(opts);
}

/**
 * True if at least one paid AI provider key is configured (server keys or BYOK).
 */
export function hasAnyAIProvider(byokKeys?: UserBYOKKeys): boolean {
  return !!(
    byokKeys?.anthropic || byokKeys?.openai || byokKeys?.gemini ||
    process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY
  );
}

/**
 * True if the user has at least one BYOK key configured.
 */
export function hasByokKey(byokKeys?: UserBYOKKeys): boolean {
  return !!(byokKeys?.anthropic || byokKeys?.openai || byokKeys?.gemini);
}

/**
 * Display name of the model that will be used for a given plan.
 */
export function getModelLabel(plan: AIPlan, byokKeys?: UserBYOKKeys): string {
  const hasByok = hasByokKey(byokKeys);
  const hasServer = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);

  if (plan === "free") {
    return hasServer ? `GitScope AI (${anthropicModel("free")})` : "gitscope-internal-v2";
  }

  if (hasByok) {
    if (byokKeys?.anthropic) return anthropicModel(plan);
    if (byokKeys?.openai)    return openaiModel(plan);
    if (byokKeys?.gemini)    return `gemini/${geminiModel(plan)}`;
  }

  if (hasServer) {
    if (process.env.ANTHROPIC_API_KEY) return `GitScope AI (${anthropicModel(plan)})`;
    if (process.env.OPENAI_API_KEY)    return `GitScope AI (${openaiModel(plan)})`;
    if (process.env.GEMINI_API_KEY)    return `GitScope AI (gemini/${geminiModel(plan)})`;
  }

  return "gitscope-internal-v2";
}

/**
 * True when a server-side key is available (and the current call would use it, not BYOK).
 */
export function isUsingGitScopeAI(byokKeys?: UserBYOKKeys): boolean {
  if (hasByokKey(byokKeys)) return false;
  return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
}
