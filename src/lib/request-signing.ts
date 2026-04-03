/**
 * Request Signing for Sensitive APIs
 * 
 * Implements HMAC-based request authentication for:
 * - Webhook verification
 * - Sensitive API endpoint protection
 * - Inter-service communication
 */

import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "crypto";

const REQUEST_SIGNING_SECRET = process.env.REQUEST_SIGNING_SECRET || process.env.NEXTAUTH_SECRET;
if (!REQUEST_SIGNING_SECRET) {
  throw new Error("REQUEST_SIGNING_SECRET or NEXTAUTH_SECRET must be configured in environment variables");
}

export interface SignedRequest {
  signature: string;
  timestamp: number;
  payload: string;
}

export interface RequestSignatureResult {
  valid: boolean;
  error?: string;
  timestamp?: number;
}

/**
 * Generate HMAC signature for request payload
 */
export function signRequest(
  payload: string,
  timestamp: number = Date.now()
): { signature: string; timestamp: number } {
  if (!REQUEST_SIGNING_SECRET) {
    throw new Error("REQUEST_SIGNING_SECRET not configured");
  }
  
  const data = `${timestamp}.${payload}`;
  const signature = createHmac("sha256", REQUEST_SIGNING_SECRET)
    .update(data)
    .digest("hex");
  
  return { signature, timestamp };
}

/**
 * Verify request signature
 */
export function verifyRequestSignature(
  signature: string,
  timestamp: number,
  payload: string,
  options: {
    maxAgeMs?: number;
    toleranceMs?: number;
  } = {}
): RequestSignatureResult {
  if (!REQUEST_SIGNING_SECRET) {
    return { valid: false, error: "Signing secret not configured" };
  }
  
  const { maxAgeMs = 5 * 60 * 1000, toleranceMs = 30_000 } = options; // 5 min default
  
  // Check timestamp freshness
  const now = Date.now();
  const age = now - timestamp;
  
  if (age < -toleranceMs) {
    // Timestamp is in the future (clock skew or attack)
    return { valid: false, error: "Request timestamp too far in the future", timestamp };
  }
  
  if (age > maxAgeMs) {
    return { valid: false, error: "Request signature expired", timestamp };
  }
  
  // Verify signature
  const expected = signRequest(payload, timestamp);
  
  if (!timingSafeEqual(signature, expected.signature)) {
    return { valid: false, error: "Invalid signature", timestamp };
  }
  
  return { valid: true, timestamp };
}

/**
 * Extract signature from request headers
 */
export function extractSignature(req: Request): SignedRequest | null {
  const signature = req.headers.get("x-request-signature");
  const timestamp = req.headers.get("x-request-timestamp");
  
  if (!signature || !timestamp) {
    return null;
  }
  
  return {
    signature,
    timestamp: parseInt(timestamp, 10),
    payload: "", // Will be set based on request body
  };
}

/**
 * Generate signature headers for fetch request
 */
export function getSignatureHeaders(
  payload: string,
  timestamp?: number
): Record<string, string> {
  const { signature, timestamp: ts } = signRequest(payload, timestamp);
  
  return {
    "X-Request-Signature": signature,
    "X-Request-Timestamp": String(ts),
  };
}

/**
 * Middleware to validate signed requests
 */
export async function validateSignedRequest(
  req: Request,
  options?: {
    maxAgeMs?: number;
    getBody?: () => Promise<string>;
  }
): Promise<RequestSignatureResult> {
  const signed = extractSignature(req);
  
  if (!signed) {
    return { valid: false, error: "Missing signature headers" };
  }
  
  // Get request body for signature verification
  let payload = "";
  if (options?.getBody) {
    try {
      payload = await options.getBody();
    } catch {
      return { valid: false, error: "Failed to read request body" };
    }
  } else if (["POST", "PUT", "PATCH"].includes(req.method)) {
    // Clone request to read body without consuming original
    try {
      const clone = req.clone();
      payload = await clone.text();
    } catch {
      return { valid: false, error: "Failed to read request body" };
    }
  }
  
  return verifyRequestSignature(signed.signature, signed.timestamp, payload, options);
}

/**
 * Constant-time string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  
  try {
    return cryptoTimingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Quick signature check for webhooks
 * Returns true if signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret?: string
): boolean {
  const actualSecret = secret ?? REQUEST_SIGNING_SECRET;
  if (!actualSecret) return false;
  
  const expected = createHmac("sha256", actualSecret as string)
    .update(payload)
    .digest("hex");
  
  return timingSafeEqual(signature, expected);
}
