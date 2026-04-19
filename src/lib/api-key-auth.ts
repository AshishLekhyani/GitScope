import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export interface ApiKeyAuthResult {
  userId: string;
  scopes: string[];
}

export async function authenticateApiKey(
  req: Request,
  requiredScope: string,
): Promise<ApiKeyAuthResult | null> {
  // Accept Bearer token or X-API-Key header
  const authHeader = req.headers.get("authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer sk_gs_")
    ? authHeader.slice(7)
    : (req.headers.get("x-api-key") ?? "");

  if (!rawKey.startsWith("sk_gs_")) return null;

  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const record = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: { id: true, userId: true, scopes: true, expiresAt: true },
  });

  if (!record) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;
  if (!record.scopes.includes(requiredScope)) return null;

  // Update lastUsedAt non-blocking
  prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return { userId: record.userId, scopes: record.scopes };
}
