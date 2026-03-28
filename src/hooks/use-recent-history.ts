import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";

export type HistoryItem = {
  id: string; // This is the query (e.g., "vercel/next.js" or "ashish")
  name: string;
  type: "repo" | "user";
  avatar?: string;
  timestamp: number;
};

const STORAGE_KEY = "gitscope_recent_history";

export function useRecentHistory() {
  const { status } = useSession();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const initialSyncDone = useRef(false);

  // Initial Sync — runs only once per session lifecycle
  useEffect(() => {
    if (initialSyncDone.current) return;

    async function syncHistory() {
      if (status === "authenticated") {
        initialSyncDone.current = true;
        try {
          const res = await fetch("/api/user/history", { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            setHistory(data.history || []);
          }
        } catch (e) {
          console.error("Failed to sync DB history", e);
        }
        setLoading(false);
      } else if (status === "unauthenticated") {
        initialSyncDone.current = true;
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            setHistory(JSON.parse(stored));
          } catch (e) {
            console.error("Failed to parse local history", e);
          }
        }
        setLoading(false);
      }
      // Don't setLoading(false) if status is still "loading"
    }

    syncHistory();
  }, [status]);

  const addToHistory = useCallback(async (item: Omit<HistoryItem, "timestamp">) => {
    const timestamp = Date.now();
    const newItem = { ...item, timestamp };

    // Optimistic UI Update
    setHistory((prev) => {
      const filtered = prev.filter((i) => i.id !== item.id);
      const updated = [newItem, ...filtered].slice(0, 10);
      
      if (status !== "authenticated") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
      return updated;
    });

    // Server-side Sync
    if (status === "authenticated") {
      try {
        await fetch("/api/user/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
      } catch (e) {
        console.error("Failed to persist history to DB", e);
      }
    }
  }, [status]);

  const clearHistory = useCallback(async () => {
    setHistory([]);
    if (status === "authenticated") {
      try {
        await fetch("/api/user/history", { method: "DELETE" });
      } catch (e) {
        console.error("Failed to clear history from DB", e);
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [status]);

  return { history, addToHistory, clearHistory, loading };
}
// useRecentHistory v1
