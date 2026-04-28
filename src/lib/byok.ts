/**
 * BYOK (Bring Your Own Key) helpers
 * ===================================
 * Centralises reading, decrypting, and resolving all provider keys for a user.
 * Import getUserBYOKKeys() in any API route instead of duplicating the DB read.
 */

import { prisma } from "@/lib/prisma";
import { safeDecrypt } from "@/lib/encrypt";
import type { UserBYOKKeys } from "@/lib/ai-providers";

/** Fetch and decrypt all BYOK keys for a user. Returns null values for unset keys. */
export async function getUserBYOKKeys(userId: string): Promise<UserBYOKKeys> {
  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      byokAnthropicKey: true,
      byokOpenAIKey: true,
      byokGeminiKey: true,
      byokExtendedKeys: true,
      byokPreferPlatform: true,
    },
  });

  // If user opted to use GitScope's managed keys, return empty keys (routes will fall through to env vars)
  if (dbUser?.byokPreferPlatform) {
    return { anthropic: null, openai: null, gemini: null };
  }

  // Core keys
  const keys: UserBYOKKeys = {
    anthropic: dbUser?.byokAnthropicKey ? safeDecrypt(dbUser.byokAnthropicKey) : null,
    openai:    dbUser?.byokOpenAIKey    ? safeDecrypt(dbUser.byokOpenAIKey)    : null,
    gemini:    dbUser?.byokGeminiKey    ? safeDecrypt(dbUser.byokGeminiKey)    : null,
  };

  // Extended keys (groq, deepseek, mistral, moonshot, cerebras, ollama)
  if (dbUser?.byokExtendedKeys) {
    try {
      const decrypted = safeDecrypt(dbUser.byokExtendedKeys);
      if (decrypted) {
        const ext = JSON.parse(decrypted) as Record<string, string>;
        if (ext.groq)      keys.groq      = ext.groq;
        if (ext.deepseek)  keys.deepseek  = ext.deepseek;
        if (ext.mistral)   keys.mistral   = ext.mistral;
        if (ext.moonshot)  keys.moonshot  = ext.moonshot;
        if (ext.cerebras)  keys.cerebras  = ext.cerebras;
        if (ext.ollama)    keys.ollama    = ext.ollama;
      }
    } catch { /* ignore malformed JSON */ }
  }

  return keys;
}

/** True if the user has configured at least one BYOK key (excluding server-side keys). */
export function hasAnyByokKey(keys: UserBYOKKeys): boolean {
  return !!(
    keys.anthropic || keys.openai || keys.gemini ||
    keys.groq || keys.deepseek || keys.mistral ||
    keys.moonshot || keys.cerebras || keys.ollama
  );
}

/** Return a display-friendly label for which provider will be used. */
export function resolveActiveProvider(keys: UserBYOKKeys): string {
  if (keys.anthropic) return "Claude (BYOK)";
  if (keys.openai)    return "GPT (BYOK)";
  if (keys.gemini)    return "Gemini (BYOK)";
  if (keys.groq)      return "Groq / Llama (BYOK)";
  if (keys.deepseek)  return "DeepSeek (BYOK)";
  if (keys.mistral)   return "Mistral (BYOK)";
  if (keys.moonshot)  return "Kimi / Moonshot (BYOK)";
  if (keys.cerebras)  return "Cerebras (BYOK)";
  if (keys.ollama)    return "Ollama (local, BYOK)";
  if (process.env.ANTHROPIC_API_KEY) return "Claude (GitScope)";
  if (process.env.OPENAI_API_KEY)    return "GPT (GitScope)";
  if (process.env.GEMINI_API_KEY)    return "Gemini (GitScope)";
  if (process.env.GROQ_API_KEY)      return "Llama 3.1 70B (free)";
  if (process.env.DEEPSEEK_API_KEY)  return "DeepSeek (community)";
  if (process.env.CEREBRAS_API_KEY)  return "Cerebras (free)";
  return "GitScope Static Analysis";
}
