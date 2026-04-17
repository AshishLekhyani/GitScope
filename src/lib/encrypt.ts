/**
 * AES-256-GCM encryption for sensitive stored values (BYOK API keys).
 * Requires ENCRYPTION_SECRET env var — a 64-char hex string (32 bytes).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 16;

function deriveKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET ?? "";
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_SECRET env var is required in production. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
    }
    // Dev fallback — predictable, never use in production
    return createHash("sha256").update("gitscope-dev-fallback-key-change-me-in-prod").digest();
  }
  const buf = Buffer.from(secret, "hex");
  if (buf.length === 32) return buf;
  // If not 64-char hex, derive via sha256 so any string works
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext string. Returns a storable "iv:tag:ciphertext" hex string.
 */
export function encrypt(text: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a value produced by `encrypt()`. Throws on tampered or invalid data.
 */
export function decrypt(data: string): string {
  const key = deriveKey();
  const parts = data.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const [ivHex, tagHex, encHex] = parts;
  const iv  = Buffer.from(ivHex,  "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * Safely decrypt — returns null on any error (missing value, wrong key, etc.).
 */
export function safeDecrypt(data: string | null | undefined): string | null {
  if (!data) return null;
  try {
    return decrypt(data);
  } catch {
    return null;
  }
}
