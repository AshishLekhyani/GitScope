"use client";

import { useState, useEffect } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getCommitActivity,
  getContributors,
  getLanguages,
  getRepoDetails,
} from "@/services/githubClient";
import { useAppDispatch } from "@/store/hooks";
import { addBookmark, removeBookmark } from "@/lib/bookmarks";
import { addRecentSearch } from "@/store/slices/dashboardSlice";
import { useRecentHistory } from "@/hooks/use-recent-history";
import type { CommitActivityWeek } from "@/types/github";
import { useQuery } from "@tanstack/react-query";
import { Star, Bookmark } from "lucide-react";
import { motion } from "framer-motion";
import { MetricCards } from "./metric-cards";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
  CartesianGrid,
} from "recharts/es6";

/* ─── Commit Velocity Chart ─── */
function CommitVelocityChart({
  owner,
  repo,
  loading: initialLoading,
}: {
  owner: string;
  repo: string;
  loading: boolean;
}) {
  const [range, setRange] = useState<"1y" | "6m" | "90d" | "30d" | "7d">("6m");
  const [commits, setCommits] = useState<Array<{ date: string; count: number }>>([]);
  const [loading, setLoading] = useState(initialLoading);

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
    
    if (owner && repo) {
      fetchCommits();
    }
  }, [owner, repo, range]);

  const data = commits.map((day) => ({
    name: new Date(day.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    value: day.count,
  }));

  if (loading) {
    return (
      <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
        <Skeleton className="mb-4 h-5 w-48" />
        <Skeleton className="h-[240px] w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-md transition-all duration-300 hover:border-white/20 hover:shadow-lg dark:bg-slate-900/30 dark:shadow-none">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-lg font-bold text-foreground">
            Commit Velocity
          </h3>
          <p className="text-muted-foreground text-xs">
            Daily commits over the selected period
          </p>
        </div>
        <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
          {(["1y", "6m", "90d", "30d", "7d"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setRange(t)}
              className={cn(
                "rounded-md px-3 py-1 font-mono text-[10px] font-bold tracking-widest uppercase transition-all",
                range === t
                  ? "bg-white/10 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {data.length > 0 ? (
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="starGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" minTickGap={30} />
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
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--chart-1)"
                fill="url(#starGrad)"
                strokeWidth={2}
                name="Commits"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm py-10 text-center">
          No data available yet. GitHub may still be computing stats.
        </p>
      )}
    </div>
  );
}

/* ─── Top Contributors Chart ─── */
function TopContributorsChart({
  contributors,
  loading,
}: {
  contributors: Array<{ login: string; contributions: number; avatar_url: string }>;
  loading: boolean;
}) {
  const data = contributors
    .slice(0, 6)
    .map((c) => ({ name: c.login, contributions: c.contributions }));

  if (loading) {
    return (
      <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
        <Skeleton className="mb-4 h-5 w-36" />
        <Skeleton className="h-[160px] w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-md transition-all duration-300 hover:border-white/20 hover:shadow-lg dark:bg-slate-900/30 dark:shadow-none">
      <h3 className="mb-3 font-mono text-[10px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
        Top Contributors
      </h3>
      {data.length > 0 ? (
        <div className="h-[160px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis
                dataKey="name"
                type="category"
                width={100}
                tick={{ fontSize: 10 }}
                stroke="var(--muted-foreground)"
              />
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
              <Bar
                dataKey="contributions"
                fill="var(--chart-3)"
                radius={[0, 4, 4, 0]}
                barSize={20}
                name="Commits"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No contributor data.</p>
      )}
    </div>
  );
}

/* ─── Language Distribution Bars ─── */
function LanguageBars({
  languages,
  loading,
}: {
  languages: Record<string, number>;
  loading: boolean;
}) {
  const total = Object.values(languages).reduce((a, b) => a + b, 0);
  const data = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value]) => ({
      name,
      pct: total ? Math.round((value / total) * 1000) / 10 : 0,
    }));

  const barColors = [
    "fill-primary",
    "fill-[var(--tertiary)]",
    "fill-[var(--chart-3)]",
    "fill-[var(--chart-4)]",
    "fill-[var(--chart-5)]",
  ];

  if (loading) {
    return (
      <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
        <Skeleton className="mb-4 h-5 w-44" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="mt-3 h-6 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-md transition-all duration-300 hover:border-white/20 hover:shadow-lg dark:bg-slate-900/30 dark:shadow-none">
      <h3 className="mb-4 font-mono text-[10px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
        Language Distribution
      </h3>
      {data.length > 0 ? (
        <div className="space-y-3">
          {data.map((lang, i) => (
            <div key={lang.name}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-foreground">{lang.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {lang.pct}%
                </span>
              </div>
              <svg
                className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest"
                aria-hidden="true"
              >
                <rect
                  height="100%"
                  width={`${lang.pct}%`}
                  rx="9999"
                  className={barColors[i % barColors.length]}
                />
              </svg>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No language data.</p>
      )}
    </div>
  );
}

/* ─── Intelligent Insights ─── */
function IntelligentInsights({
  stars,
  forks,
  issues,
  contributors,
  weeks,
}: {
  stars: number;
  forks: number;
  issues: number;
  contributors: number;
  weeks: CommitActivityWeek[];
}) {
  // Generate real insights from the data
  const recentWeeks = weeks.slice(-4);
  const olderWeeks = weeks.slice(-8, -4);
  const recentAvg = recentWeeks.length
    ? recentWeeks.reduce((s, w) => s + w.total, 0) / recentWeeks.length
    : 0;
  const olderAvg = olderWeeks.length
    ? olderWeeks.reduce((s, w) => s + w.total, 0) / olderWeeks.length
    : 0;
  const velocityChange = olderAvg
    ? Math.round(((recentAvg - olderAvg) / olderAvg) * 100)
    : 0;
  const forkRatio = stars ? ((forks / stars) * 100).toFixed(1) : "0";
  const issueRatio = stars ? ((issues / stars) * 100).toFixed(1) : "0";

  const insights = [
    {
      icon: velocityChange >= 0 ? "check_circle" : "warning",
      color: velocityChange >= 0 ? "text-tertiary" : "text-destructive",
      bg: velocityChange >= 0 ? "bg-tertiary/10" : "bg-destructive/10",
      title:
        velocityChange >= 0
          ? "Strong Commit Velocity"
          : "Declining Commit Velocity",
      desc: `Recent commit activity is ${Math.abs(velocityChange)}% ${velocityChange >= 0 ? "higher" : "lower"} than the previous period.`,
    },
    {
      icon: Number(issueRatio) < 5 ? "check_circle" : "error",
      color: Number(issueRatio) < 5 ? "text-tertiary" : "text-amber-400",
      bg: Number(issueRatio) < 5 ? "bg-tertiary/10" : "bg-amber-400/10",
      title: "Issue-to-Star Ratio",
      desc: `${issueRatio}% of stargazers have corresponding open issues. ${Number(issueRatio) < 5 ? "Healthy maintenance signal." : "Consider reviewing issue triage."}`,
    },
    {
      icon: "diversity_3",
      color: "text-primary",
      bg: "bg-primary/10",
      title: "Contributor Diversity",
      desc: `${contributors}+ contributors with a fork ratio of ${forkRatio}% indicating ${Number(forkRatio) > 10 ? "strong" : "moderate"} community engagement.`,
    },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-md transition-all duration-300 hover:border-white/20 hover:shadow-lg dark:bg-slate-900/30 dark:shadow-none">
      <div className="mb-1 flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-amber-500/10">
          <MaterialIcon name="bolt" size={18} className="text-amber-500" />
        </div>
        <h3 className="font-heading text-base font-bold text-foreground">
          Intelligent Insights
        </h3>
      </div>
      <p className="mb-4 font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
        Automated Health Checks
      </p>
      <div className="space-y-4">
        {insights.map((ins) => (
          <div key={ins.title} className="flex items-start gap-3">
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg",
                ins.bg
              )}
            >
              <MaterialIcon name={ins.icon} size={18} className={ins.color} />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {ins.title}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                {ins.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main: RepoOverview ─── */
export function RepoOverview({ owner, repo }: { owner: string; repo: string }) {
  const dispatch = useAppDispatch();
  const { addToHistory } = useRecentHistory();
  const [isBookmarked, setIsBookmarked] = useState(false);

  // Check bookmark status from API on mount
  useEffect(() => {
    fetch("/api/user/bookmarks", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { bookmarks: [] })
      .then((data) => {
        const list = Array.isArray(data.bookmarks) ? data.bookmarks : [];
        setIsBookmarked(list.some((b: { owner: string; repo: string }) => b.owner === owner && b.repo === repo));
      })
      .catch(() => { /* ignore */ });
  }, [owner, repo]);

  const toggleBookmark = async () => {
    if (isBookmarked) {
      const ok = await removeBookmark(owner, repo);
      if (ok) setIsBookmarked(false);
    } else {
      const data = repoQ.data;
      const ok = await addBookmark({
        owner,
        repo,
        avatar: data?.owner?.avatar_url ?? `https://github.com/${owner}.png`,
        stars: data?.stargazers_count ?? 0,
        description: data?.description ?? "",
      });
      if (ok) setIsBookmarked(true);
    }
  };

  const repoQ = useQuery({
    queryKey: ["repo", owner, repo],
    queryFn: () => getRepoDetails(owner, repo),
  });

  const contributorsQ = useQuery({
    queryKey: ["contributors", owner, repo],
    queryFn: () => getContributors(owner, repo),
    enabled: !!repoQ.data,
  });

  const languagesQ = useQuery({
    queryKey: ["languages", owner, repo],
    queryFn: () => getLanguages(owner, repo),
    enabled: !!repoQ.data,
  });

  const activityQ = useQuery({
    queryKey: ["commit-activity", owner, repo],
    queryFn: () => getCommitActivity(owner, repo),
    enabled: !!repoQ.data,
  });

  useEffect(() => {
    if (repoQ.isSuccess) {
      // Sync to Redux (search sidebar history)
      dispatch(addRecentSearch({ owner, repo }));
      // Sync to DB (TopNav search history + Overview page history)
      addToHistory({
        id: `${owner}/${repo}`,
        name: repo,
        type: "repo",
        avatar: repoQ.data?.owner?.avatar_url,
      });
    }
    // addToHistory is stable via useCallback; intentionally excluded to avoid re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, owner, repo, repoQ.isSuccess]);

  const loading = repoQ.isLoading;
  const err = repoQ.error as Error | undefined;

  if (err) {
    return (
      <div className="border-destructive/40 bg-destructive/5 rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Could not load repository</h2>
        <p className="text-muted-foreground mt-2 text-sm">{err.message}</p>
        <p className="text-muted-foreground mt-3 text-sm">
          Tip: add a{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">
            GITHUB_TOKEN
          </code>{" "}
          in{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">
            .env.local
          </code>{" "}
          for higher rate limits (5k/hr).
        </p>
      </div>
    );
  }

  const data = repoQ.data;
  const contributors = contributorsQ.data?.data ?? [];
  const languages = languagesQ.data?.data ?? {};
  const weeks = activityQ.data?.data ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-6"
    >
      {/* ── Header ── */}
      <div className="flex flex-col items-end justify-between gap-6 md:flex-row">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 font-mono text-sm text-muted-foreground">
            <span>{owner}</span>
            <span>/</span>
            <span className="text-primary font-bold">{repo}</span>
            <span className="bg-tertiary/10 text-tertiary rounded px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
              Public
            </span>
          </div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Repository Overview
          </h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleBookmark}
            className={cn(isBookmarked && "border-indigo-500/50 text-indigo-500 bg-indigo-500/5"
            )}
            title={isBookmarked ? "Remove bookmark" : "Bookmark this repo"}
          >
            <Bookmark className={cn("mr-1 size-4", isBookmarked && "fill-current")} />
            {isBookmarked ? "Bookmarked" : "Bookmark"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <MaterialIcon name="download" className="text-base! mr-1" />
            Export
          </Button>
          {data?.html_url && (
            <a
              href={data.html_url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ size: "sm" }),
                "btn-gitscope-primary inline-flex items-center rounded-md font-bold"
              )}
            >
              <Star className="mr-2 size-4 fill-current" />
              Watch Repository
            </a>
          )}
        </div>
      </div>

      {/* ── Metric Cards ── */}
      <MetricCards
        loading={loading}
        stars={data?.stargazers_count ?? 0}
        forks={data?.forks_count ?? 0}
        issues={data?.open_issues_count ?? 0}
        contributors={contributors.length}
      />

      {/* ── Commit Velocity + Insights ── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px] xl:grid-cols-[1fr_320px]">
        <CommitVelocityChart owner={owner} repo={repo} loading={activityQ.isLoading} />
        <IntelligentInsights
          stars={data?.stargazers_count ?? 0}
          forks={data?.forks_count ?? 0}
          issues={data?.open_issues_count ?? 0}
          contributors={contributors.length}
          weeks={weeks}
        />
      </div>

      {/* ── Top Contributors + Language Dist ── */}
      <div className="grid gap-6 md:grid-cols-2">
        <TopContributorsChart contributors={contributors} loading={contributorsQ.isLoading} />
        <LanguageBars languages={languages} loading={languagesQ.isLoading} />
      </div>

      <p className="text-muted-foreground text-center text-xs">
        Analytics are derived from public GitHub APIs. Rate limits apply without
        a token.
      </p>
    </motion.div>
  );
}
