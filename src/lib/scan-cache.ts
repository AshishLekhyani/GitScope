/**
 * Public Repo Scan Cache
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-user cache for PUBLIC repository LLM scan results.
 * Private repos are NEVER cached here (would leak data across users).
 *
 * Flow:
 *   1. Before LLM call → checkPublicScanCache(repo, scanMode)
 *   2. If hit → return cached result, increment hit_count, skip LLM
 *   3. After LLM call → savePublicScanCache(repo, scanMode, result)
 *
 * TTL: 24 h (quick) / 48 h (deep)
 */

import { prisma } from "@/lib/prisma";

const TTL_MS: Record<string, number> = {
  quick: 24 * 60 * 60 * 1000,  // 24 h
  deep:  48 * 60 * 60 * 1000,  // 48 h
};

function ttl(scanMode: string): number {
  return TTL_MS[scanMode] ?? TTL_MS.quick;
}

export async function checkPublicScanCache(
  repo: string,
  scanMode: string,
  isPrivate: boolean,
): Promise<Record<string, unknown> | null> {
  // Never cache private repos
  if (isPrivate) return null;

  try {
    const entry = await prisma.publicScanCache.findUnique({
      where: { repo_scanMode: { repo, scanMode } },
    });

    if (!entry || entry.expiresAt < new Date()) {
      // Expired — delete it so it gets refreshed
      if (entry) {
        await prisma.publicScanCache.delete({ where: { id: entry.id } }).catch(() => {});
      }
      return null;
    }

    // Cache hit — increment counter non-blocking
    prisma.publicScanCache.update({
      where: { id: entry.id },
      data: { hitCount: { increment: 1 } },
    }).catch(() => {});

    return entry.result as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function savePublicScanCache(
  repo: string,
  scanMode: string,
  result: Record<string, unknown>,
  isPrivate: boolean,
): Promise<void> {
  if (isPrivate) return;

  try {
    const expiresAt = new Date(Date.now() + ttl(scanMode));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = result as any;
    await prisma.publicScanCache.upsert({
      where: { repo_scanMode: { repo, scanMode } },
      create: { repo, scanMode, result: json, expiresAt },
      update: { result: json, expiresAt, hitCount: 0 },
    });
  } catch {
    // Non-fatal — cache write failure never breaks the scan
  }
}

/** Prune expired entries — call from a scheduled job or on-demand. */
export async function prunePublicScanCache(): Promise<number> {
  try {
    const { count } = await prisma.publicScanCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  } catch {
    return 0;
  }
}
