"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/utils/formatDate";
import { MaterialIcon } from "@/components/material-icon";
import { motion } from "framer-motion";

export function MetricCards({
  stars,
  forks,
  issues,
  contributors,
  loading,
}: {
  stars: number;
  forks: number;
  issues: number;
  contributors: number;
  loading?: boolean;
}) {
  const items = [
    {
      label: "Stars",
      value: stars,
      mat: "star" as const,
      border: "border-primary/40",
      hint: "Stargazers",
      hintIcon: "trending_up" as const,
      hintClass: "text-tertiary",
    },
    {
      label: "Forks",
      value: forks,
      mat: "fork_right" as const,
      border: "border-slate-600",
      hint: "Network forks",
      hintIcon: "sync" as const,
      hintClass: "text-slate-500",
    },
    {
      label: "Open issues",
      value: issues,
      mat: "emergency_home" as const,
      border: "border-destructive/40",
      hint: "GitHub API count",
      hintIcon: "warning" as const,
      hintClass: "text-destructive",
    },
    {
      label: "Contributors",
      value: contributors,
      mat: "groups" as const,
      border: "border-tertiary/40",
      hint: "Loaded sample",
      hintIcon: "verified" as const,
      hintClass: "text-tertiary",
    },
  ];

  if (loading) {
    return (
      <div className="mb-10 grid grid-cols-1 gap-5 md:grid-cols-4">
        {items.map((i) => (
          <div
            key={i.label}
            className="bg-surface-container border-outline-variant/10 relative overflow-hidden rounded-xl border-l-2 p-6"
          >
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mb-10 grid grid-cols-1 gap-5 md:grid-cols-4">
      {items.map((item, idx) => (
        <motion.div
          key={item.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.05 }}
          className={cn(
            "bg-surface-container relative overflow-hidden rounded-xl border-l-2 p-6",
            item.border
          )}
        >
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <MaterialIcon name={item.mat} className="!text-5xl text-on-surface" />
          </div>
          <p className="text-slate-500 mb-1 font-mono text-xs tracking-widest uppercase">
            {item.label}
          </p>
          <h3 className="font-heading text-on-surface text-3xl font-bold tracking-tight font-mono tabular-nums">
            {formatNumber(item.value)}
          </h3>
          <p
            className={`mt-2 flex items-center gap-1 text-xs font-medium ${item.hintClass}`}
          >
            <MaterialIcon name={item.hintIcon} className="!text-sm" />
            <span>{item.hint}</span>
          </p>
        </motion.div>
      ))}
    </div>
  );
}
