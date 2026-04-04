"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/utils/formatDate";
import { MaterialIcon } from "@/components/material-icon";
import { motion } from "framer-motion";

const gradients = [
  "from-amber-500/20 via-orange-500/10 to-transparent",
  "from-blue-500/20 via-cyan-500/10 to-transparent",
  "from-red-500/20 via-rose-500/10 to-transparent",
  "from-emerald-500/20 via-teal-500/10 to-transparent",
];

const iconColors = [
  "text-amber-500",
  "text-blue-500",
  "text-red-500",
  "text-emerald-500",
];

const glowColors = [
  "shadow-amber-500/10",
  "shadow-blue-500/10",
  "shadow-red-500/10",
  "shadow-emerald-500/10",
];

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
        {items.map((i, idx) => (
          <div
            key={i.label}
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 shadow-md backdrop-blur-xl dark:bg-slate-900/30 dark:shadow-none"
          >
            <div className="absolute inset-0 bg-linear-to-br from-slate-500/5 to-transparent" />
            <Skeleton className="relative mb-2 h-3 w-20" />
            <Skeleton className="relative h-9 w-24" />
            <Skeleton className="relative mt-2 h-3 w-32" />
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
          whileHover={{
            y: -4,
            transition: { duration: 0.2 },
          }}
          className={cn(
            "group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 shadow-md backdrop-blur-xl transition-all duration-300",
            "hover:border-white/20 hover:shadow-lg hover:shadow-indigo-500/10 dark:bg-slate-900/30 dark:shadow-none",
            glowColors[idx]
          )}
        >
          <div
            className={cn(
              "absolute inset-0 bg-linear-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-100",
              gradients[idx]
            )}
          />
          <div className="absolute top-0 right-0 p-4 opacity-5 transition-all duration-300 group-hover:opacity-10 group-hover:scale-110">
            <MaterialIcon name={item.mat} className="text-6xl! text-white" />
          </div>
          <div
            className={cn(
              "mb-3 inline-flex rounded-xl p-2.5 transition-colors duration-300",
              "bg-white/10 group-hover:bg-white/20",
              iconColors[idx]
            )}
          >
            <MaterialIcon name={item.mat} className="text-xl!" />
          </div>
          <p className="relative mb-1 font-mono text-xs tracking-widest uppercase text-slate-500">
            {item.label}
          </p>
          <h3 className="relative font-heading text-3xl font-bold tracking-tight tabular-nums text-foreground">
            {formatNumber(item.value)}
          </h3>
          <p
            className={cn(
              "relative mt-2 flex items-center gap-1 text-xs font-medium transition-colors",
              item.hintClass
            )}
          >
            <MaterialIcon name={item.hintIcon} className="text-sm!" />
            <span>{item.hint}</span>
          </p>
        </motion.div>
      ))}
    </div>
  );
}
