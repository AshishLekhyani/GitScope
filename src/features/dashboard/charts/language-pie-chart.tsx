"use client";

import { useState, useEffect } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts/es6";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function LanguagePieChart({
  languages,
  loading,
}: {
  languages: Record<string, number>;
  loading?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const total = Object.values(languages).reduce((a, b) => a + b, 0);
  const data = Object.entries(languages).map(([name, value]) => ({
    name,
    value,
    pct: total ? Math.round((value / total) * 1000) / 10 : 0,
  }));

  if (loading || !mounted) {
    return (
      <Card className="bg-surface-container min-h-[320px] ring-1 ring-white/[0.06]">
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="h-[240px] flex items-center justify-center">
          <Skeleton className="h-[220px] w-[220px] rounded-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data.length) {
    return (
      <Card className="bg-surface-container min-h-[320px] ring-1 ring-white/[0.06]">
        <CardHeader>
          <CardTitle className="font-heading text-on-surface">Languages</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm h-[240px]">
          No language data returned for this repository.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-container min-h-[320px] ring-1 ring-white/[0.06]">
      <CardHeader>
        <CardTitle className="font-heading text-on-surface">
          Language distribution
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={56}
              outerRadius={88}
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, _name, item) => {
                const p = item?.payload as { pct?: number };
                const n = typeof value === "number" ? value : Number(value);
                return [`${p?.pct ?? 0}% (${n})`, "Share"];
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
