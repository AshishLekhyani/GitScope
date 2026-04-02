import crypto from "crypto";

const ENCRYPTED_PREFIX = "enc:v1:";
const AES_KEY_BYTES = 32;

function parseEncryptionKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const fromBase64 = Buffer.from(trimmed, "base64");
    if (fromBase64.length === AES_KEY_BYTES) return fromBase64;
  } catch {
    // fall through
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  return null;
}

function getEncryptionKey(): Buffer | null {
  const configured =
    process.env.GITHUB_PAT_ENCRYPTION_KEY ??
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY ??
    process.env.GITHUB_API_KEY_ENCRYPTION_KEY;

  if (!configured) return null;
  return parseEncryptionKey(configured);
}

export function canEncryptGitHubToken(): boolean {
  return Boolean(getEncryptionKey());
}

export function isEncryptedGitHubToken(stored: string): boolean {
  return stored.startsWith(ENCRYPTED_PREFIX);
}

export function encryptGitHubToken(plainToken: string): string | null {
  const key = getEncryptionKey();
  if (!key) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainToken, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptGitHubToken(storedValue: string): string | null {
  if (!storedValue) return null;
  if (!isEncryptedGitHubToken(storedValue)) return storedValue;

  const key = getEncryptionKey();
  if (!key) return null;

  const payload = storedValue.slice(ENCRYPTED_PREFIX.length);
  const [ivB64, tagB64, encryptedB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !encryptedB64) return null;

  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const encrypted = Buffer.from(encryptedB64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
