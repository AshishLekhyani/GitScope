"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts/es6";
import { format } from "date-fns";
import Image from "next/image";
import { GitCommit, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Commit = {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  author: {
    avatar_url: string;
    login: string;
  } | null;
  html_url: string;
};

export function CommitsPage({ owner, repo }: { owner: string; repo: string }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "6m" | "1y">("30d");
  const [page, setPage] = useState(0);
  const [mounted, setMounted] = useState(false);
  const PER_PAGE = 20;

  useEffect(() => {
    setMounted(true);
  }, []);

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
        setCommits(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchCommits();
  }, [owner, repo, range]);

  // Analytics Calculations
  const totalCommits = commits.length;
  const uniqueAuthors = new Set(commits.map(c => c.author?.login || c.commit.author.name)).size;
  
  // Weekly distribution for momentum chart
  const chartData = [...commits].reverse().map((c, i) => ({
    name: i + 1,
    date: format(new Date(c.commit.author.date), "MMM d"),
    msg: c.commit.message.split("\n")[0],
  }));

  // Compute Top Committers
  const committerCounts = commits.reduce((acc, c) => {
    const name = c.author?.login || c.commit.author.name;
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const committerData = Object.entries(committerCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (loading || !mounted) {
    return (
      <div className="space-y-6">
        <div className="h-[200px] w-full rounded-xl border border-outline-variant/10 overflow-hidden">
           <Skeleton className="h-full w-full" />
        </div>
        <div className="h-24 w-full rounded-xl border border-outline-variant/10 overflow-hidden">
           <Skeleton className="h-full w-full" />
        </div>
        <div className="h-96 w-full rounded-xl border border-outline-variant/10 overflow-hidden">
           <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-xl font-bold text-foreground">
          Commit Analytics
        </h2>
        <div className="flex items-center gap-1 rounded-lg bg-surface-container p-1 ring-1 ring-white/10">
          {(["7d", "30d", "90d", "6m", "1y"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { setRange(r); setPage(0); }}
              className={cn(
                "rounded-md px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all",
                range === r
                  ? "bg-primary text-white shadow-lg"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Total Volume", value: totalCommits, icon: GitCommit, color: "text-primary" },
          { label: "Active Authors", value: uniqueAuthors, icon: User, color: "text-emerald-400" },
          { label: "Range Duration", value: range.toUpperCase(), icon: GitCommit, color: "text-tertiary" },
        ].map((s) => (
          <Card key={s.label} className="bg-surface-container border-none ring-1 ring-white/[0.06]">
            <CardContent className="flex items-center gap-4 p-4">
              <div className={cn("flex size-10 items-center justify-center rounded-xl bg-white/5", s.color)}>
                <s.icon className="size-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {s.label}
                </p>
                <p className="font-heading text-xl font-bold text-foreground">
                  {s.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Commit Activity Momentum Area Chart */}
        <Card className="bg-surface-container border-none ring-1 ring-white/[0.06]">
          <CardHeader className="pb-2">
            <CardTitle className="font-heading flex items-center gap-2 text-lg">
              <GitCommit className="size-5 text-primary" />
              Momentum
            </CardTitle>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Commit depth for selected range
            </p>
          </CardHeader>
          <CardContent className="h-[200px] pt-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="commitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fontSize: 10 }} 
                  stroke="var(--muted-foreground)"
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    background: "var(--surface-container-high)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                    color: "var(--foreground)",
                  }}
                  itemStyle={{ color: "var(--foreground)" }}
                />
                <Area
                  type="monotone"
                  dataKey="name"
                  stroke="var(--primary)"
                  fill="url(#commitGrad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Committers Bar Chart */}
        <Card className="bg-surface-container border-none ring-1 ring-white/[0.06]">
          <CardHeader className="pb-2">
            <CardTitle className="font-heading flex items-center gap-2 text-lg">
              <User className="size-5 text-emerald-400" />
              Contributors
            </CardTitle>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Volume distribution by author
            </p>
          </CardHeader>
          <CardContent className="h-[200px] pt-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={committerData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  width={80} 
                  tick={{ fontSize: 9 }} 
                  stroke="var(--muted-foreground)" 
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    background: "var(--surface-container-high)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                    color: "var(--foreground)",
                  }}
                  itemStyle={{ color: "var(--foreground)" }}
                />
                <Area
                  type="step"
                  dataKey="count"
                  stroke="var(--tertiary)"
                  fill="var(--tertiary)"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Commit List with Pagination */}
      <Card className="bg-surface-container border-none ring-1 ring-white/6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-heading text-lg">
            Commit History
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({commits.length} total)
            </span>
          </CardTitle>
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
            Page {page + 1} / {Math.max(1, Math.ceil(commits.length / PER_PAGE))}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-white/4">
            {commits.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map((c) => (
              <div
                key={c.sha}
                className="group flex flex-col gap-2 p-4 transition-colors hover:bg-white/2 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex shrink-0 items-center gap-3">
                  {c.author?.avatar_url ? (
                    <Image
                      src={c.author.avatar_url}
                      width={32}
                      height={32}
                      alt={c.author.login}
                      className="size-8 rounded-full ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="flex size-8 items-center justify-center rounded-full bg-surface-container-high text-muted-foreground ring-1 ring-white/10">
                      <User className="size-4" />
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold tracking-tight text-foreground">
                      {c.author?.login || c.commit.author.name}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {format(new Date(c.commit.author.date), "MMM d, yyyy")}
                    </span>
                  </div>
                </div>

                <div className="flex-1 overflow-hidden">
                  <p className="line-clamp-1 text-sm font-medium text-foreground/90 leading-snug">
                    {c.commit.message.split("\n")[0]}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {c.sha.substring(0, 7)}
                  </p>
                </div>

                <a
                  href={c.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View commit ${c.sha.substring(0, 7)} on GitHub`}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-white/8 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                >
                  <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            ))}
          </div>

          {/* Pagination controls */}
          {commits.length > PER_PAGE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/4">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-4 py-1.5 rounded-lg border border-white/8 text-xs font-bold disabled:opacity-30 hover:bg-white/5 transition-colors"
              >
                ← Previous
              </button>
              <span className="font-mono text-[10px] text-muted-foreground">
                Showing {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, commits.length)} of {commits.length}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(Math.ceil(commits.length / PER_PAGE) - 1, p + 1))}
                disabled={(page + 1) * PER_PAGE >= commits.length}
                className="px-4 py-1.5 rounded-lg border border-white/8 text-xs font-bold disabled:opacity-30 hover:bg-white/5 transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
