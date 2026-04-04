"use client";

import { useState, useEffect, useCallback } from "react";

const CURRENT_VERSION = "1.0.0.0";
const STORAGE_KEY = "gitscope_last_seen_version";

interface VersionInfo {
  currentVersion: string;
  lastSeenVersion: string | null;
  hasNewUpdate: boolean;
  lastUpdateTimestamp: number;
  markAsSeen: () => void;
}

/**
 * Hook to track version updates and show notification indicator
 * 
 * Usage:
 * const { hasNewUpdate, markAsSeen } = useVersionTracking();
 * 
 * // In nav bar:
 * {hasNewUpdate && <RadiatingDot />}
 * 
 * // On changelog page mount:
 * useEffect(() => { markAsSeen(); }, []);
 */
export function useVersionTracking(): VersionInfo {
  const [lastSeenVersion, setLastSeenVersion] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState<number>(0);

  useEffect(() => {
    setMounted(true);
    // Check localStorage for last seen version
    const stored = localStorage.getItem(STORAGE_KEY);
    setLastSeenVersion(stored);
    // Set timestamp when a new update is detected
    if (stored !== CURRENT_VERSION) {
      setLastUpdateTimestamp(Date.now());
    }
  }, []);

  const markAsSeen = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
    setLastSeenVersion(CURRENT_VERSION);
    setLastUpdateTimestamp(0);
  }, []);

  // Check if current version is newer than last seen
  const hasNewUpdate = mounted && lastSeenVersion !== CURRENT_VERSION;

  return {
    currentVersion: CURRENT_VERSION,
    lastSeenVersion,
    hasNewUpdate,
    lastUpdateTimestamp,
    markAsSeen,
  };
}

/**
 * Get current app version
 */
export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}

/**
 * Compare two version strings (format: major.minor.patch.bugfix)
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}
