/**
 * POST /api/user/byok
 * Save or delete a user-supplied API key (BYOK — Bring Your Own Key).
 *
 * Body: { provider: string, key: string | null }
 *   key = null → delete the stored key
 *   key = "sk-..." → validate + encrypt + store
 *
 * Supported providers:
 *   anthropic, openai, gemini           — stored as dedicated columns
 *   groq, deepseek, mistral, moonshot,  — stored as encrypted JSON in byokExtendedKeys
 *   cerebras, ollama
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, safeDecrypt } from "@/lib/encrypt";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

type CoreProvider = "anthropic" | "openai" | "gemini";
type ExtProvider = "groq" | "deepseek" | "mistral" | "moonshot" | "cerebras" | "ollama";
type Provider = CoreProvider | ExtProvider;

const CORE_PROVIDERS: CoreProvider[] = ["anthropic", "openai", "gemini"];
const EXT_PROVIDERS: ExtProvider[] = ["groq", "deepseek", "mistral", "moonshot", "cerebras", "ollama"];
const ALL_PROVIDERS: Provider[] = [...CORE_PROVIDERS, ...EXT_PROVIDERS];

const CORE_FIELD: Record<CoreProvider, "byokAnthropicKey" | "byokOpenAIKey" | "byokGeminiKey"> = {
  anthropic: "byokAnthropicKey",
  openai:    "byokOpenAIKey",
  gemini:    "byokGeminiKey",
};

// Basic key format validation
const KEY_PREFIXES: Partial<Record<Provider, RegExp>> = {
  anthropic: /^sk-ant-/,
  openai:    /^sk-/,
  gemini:    /^AIza/,
  groq:      /^gsk_/,
  deepseek:  /^sk-/,
  mistral:   /^[a-zA-Z0-9]{32,}/,
  moonshot:  /^sk-/,
  cerebras:  /^csk-/,
  ollama:    /^https?:\/\//,   // ollama is a base URL, not a key
};

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai:    "OpenAI",
  gemini:    "Google Gemini",
  groq:      "Groq",
  deepseek:  "DeepSeek",
  mistral:   "Mistral",
  moonshot:  "Kimi (Moonshot)",
  cerebras:  "Cerebras",
  ollama:    "Ollama",
};

async function postHandler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { provider?: string; key?: string | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { provider, key } = body;

  if (!provider || !ALL_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json({
      error: `Invalid provider. Must be one of: ${ALL_PROVIDERS.join(", ")}`,
    }, { status: 400 });
  }

  const prov = provider as Provider;

  // All BYOK providers are available to all users (free and developer).
  // ── Core providers (dedicated columns) ─────────────────────────────────────
  if (CORE_PROVIDERS.includes(prov as CoreProvider)) {
    const coreProv = prov as CoreProvider;
    const field = CORE_FIELD[coreProv];

    if (key === null || key === undefined || key === "") {
      await prisma.user.update({ where: { id: session.user.id }, data: { [field]: null } });
      return NextResponse.json({ ok: true, saved: false });
    }

    const trimmedKey = key.trim();
    if (trimmedKey.length < 20) {
      return NextResponse.json({ error: "Key appears too short to be valid." }, { status: 400 });
    }
    const prefix = KEY_PREFIXES[coreProv];
    if (prefix && !prefix.test(trimmedKey)) {
      const expectedPrefix = coreProv === "anthropic" ? "sk-ant-" : coreProv === "openai" ? "sk-" : "AIza";
      return NextResponse.json({ error: `${PROVIDER_LABELS[coreProv]} keys should start with ${expectedPrefix}.` }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { [field]: encrypt(trimmedKey) },
    });
    return NextResponse.json({ ok: true, saved: true });
  }

  // ── Extended providers (JSON column) ────────────────────────────────────────
  const extProv = prov as ExtProvider;

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { byokExtendedKeys: true },
  });

  let extKeys: Record<string, string> = {};
  if (dbUser?.byokExtendedKeys) {
    try {
      const decrypted = safeDecrypt(dbUser.byokExtendedKeys);
      if (decrypted) extKeys = JSON.parse(decrypted) as Record<string, string>;
    } catch { /* start fresh */ }
  }

  if (key === null || key === undefined || key === "") {
    delete extKeys[extProv];
  } else {
    const trimmedKey = key.trim();
    if (trimmedKey.length < 8) {
      return NextResponse.json({ error: "Key appears too short to be valid." }, { status: 400 });
    }
    const prefix = KEY_PREFIXES[extProv];
    if (prefix && !prefix.test(trimmedKey)) {
      return NextResponse.json({ error: `${PROVIDER_LABELS[extProv]} key format appears invalid.` }, { status: 400 });
    }
    extKeys[extProv] = trimmedKey;
  }

  const encryptedJson = Object.keys(extKeys).length > 0 ? encrypt(JSON.stringify(extKeys)) : null;
  await prisma.user.update({
    where: { id: session.user.id },
    data: { byokExtendedKeys: encryptedJson },
  });

  return NextResponse.json({ ok: true, saved: key !== null && key !== "" });
}

export const POST = withRouteSecurity(postHandler, SecurityPresets.sensitive);

/** GET /api/user/byok — return which providers have keys set (never returns the actual keys) */
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      byokAnthropicKey: true,
      byokOpenAIKey: true,
      byokGeminiKey: true,
      byokExtendedKeys: true,
    },
  });

  let extKeys: Record<string, boolean> = {};
  if (dbUser?.byokExtendedKeys) {
    try {
      const decrypted = safeDecrypt(dbUser.byokExtendedKeys);
      if (decrypted) {
        const parsed = JSON.parse(decrypted) as Record<string, string>;
        extKeys = Object.fromEntries(Object.keys(parsed).map(k => [k, true]));
      }
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    anthropic: !!dbUser?.byokAnthropicKey,
    openai:    !!dbUser?.byokOpenAIKey,
    gemini:    !!dbUser?.byokGeminiKey,
    ...extKeys,
  });
}
