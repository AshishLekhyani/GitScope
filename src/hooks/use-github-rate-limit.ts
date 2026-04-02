import { useState, useEffect } from "react";

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  /** Unix timestamp (seconds) when the rate limit window resets */
  reset: number;
}

export function useGitHubRateLimit() {
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [latency, setLatency] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRate() {
      const start = performance.now();
      try {
        const res = await fetch("/api/github/rate-limit", { cache: "no-store" });
        const end = performance.now();
        setLatency(Math.round(end - start));

        if (res.ok) {
          const data = await res.json();
          setRateLimit({ remaining: data.remaining, limit: data.limit, reset: data.reset ?? 0 });
        }
      } catch (e) {
        console.error("Failed to fetch rate limit", e);
      } finally {
        setLoading(false);
      }
    }

    fetchRate();
    const interval = setInterval(fetchRate, 30000); // Sync every 30s
    return () => clearInterval(interval);
  }, []);

  return { rateLimit, latency, loading };
}
// useGitHubRateLimit v1
