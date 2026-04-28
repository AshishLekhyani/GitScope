/**
 * GitScope Hugging Face Inference Layer
 * =======================================
 * Provides FREE AI inference for users who have not configured any BYOK key
 * and no server-side keys are present. Uses the HF Inference API which offers
 * rate-limited free access to open-source models.
 *
 * Model tiers:
 *   fast     → microsoft/Phi-3.5-mini-instruct   (3.8B params, extremely fast)
 *   balanced → mistralai/Mistral-7B-Instruct-v0.3 (7B params, great quality)
 *   strong   → meta-llama/Llama-3.1-8B-Instruct   (8B params, best free quality)
 *   code     → Qwen/Qwen2.5-Coder-7B-Instruct     (code-specialized)
 *   embed    → sentence-transformers/all-MiniLM-L6-v2 (embeddings, 384-dim)
 *
 * Set HF_API_KEY in env for higher rate limits & gated models. Without it,
 * HF allows anonymous requests at a lower rate.
 */

const HF_API_BASE = "https://api-inference.huggingface.co";
const REQUEST_TIMEOUT_MS = 30_000;

/** Public models that don't require an HF token for inference */
export const HF_MODELS = {
  fast: "microsoft/Phi-3.5-mini-instruct",
  balanced: "mistralai/Mistral-7B-Instruct-v0.3",
  strong: "meta-llama/Llama-3.1-8B-Instruct",
  code: "Qwen/Qwen2.5-Coder-7B-Instruct",
  embed: "sentence-transformers/all-MiniLM-L6-v2",
} as const;

export type HFModelTier = keyof typeof HF_MODELS;

export interface HFMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface HFCallOptions {
  tier?: HFModelTier;
  modelId?: string; // override specific model
  messages: HFMessage[];
  maxNewTokens?: number;
  temperature?: number;
  topP?: number;
  repetitionPenalty?: number;
  stopSequences?: string[];
  /** User-supplied HF access token (BYOK). Takes priority over HF_API_KEY env var. */
  apiKey?: string;
}

export interface HFCallResult {
  text: string;
  model: string;
  provider: "huggingface";
  finishReason: string;
}

export interface HFEmbedResult {
  embeddings: number[][];
  model: string;
}

function hfHeaders(apiKey?: string): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const token = apiKey?.trim() || process.env.HF_API_KEY;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/** Convert messages array to a single prompt string in the ChatML / Instruct format */
function messagesToPrompt(messages: HFMessage[], modelId: string): string {
  const isLlama = modelId.toLowerCase().includes("llama");
  const isPhi = modelId.toLowerCase().includes("phi");
  const isQwen = modelId.toLowerCase().includes("qwen");
  const isMistral = modelId.toLowerCase().includes("mistral");

  if (isLlama) {
    // Llama 3 instruct format
    const parts: string[] = ["<|begin_of_text|>"];
    for (const m of messages) {
      if (m.role === "system") {
        parts.push(`<|start_header_id|>system<|end_header_id|>\n\n${m.content}<|eot_id|>`);
      } else if (m.role === "user") {
        parts.push(`<|start_header_id|>user<|end_header_id|>\n\n${m.content}<|eot_id|>`);
      } else {
        parts.push(`<|start_header_id|>assistant<|end_header_id|>\n\n${m.content}<|eot_id|>`);
      }
    }
    parts.push("<|start_header_id|>assistant<|end_header_id|>\n\n");
    return parts.join("");
  }

  if (isPhi) {
    // Phi-3 instruct format
    const parts: string[] = [];
    const systemMsg = messages.find((m) => m.role === "system");
    if (systemMsg) parts.push(`<|system|>\n${systemMsg.content}<|end|>\n`);
    for (const m of messages.filter((m) => m.role !== "system")) {
      if (m.role === "user") parts.push(`<|user|>\n${m.content}<|end|>\n`);
      else parts.push(`<|assistant|>\n${m.content}<|end|>\n`);
    }
    parts.push("<|assistant|>\n");
    return parts.join("");
  }

  if (isQwen) {
    // Qwen ChatML format
    const parts: string[] = [];
    for (const m of messages) {
      parts.push(`<|im_start|>${m.role}\n${m.content}<|im_end|>\n`);
    }
    parts.push("<|im_start|>assistant\n");
    return parts.join("");
  }

  if (isMistral) {
    // Mistral instruct format [INST] ... [/INST]
    const parts: string[] = [];
    let inUserTurn = false;
    for (const m of messages) {
      if (m.role === "system") {
        // Mistral v0.3 can prepend system to first user turn
        parts.push(`[INST] ${m.content}\n`);
        inUserTurn = true;
      } else if (m.role === "user") {
        if (inUserTurn) {
          parts.push(`${m.content} [/INST]`);
          inUserTurn = false;
        } else {
          parts.push(`[INST] ${m.content} [/INST]`);
        }
      } else {
        parts.push(` ${m.content}</s>`);
      }
    }
    return parts.join("");
  }

  // Generic ChatML fallback
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "system") parts.push(`### System:\n${m.content}\n`);
    else if (m.role === "user") parts.push(`### User:\n${m.content}\n`);
    else parts.push(`### Assistant:\n${m.content}\n`);
  }
  parts.push("### Assistant:\n");
  return parts.join("");
}

/** Call the HF Serverless Inference API (OpenAI-compatible chat completions) */
export async function callHuggingFace(opts: HFCallOptions): Promise<HFCallResult | null> {
  const modelId = opts.modelId ?? HF_MODELS[opts.tier ?? "balanced"];
  const maxTokens = opts.maxNewTokens ?? 2048;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // New HF Serverless Inference API uses OpenAI-compatible /v1/chat/completions
    const response = await fetch(`${HF_API_BASE}/models/${modelId}/v1/chat/completions`, {
      method: "POST",
      headers: hfHeaders(opts.apiKey),
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: opts.messages,
        max_tokens: maxTokens,
        temperature: opts.temperature ?? 0.3,
        top_p: opts.topP ?? 0.9,
        stream: false,
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text().catch(() => "unknown error");
      // Model loading (503 is common for cold-starts)
      if (response.status === 503) {
        console.warn(`[HF] Model ${modelId} loading, retrying in 3s…`);
        await new Promise((r) => setTimeout(r, 3000));
        return callHuggingFace(opts); // single retry
      }
      console.error(`[HF] ${response.status}: ${err}`);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      generated_text?: string;
    };

    // OpenAI-compat format (new endpoint)
    const rawText = data.choices?.[0]?.message?.content ?? "";

    // Strip any leaked prompt artifacts (kept as safety net)
    const text = rawText
      .replace(/^<\|.*?\|>/g, "")
      .replace(/\[\/INST\][\s\S]*$/, "")
      .trim();

    return { text, model: modelId, provider: "huggingface", finishReason: "stop" };
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      console.error(`[HF] Request to ${modelId} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    } else {
      console.error("[HF] Fetch error:", err);
    }
    return null;
  }
}

/** Compute text embeddings using sentence-transformers on HF */
export async function getEmbeddings(texts: string[]): Promise<HFEmbedResult | null> {
  const modelId = HF_MODELS.embed;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${HF_API_BASE}/models/${modelId}`, {
      method: "POST",
      headers: hfHeaders(),
      signal: controller.signal,
      body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
    });

    clearTimeout(timeout);
    if (!response.ok) return null;

    const data = (await response.json()) as number[][];
    return { embeddings: data, model: modelId };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Cosine similarity between two embedding vectors.
 * Returns value in [-1, 1]. Higher = more similar.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Find the most relevant chunks from a knowledge base using embeddings.
 * Returns indices sorted by similarity (highest first).
 */
export async function semanticSearch(
  query: string,
  chunks: string[],
  topK = 5
): Promise<Array<{ index: number; score: number; text: string }>> {
  if (chunks.length === 0) return [];

  const result = await getEmbeddings([query, ...chunks]);
  if (!result) return [];

  const [queryEmbed, ...chunkEmbeds] = result.embeddings;
  return chunks
    .map((text, i) => ({
      index: i,
      score: cosineSimilarity(queryEmbed, chunkEmbeds[i]),
      text,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Highest-quality free analysis prompt builder for HF models.
 * Wraps a system + user message pair with an explicit JSON instruction.
 */
export function buildHFAnalysisPrompt(
  systemContext: string,
  userTask: string,
  outputSchema: string
): HFMessage[] {
  return [
    {
      role: "system",
      content: `${systemContext}

CRITICAL OUTPUT RULES:
- Respond with valid JSON ONLY matching this schema: ${outputSchema}
- Do not include markdown fences, explanations, or any text outside the JSON
- All string values must be properly escaped
- Be specific, evidence-based, and actionable in every finding`,
    },
    {
      role: "user",
      content: userTask,
    },
  ];
}

/**
 * Check if HF inference is available (always true, but rate-limited without key).
 */
export function isHFAvailable(): boolean {
  return true; // HF public inference is always accessible (rate-limited without key)
}

/** Get HF model label for display */
export function getHFModelLabel(tier: HFModelTier = "balanced"): string {
  return `GitScope Free AI (${HF_MODELS[tier]})`;
}
