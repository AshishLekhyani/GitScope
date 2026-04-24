"use client";

import { MaterialIcon } from "@/components/material-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getLanguages,
  getCommitActivity,
  getPullRequests,
  getContributors,
} from "@/services/githubClient";
import type { CommitActivityWeek } from "@/types/github";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import {
  Bar,
  BarChart,
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts/es6";

/* ─── PR Merge Frequency ─── */
function PRMergeFrequency({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["pulls", owner, repo],
    queryFn: () => getPullRequests(owner, repo),
  });

  if (isLoading) {
    return (
      <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 shadow-sm dark:shadow-none">
        <Skeleton className="mb-4 h-5 w-40" />
        <Skeleton className="h-[200px] w-full rounded-none" />
      </div>
    );
  }

  const pulls = data?.data ?? [];

  // Group PRs by week
  const weekMap: Record<string, { merged: number; open: number }> = {};
  pulls.forEach((pr) => {
    const d = new Date(pr.created_at);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    if (!weekMap[key]) weekMap[key] = { merged: 0, open: 0 };
    if (pr.merged_at) {
      weekMap[key].merged++;
    } else {
      weekMap[key].open++;
    }
  });

  const chartData = Object.entries(weekMap)
    .slice(-8)
    .map(([name, v]) => ({ name, ...v }));

  return (
    <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 shadow-sm dark:shadow-none">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MaterialIcon name="merge" size={18} className="text-tertiary" />
          <h3 className="font-heading text-lg font-bold text-foreground">
            PR Merge Frequency
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-tertiary/10 px-2 py-0.5 font-mono text-[9px] text-tertiary">
          <span className="size-1.5 rounded-full bg-tertiary" />
          LIVE_DATA
        </span>
      </div>
      {chartData.length > 0 ? (
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  background: "var(--surface-container-high)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                  color: "var(--foreground)",
                }}
                itemStyle={{ color: "var(--foreground)" }}
              />
              <Bar dataKey="merged" fill="#10b981" radius={[2, 2, 0, 0]} name="Merged" stackId="a" />
              <Bar dataKey="open" fill="#f59e0b" radius={[2, 2, 0, 0]} name="Open" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-muted-foreground py-10 text-center text-sm">
          No pull request data available.
        </p>
      )}
      <div className="mt-3 flex gap-4">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: "#10b981" }} /> Merged
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: "#f59e0b" }} /> Open
        </span>
      </div>
    </div>
  );
}

/* ─── Code Size from commit activity ─── */
function CodeSizeProgression({ owner, repo }: { owner: string; repo: string }) {
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "6m" | "1y">("6m");
  const [commits, setCommits] = useState<Array<{ date: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCommits() {
      setLoading(true);
      try {
        const sinceDate = new Date();
        if (range === "7d") sinceDate.setDate(sinceDate.getDate() - 7);
        else if (range === "30d") sinceDate.setDate(sinceDate.getDate() - 30);
        else if (range === "90d") sinceDate.setDate(sinceDate.getDate() - 90);
        else if (range === "6m") sinceDate.setMonth(sinceDate.getMonth() - 6);
        else if (range === "1y") sinceDate.setFullYear(sinceDate.getFullYear() - 1);

        const res = await fetch(
          `/api/github/repos/${owner}/${repo}/commits?per_page=100&since=${sinceDate.toISOString()}`
        );
        const data = await res.json();
        
        // Aggregate commits by day
        const commitCounts: Record<string, number> = {};
        if (Array.isArray(data)) {
          data.forEach((commit: { commit: { author: { date: string } } }) => {
            const date = commit.commit.author.date.split('T')[0];
            commitCounts[date] = (commitCounts[date] || 0) + 1;
          });
        }
        
        // Build daily data array
        const dailyData: Array<{ date: string; count: number }> = [];
        const endDate = new Date();
        const currentDate = new Date(sinceDate);
        
        while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          dailyData.push({
            date: dateStr,
            count: commitCounts[dateStr] || 0,
          });
          currentDate.setDate(currentDate.getDate() + 1);
        }
        
        setCommits(dailyData);
      } catch (e) {
        console.error("Failed to fetch commits:", e);
      } finally {
        setLoading(false);
      }
    }
    
    fetchCommits();
  }, [owner, repo, range]);
  
  // Build daily data (non-cumulative)
  const data = commits.map((day) => ({
    name: new Date(day.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    commits: day.count,
  }));

  return (
    <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 shadow-sm dark:shadow-none">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MaterialIcon name="data_usage" size={18} className="text-secondary" />
          <h3 className="font-heading text-lg font-bold text-foreground">
            Daily Commits
          </h3>
          <p className="text-muted-foreground text-xs">
            Commits per day for selected range
          </p>
        </div>
        <div className="flex rounded-none border border-outline-variant/20 bg-surface-container-lowest p-0.5">
          {(["7d", "30d", "90d", "6m", "1y"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setRange(t)}
              className={cn(
                "rounded px-3 py-1 font-mono text-[10px] font-bold tracking-widest uppercase transition-all",
                range === t
                  ? "bg-surface-container-high text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {data.length > 0 ? (
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="codeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" minTickGap={30} />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  background: "var(--surface-container-high)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                  color: "var(--foreground)",
                }}
                itemStyle={{ color: "var(--foreground)" }}
              />
              <Area
                type="monotone"
                dataKey="commits"
                stroke="#f59e0b"
                fill="url(#codeGrad)"
                strokeWidth={2}
                name="Commits"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-muted-foreground py-10 text-center text-sm">
          No commit data available.
        </p>
      )}
    </div>
  );
}

/* ─── Language Bars ─── */
function TopLanguages({ languages, loading }: { languages: Record<string, number>; loading: boolean }) {
  const total = Object.values(languages).reduce((a, b) => a + b, 0);
  const data = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => ({
      name,
      pct: total ? Math.round((value / total) * 1000) / 10 : 0,
      bytes: value,
    }));

  if (loading) {
    return (
      <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 shadow-sm dark:shadow-none">
        <Skeleton className="mb-4 h-5 w-32" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="mt-3 h-5 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-none border border-outline-variant/15 bg-surface-container p-6 shadow-sm dark:shadow-none">
      <div className="mb-4 flex items-center gap-2">
        <MaterialIcon name="code" size={18} className="text-primary" />
        <h3 className="font-heading text-base font-bold text-foreground">
          Top Languages
        </h3>
      </div>
      <div className="space-y-3">
        {data.map((lang) => (
          <div key={lang.name}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-foreground">{lang.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {lang.pct}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${lang.pct}%`,
                  backgroundColor: ["#f59e0b", "#10b981", "#f59e0b", "#ef4444", "#f59e0b", "#f59e0b"][
                    data.findIndex((l) => l.name === lang.name) % 6
                  ],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Summary Stats ─── */
function SummaryStats({
  languages,
  contributors,
  weeks,
}: {
  languages: Record<string, number>;
  contributors: number;
  weeks: CommitActivityWeek[];
}) {
  const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0);
  const last4Weeks = weeks.slice(-4);
  const recentCommits = last4Weeks.reduce((s, w) => s + w.total, 0);

  const stats = [
    { label: "Total Languages", value: Object.keys(languages).length.toString(), icon: "code" },
    { label: "Code Volume", value: `${(totalBytes / 1024).toFixed(0)} KB`, icon: "storage" },
    { label: "Monthly Commits", value: recentCommits.toString(), icon: "commit" },
    { label: "Contributors", value: contributors.toString(), icon: "groups" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-none border border-outline-variant/15 bg-surface-container p-4 shadow-sm dark:shadow-none"
        >
          <div className="flex items-center gap-2">
            <MaterialIcon name={s.icon} size={18} className="text-muted-foreground" />
            <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
              {s.label}
            </p>
          </div>
          <p className="font-heading mt-1 text-2xl font-bold text-foreground">
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ─── Main ─── */
export function CodePageClient({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  const langQ = useQuery({
    queryKey: ["languages", owner, repo],
    queryFn: () => getLanguages(owner, repo),
  });

  const activityQ = useQuery({
    queryKey: ["commit-activity", owner, repo],
    queryFn: () => getCommitActivity(owner, repo),
  });

  const contribQ = useQuery({
    queryKey: ["contributors", owner, repo],
    queryFn: () => getContributors(owner, repo),
  });

  const langs = langQ.data?.data ?? {};
  const weeks = activityQ.data?.data ?? [];
  const contribs = contribQ.data?.data ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-6"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
            <span>{owner}</span>
            <span>/</span>
            <span className="text-primary font-bold">{repo}</span>
          </div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Technical Deep Dive
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Code structure analysis, PR merge patterns, and language distribution.
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <SummaryStats
        languages={langs}
        contributors={contribs.length}
        weeks={weeks}
      />

      {/* PR Merge + Languages */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <PRMergeFrequency owner={owner} repo={repo} />
        <TopLanguages languages={langs} loading={langQ.isLoading} />
      </div>

      {/* Code Size */}
      <CodeSizeProgression owner={owner} repo={repo} />
    </motion.div>
  );
}
