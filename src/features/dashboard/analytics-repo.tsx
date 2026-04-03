"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPullRequests, type GitHubPull } from "@/services/githubClient";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  Pie,
  PieChart,
} from "recharts/es6";
import { MaterialIcon } from "@/components/material-icon";

function processPRData(prs: GitHubPull[]) {
  // 1. Status Mix
  let open = 0;
  let merged = 0;
  let closed = 0;
  
  // 2. Merge Time Distribution (in hours)
  const timeBuckets = { "< 1h": 0, "1-24h": 0, "1-7d": 0, "> 7d": 0 };
  let totalMergeTimeHours = 0;
  
  // 3. Authors
  const authors = new Set<string>();

  for (const p of prs) {
    if (p.user?.login) authors.add(p.user.login);

    if (p.merged_at) {
      merged++;
      const created = new Date(p.created_at).getTime();
      const merged_at = new Date(p.merged_at).getTime();
      const hours = (merged_at - created) / (1000 * 60 * 60);
      totalMergeTimeHours += hours;

      if (hours < 1) timeBuckets["< 1h"]++;
      else if (hours <= 24) timeBuckets["1-24h"]++;
      else if (hours <= 24 * 7) timeBuckets["1-7d"]++;
      else timeBuckets["> 7d"]++;
    } else if (p.state === "open") {
      open++;
    } else {
      closed++;
    }
  }

  const avgMergeHours = merged > 0 ? (totalMergeTimeHours / merged).toFixed(1) : "0.0";
  const mergeRate = prs.length > 0 ? ((merged / prs.length) * 100).toFixed(1) : "0.0";

  return {
    statusChart: [
      { name: "Open", value: open, color: "#6366f1" },
      { name: "Merged", value: merged, color: "#10b981" },
      { name: "Closed (unmerged)", value: closed, color: "#f43f5e" },
    ],
    timeBuckets: Object.entries(timeBuckets).map(([name, count]) => ({
      name,
      count,
    })),
    metrics: {
      avgMergeHours,
      mergeRate,
      activeAuthors: authors.size,
      totalAnalyzed: prs.length,
    },
  };
}

export function AnalyticsRepoPanel({ owner, repo }: { owner: string; repo: string }) {
  const q = useQuery({
    queryKey: ["pulls", owner, repo],
    queryFn: () => getPullRequests(owner, repo),
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const prs = q.data?.data ?? [];
  const processed = processPRData(prs);

  if (q.isLoading || !mounted) {
    return (
      <div className="grid gap-6 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
        <div className="col-span-1 h-[340px] rounded-xl md:col-span-2 overflow-hidden border border-outline-variant/10">
           <Skeleton className="h-full w-full" />
        </div>
        <div className="h-[340px] w-full rounded-xl overflow-hidden border border-outline-variant/10">
           <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  if (!prs.length) {
    return (
      <Card className="flex min-h-[280px] flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <MaterialIcon name="info" size={32} className="mb-4 opacity-50" />
        <p>No recent pull requests found for {owner}/{repo}.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MaterialIcon name="speed" size={16} />
              Avg Merge Time
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-foreground">
                {processed.metrics.avgMergeHours}
              </span>
              <span className="text-sm text-muted-foreground">hours</span>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MaterialIcon name="merge_type" size={16} />
              Merge Rate
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-foreground">
                {processed.metrics.mergeRate}%
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              based on last {processed.metrics.totalAnalyzed} PRs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MaterialIcon name="people" size={16} />
              Active Authors
            </div>
            <div className="mt-2 text-3xl font-bold tracking-tight text-foreground">
              {processed.metrics.activeAuthors}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MaterialIcon name="rule" size={16} />
              Total Analyzed
            </div>
            <div className="mt-2 text-3xl font-bold tracking-tight text-foreground">
              {processed.metrics.totalAnalyzed}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Recent activity sample
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Merge Time Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={processed.timeBuckets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/30" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "var(--surface-container-highest)" }}
                  contentStyle={{ 
                    backgroundColor: "var(--surface-container-high)", 
                    border: "1px solid var(--border)", 
                    borderRadius: "8px",
                    color: "var(--foreground)" 
                  }}
                  itemStyle={{ color: "var(--foreground)" }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="count" name="Merged PRs" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">PR Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <PieChart>
                <Pie
                  data={processed.statusChart}
                  cx="50%"
                  cy="45%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {processed.statusChart.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  cursor={{ fill: "var(--surface-container-highest)" }}
                  contentStyle={{ 
                    backgroundColor: "var(--surface-container-high)", 
                    border: "1px solid var(--border)", 
                    borderRadius: "8px",
                    color: "var(--foreground)"
                  }}
                  itemStyle={{ color: "var(--foreground)" }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: "11px" }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
