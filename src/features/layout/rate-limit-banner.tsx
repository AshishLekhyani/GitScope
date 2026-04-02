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

  return (
    <div
      className={cn(
        "relative z-40 w-full border-b px-4 py-2.5",
        exhausted
          ? "border-destructive/40 bg-destructive/10"
          : critical
            ? "border-orange-500/40 bg-orange-500/10"
            : "border-amber-500/30 bg-amber-500/8"
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        {/* Icon */}
        <div
          className={cn(
            "shrink-0 rounded-full p-1",
            exhausted
              ? "bg-destructive/20 text-destructive"
              : critical
                ? "bg-orange-500/20 text-orange-500"
                : "bg-amber-500/20 text-amber-500"
          )}
        >
          <MaterialIcon
            name={exhausted ? "block" : "warning"}
            size={16}
            className={cn(exhausted && "animate-pulse")}
          />
        </div>

        {/* Rate limit bar */}
        <div className="hidden w-28 shrink-0 sm:block">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/20">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-700",
                exhausted
                  ? "bg-destructive"
                  : critical
                    ? "bg-orange-500"
                    : "bg-amber-400"
              )}
              style={{ width: exhausted ? "100%" : `${100 - pct}%` }}
            />
          </div>
          <p className="mt-0.5 font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
            {exhausted ? "Limit reached" : `${remaining.toLocaleString()} left`}
          </p>
        </div>

        {/* Message */}
        <div className="flex-1 min-w-0">
          <span
            className={cn(
              "font-mono text-xs font-bold",
              exhausted
                ? "text-destructive"
                : critical
                  ? "text-orange-500"
                  : "text-amber-600 dark:text-amber-400"
            )}
          >
            {exhausted
              ? `GitHub API rate limit exhausted — all requests are blocked${resetLabel ? ` (resets ${resetLabel})` : ""}.`
              : critical
                ? `Critical: only ${remaining} GitHub API requests remaining${resetLabel ? `, resets ${resetLabel}` : ""}.`
                : `GitHub API limit low — ${remaining.toLocaleString()} of ${limit.toLocaleString()} requests remaining${resetLabel ? `, resets ${resetLabel}` : ""}.`}
          </span>
          {" "}
          <Link
            href="/settings?tab=workspace"
            className={cn(
              "font-mono text-xs underline underline-offset-2 transition-opacity hover:opacity-80",
              exhausted ? "text-destructive" : critical ? "text-orange-500" : "text-amber-600 dark:text-amber-400"
            )}
          >
            Add your own token →
          </Link>
        </div>

        {/* Dismiss */}
        {!exhausted && (
          <button
            type="button"
            aria-label="Dismiss rate limit warning"
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-60 hover:opacity-100 transition-opacity"
          >
            <MaterialIcon name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
