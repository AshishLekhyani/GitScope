"use client";

import { MaterialIcon } from "@/components/material-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getContributors, getCommitActivity } from "@/services/githubClient";
import type { GitHubContributor, CommitActivityWeek } from "@/types/github";
import { formatNumber } from "@/utils/formatDate";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Image from "next/image";

/* ─── Contributor Heatmap ─── */
function VelocityHeatmap({ weeks }: { weeks: CommitActivityWeek[] }) {
  // Build a grid from weekly data — each week has 7 days
  const allDays: number[] = [];
  const recentWeeks = weeks.slice(-7); // last ~7 weeks
  recentWeeks.forEach((w) => allDays.push(...w.days));

  const max = Math.max(...allDays, 1);

  return (
    <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6 shadow-sm dark:shadow-none">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MaterialIcon name="check_circle" size={18} className="text-tertiary" />
          <h3 className="font-heading text-base font-bold text-foreground">
            Contributor Velocity Heatmap
          </h3>
        </div>
        <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span>Less</span>
          {[0.1, 0.3, 0.5, 0.7, 1].map((o, i) => (
            <span
              key={i}
              className="size-3 rounded-sm"
              style={{ backgroundColor: `rgba(78, 222, 163, ${o})` }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {allDays.map((val, i) => {
          const intensity = val / max;
          return (
            <div
              key={i}
              className="size-4 rounded-sm"
              style={{
                backgroundColor:
                  intensity === 0
                    ? "hsl(var(--surface-container-high))"
                    : `rgba(78, 222, 163, ${Math.max(0.15, intensity)})`,
              }}
              title={`${val} commits`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ─── Top Engineering Impact ─── */
function TopContributors({ contributors }: { contributors: GitHubContributor[] }) {
  const top = contributors.slice(0, 5);
  const maxContribs = top[0]?.contributions ?? 1;

  return (
    <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6 shadow-sm dark:shadow-none">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MaterialIcon name="analytics" size={18} className="text-primary" />
          <h3 className="font-heading text-base font-bold text-foreground">
            Top Engineering Impact
          </h3>
        </div>
        <span className="rounded-md border border-outline-variant/20 px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
          Score Normalized: 0-100
        </span>
      </div>
      <div className="space-y-1">
        {top.map((c, idx) => {
          const impactScore = ((c.contributions / maxContribs) * 100).toFixed(1);
          return (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="flex items-center gap-4 rounded-lg p-3 transition-colors hover:bg-surface-container-high"
            >
              <Image
                src={c.avatar_url}
                width={40}
                height={40}
                alt={c.login}
                className="size-10 rounded-full"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{c.login}</p>
                <p className="text-[10px] text-muted-foreground">Contributor</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                  Impact Score
                </p>
                <p className="font-heading text-lg font-bold text-tertiary">
                  {impactScore}
                </p>
              </div>
              <div className="hidden text-center sm:block">
                <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                  Commits
                </p>
                <p className="font-mono text-sm text-foreground">
                  {formatNumber(c.contributions)}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Peak Performance ─── */
function PeakPerformance({ weeks }: { weeks: CommitActivityWeek[] }) {
  // Aggregate daily patterns across all weeks
  const dayTotals = [0, 0, 0, 0, 0, 0, 0];
  weeks.forEach((w) => {
    w.days.forEach((v, i) => {
      dayTotals[i] += v;
    });
  });
  const max = Math.max(...dayTotals, 1);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Find peak day
  const peakIdx = dayTotals.indexOf(Math.max(...dayTotals));

  return (
    <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6 shadow-sm dark:shadow-none">
      <div className="mb-4 flex items-center gap-2">
        <MaterialIcon name="schedule" size={18} className="text-primary" />
        <h3 className="font-heading text-base font-bold text-foreground">
          Peak Performance
        </h3>
      </div>
      <div className="flex items-end gap-1.5">
        {dayTotals.map((val, i) => (
          <div key={i} className="flex-1 text-center">
            <div
              className={cn(
                "mx-auto w-full rounded-sm",
                i === peakIdx ? "bg-primary" : "bg-primary/30"
              )}
              style={{ height: `${Math.max(4, (val / max) * 80)}px` }}
            />
            <span className="mt-1 block text-[8px] text-muted-foreground">
              {days[i]}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg bg-surface-container-lowest p-3">
        <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
          Most Active Day
        </p>
        <p className="font-heading text-lg font-bold text-foreground">
          {days[peakIdx]}
        </p>
        <p className="text-muted-foreground text-xs">
          Highest density of commits recorded on this day across all tracked weeks.
        </p>
      </div>

      {/* Cycle Time */}
      <div className="mt-4 rounded-lg bg-gradient-to-r from-tertiary/20 to-tertiary/5 p-4">
        <p className="font-mono text-[9px] tracking-widest text-tertiary uppercase">
          Avg Weekly Commits
        </p>
        <p className="font-heading text-2xl font-bold text-foreground">
          {weeks.length ? Math.round(weeks.reduce((s, w) => s + w.total, 0) / weeks.length) : 0}
        </p>
      </div>
    </div>
  );
}

/* ─── All Contributors with load-more ─── */
function AllContributorsList({ contributors }: { contributors: GitHubContributor[] }) {
  const [visible, setVisible] = useState(15);
  const rest = contributors.slice(5);
  const shown = rest.slice(0, visible);

  return (
    <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6 shadow-sm dark:shadow-none">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-heading text-base font-bold text-foreground">
          All Contributors
        </h3>
        <span className="font-mono text-[9px] text-muted-foreground tracking-widest uppercase">
          {shown.length} / {rest.length} shown
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => (
          <a
            key={c.id}
            href={c.html_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-surface-container-high"
          >
            <Image
              src={c.avatar_url}
              width={32}
              height={32}
              alt={c.login}
              className="size-8 rounded-full"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{c.login}</p>
              <p className="font-mono text-[10px] text-muted-foreground">
                {formatNumber(c.contributions)} commits
              </p>
            </div>
          </a>
        ))}
      </div>
      {visible < rest.length && (
        <button
          type="button"
          onClick={() => setVisible((v) => Math.min(v + 15, rest.length))}
          className="mt-4 w-full py-2.5 rounded-lg border border-outline-variant/20 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-surface-container-high transition-all"
        >
          Load {Math.min(15, rest.length - visible)} more contributors
        </button>
      )}
    </div>
  );
}

/* ─── Main ─── */
export function ContributorsPageClient({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  const contribQ = useQuery({
    queryKey: ["contributors", owner, repo],
    queryFn: () => getContributors(owner, repo),
  });

  const activityQ = useQuery({
    queryKey: ["commit-activity", owner, repo],
    queryFn: () => getCommitActivity(owner, repo),
  });

  const contributors = contribQ.data?.data ?? [];
  const weeks = activityQ.data?.data ?? [];
  const loading = contribQ.isLoading;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-6"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Contributor Insights
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-tertiary" />
              {contributors.length} Active Contributors
            </span>
            <span>/</span>
            <span>Last updated: just now</span>
          </div>
        </div>
      </div>

      {/* Heatmap */}
      {weeks.length > 0 && <VelocityHeatmap weeks={weeks} />}

      {/* Impact + Peak Performance */}
      <div className="grid gap-6 lg:grid-cols-[1fr_260px] xl:grid-cols-[1fr_300px]">
        <TopContributors contributors={contributors} />
        <PeakPerformance weeks={weeks} />
      </div>

      {/* All Contributors with pagination */}
      {contributors.length > 5 && (
        <AllContributorsList contributors={contributors} />
      )}
    </motion.div>
  );
}
