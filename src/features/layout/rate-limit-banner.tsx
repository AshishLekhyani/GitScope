"use client";

import { useGitHubRateLimit } from "@/hooks/use-github-rate-limit";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import Link from "next/link";

function formatResetTime(resetUnix: number): string {
  if (!resetUnix) return "";
  const resetMs = resetUnix * 1000;
  const now = Date.now();
  const diffMs = resetMs - now;
  if (diffMs <= 0) return "shortly";
  const diffMin = Math.ceil(diffMs / 60_000);
  if (diffMin < 60) return `in ${diffMin} min`;
  const resetDate = new Date(resetMs);
  return `at ${resetDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function RateLimitBanner() {
  const { rateLimit, loading } = useGitHubRateLimit();
  const [dismissed, setDismissed] = useState(false);
  const [resetLabel, setResetLabel] = useState("");

  useEffect(() => {
    if (!rateLimit?.reset) return;
    setResetLabel(formatResetTime(rateLimit.reset));
    const id = setInterval(() => setResetLabel(formatResetTime(rateLimit.reset)), 30_000);
    return () => clearInterval(id);
  }, [rateLimit?.reset]);

  if (loading || !rateLimit || dismissed) return null;

  const { remaining, limit } = rateLimit;
  const pct = limit > 0 ? (remaining / limit) * 100 : 100;
  const exhausted = remaining === 0;
  const critical = remaining > 0 && pct < 5;   // < 5% left
  const warning = remaining > 0 && pct < 15;   // < 15% left

  if (!exhausted && !critical && !warning) return null;

  const statusColor = exhausted
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : critical
      ? "border-orange-500/40 bg-orange-500/10 text-orange-500"
      : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";

  const barColor = exhausted
    ? "bg-destructive"
    : critical
      ? "bg-orange-500"
      : "bg-amber-400";

  return (
    <div
      className={cn(
        "fixed top-20 right-4 z-[100] w-80 max-w-[calc(100vw-2rem)] rounded-lg border shadow-lg backdrop-blur-sm",
        statusColor
      )}
    >
      <div className="p-3.5">
        {/* Header row with icon, title, and close */}
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              "mt-0.5 shrink-0 rounded-full p-1",
              exhausted
                ? "bg-destructive/20 text-destructive"
                : critical
                  ? "bg-orange-500/20 text-orange-500"
                  : "bg-amber-500/20 text-amber-500"
            )}
          >
            <MaterialIcon
              name={exhausted ? "block" : "warning"}
              size={14}
              className={cn(exhausted && "animate-pulse")}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold leading-tight">
              {exhausted
                ? "GitHub API limit exhausted"
                : critical
                  ? "GitHub API critically low"
                  : "GitHub API limit low"}
            </p>
            <p className="mt-0.5 text-[11px] opacity-80 leading-snug">
              {exhausted
                ? `All requests blocked${resetLabel ? ` · resets ${resetLabel}` : ""}`
                : `${remaining.toLocaleString()} of ${limit.toLocaleString()} left${resetLabel ? ` · resets ${resetLabel}` : ""}`}
            </p>
          </div>

          {/* Close button — always visible */}
          <button
            type="button"
            aria-label="Dismiss rate limit warning"
            onClick={() => setDismissed(true)}
            className="shrink-0 -mr-1 -mt-1 rounded p-1 opacity-60 hover:opacity-100 transition-opacity"
          >
            <MaterialIcon name="close" size={14} />
          </button>
        </div>

        {/* Mini progress bar */}
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div
            className={cn("h-full rounded-full transition-all duration-700", barColor)}
            style={{ width: exhausted ? "100%" : `${100 - pct}%` }}
          />
        </div>

        {/* CTA */}
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[10px] font-mono opacity-60 uppercase tracking-wider">
            {exhausted ? "Limit reached" : `${remaining.toLocaleString()} remaining`}
          </span>
          <Link
            href="/settings?tab=workspace"
            className="text-[11px] font-medium underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity"
          >
            Add token →
          </Link>
        </div>
      </div>
    </div>
  );
}
