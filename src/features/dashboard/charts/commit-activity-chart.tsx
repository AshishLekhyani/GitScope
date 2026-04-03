"use client";

import { useState, useEffect } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CommitActivityWeek } from "@/types/github";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts/es6";

function weekLabel(weekTs: number) {
  const d = new Date(weekTs * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CommitActivityChart({
  weeks,
  loading,
}: {
  weeks: CommitActivityWeek[];
  loading?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const data = weeks.map((w) => ({
    name: weekLabel(w.week),
    commits: w.total,
  }));

  if (loading || !mounted) {
    return (
      <Card className="bg-surface-container min-h-[320px] ring-1 ring-white/[0.06]">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="h-[240px]">
          <Skeleton className="h-full w-full rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (!data.length) {
    return (
      <Card className="bg-surface-container min-h-[320px] ring-1 ring-white/[0.06]">
        <CardHeader>
          <CardTitle className="font-heading text-on-surface">
            Commit activity
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm h-[240px]">
          No weekly stats yet. GitHub may still be computing repository
          statistics — try again in a minute, or add a token for higher
          limits.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-container min-h-[320px] ring-1 ring-white/[0.06]">
      <CardHeader>
        <CardTitle className="font-heading text-on-surface">
          Commits per week (last year)
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[280px] pt-2">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" stroke="var(--border)" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              stroke="var(--muted-foreground)"
              interval="preserveStartEnd"
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                background: "var(--surface-container-high)",
                border: "1px solid var(--border)",
                fontSize: 12,
                color: "var(--foreground)",
              }}
              itemStyle={{ color: "var(--foreground)" }}
              labelStyle={{ fontWeight: 600, color: "var(--foreground)" }}
            />
            <Bar
              dataKey="commits"
              fill="var(--chart-2)"
              radius={[4, 4, 0, 0]}
              name="Commits"
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
