/**
 * Client-side helpers for consuming AI Server-Sent Event streams.
 * Automatically triggers the usage-limit toast when quota is exhausted.
 * Import only in 'use client' components.
 */

import { triggerUsageLimitToast } from "@/components/ui/usage-limit-toast";

export interface StreamCallbacks {
  onStatus?: (step: string) => void;
  onDelta?: (text: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (error: string) => void;
}

/**
 * Consume an SSE stream from any /api/ai/* route.
 * Automatically shows the usage-limit toast if the server signals quota exhaustion.
 */
export async function consumeAIStream(
  url: string,
  body: Record<string, unknown>,
  feature: string,
  callbacks: StreamCallbacks
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const err = `Server error ${res.status}`;
    callbacks.onError?.(err);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const payload = JSON.parse(line.slice(6)) as {
          type: string;
          text?: string;
          step?: string;
          error?: string;
        };

        if (payload.type === "status") {
          callbacks.onStatus?.(payload.step ?? "");
        } else if (payload.type === "delta") {
          const delta = payload.text ?? "";
          accumulated += delta;
          callbacks.onDelta?.(delta);
        } else if (payload.type === "done") {
          if (payload.error) {
            // Detect usage limit errors and trigger global toast
            if (
              payload.error.toLowerCase().includes("usage limit") ||
              payload.error.toLowerCase().includes("limit reached")
            ) {
              const resetMatch = payload.error.match(/resets in (\d+) min/i);
              const resetInMinutes = resetMatch ? parseInt(resetMatch[1]) : undefined;
              triggerUsageLimitToast(feature, resetInMinutes);
            }
            callbacks.onError?.(payload.error);
          } else {
            callbacks.onDone?.(payload.text ?? accumulated);
          }
        }
      } catch { /* malformed SSE line — skip */ }
    }
  }
}
