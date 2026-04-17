/**
 * POST /api/user/byok
 * Save or delete a user-supplied API key (BYOK — Bring Your Own Key).
 *
 * Body: { provider: "anthropic" | "openai" | "gemini", key: string | null }
 *   key = null → delete the stored key
 *   key = "sk-..." → validate + encrypt + store
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encrypt";

type Provider = "anthropic" | "openai" | "gemini";

const PROVIDER_KEY_FIELD: Record<Provider, "byokAnthropicKey" | "byokOpenAIKey" | "byokGeminiKey"> = {
  anthropic: "byokAnthropicKey",
  openai:    "byokOpenAIKey",
  gemini:    "byokGeminiKey",
};

// Very basic key format validation — prevents obvious non-key strings being stored.
const KEY_PREFIXES: Record<Provider, RegExp> = {
  anthropic: /^sk-ant-/,
  openai:    /^sk-/,
  gemini:    /^AIza/,
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { provider?: string; key?: string | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { provider, key } = body;

  if (!provider || !["anthropic", "openai", "gemini"].includes(provider)) {
    return NextResponse.json({ error: "Invalid provider. Must be anthropic, openai, or gemini." }, { status: 400 });
  }

  const prov = provider as Provider;
  const field = PROVIDER_KEY_FIELD[prov];

  // Delete key
  if (key === null || key === undefined || key === "") {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { [field]: null },
    });
    return NextResponse.json({ ok: true, saved: false });
  }

  // Validate key format
  const trimmedKey = key.trim();
  if (trimmedKey.length < 20) {
    return NextResponse.json({ error: "Key appears too short to be valid." }, { status: 400 });
  }
  if (!KEY_PREFIXES[prov].test(trimmedKey)) {
    return NextResponse.json({
      error: `${prov === "anthropic" ? "Anthropic" : prov === "openai" ? "OpenAI" : "Gemini"} keys should start with ${prov === "anthropic" ? "sk-ant-" : prov === "openai" ? "sk-" : "AIza"}.`,
    }, { status: 400 });
  }

  // Encrypt and store
  const encryptedKey = encrypt(trimmedKey);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { [field]: encryptedKey },
  });

  return NextResponse.json({ ok: true, saved: true });
}
