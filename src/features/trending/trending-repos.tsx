"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialIcon } from "@/components/material-icon";
import { ROUTES } from "@/constants/routes";
import { getTrendingRepos } from "@/services/githubClient";
import { formatNumber } from "@/utils/formatDate";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

type TimeRange = "today" | "week" | "month";

const LANG_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Rust: "#dea584",
  Go: "#00add8",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#701516",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
};

function getLangColor(lang: string | null) {
  return lang ? LANG_COLORS[lang] ?? "#94a3b8" : "#94a3b8";
}

export function TrendingReposPanel() {
  const [timeRange, setTimeRange] = useState<TimeRange>("today");

  const q = useQuery({
    queryKey: ["trending"],
    queryFn: () => getTrendingRepos(),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (q.isError) {
    return (
      <p className="text-destructive text-sm">{(q.error as Error).message}</p>
    );
  }

  const items = q.data?.items ?? [];
  const featured = items[0];
  const feedItems = items.slice(1, 5);
  const fastestGrowing = items.slice(5, 8);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full"
    >
      {/* header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Project Discovery
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Surface high-velocity repositories across the global ecosystem.
            <br className="hidden sm:block" />
            Filtered by precision momentum metrics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-0.5">
            {(["today", "week", "month"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTimeRange(t)}
                className={cn(
                  "rounded-md px-4 py-1.5 font-mono text-[10px] font-bold tracking-widest uppercase transition-all",
                  timeRange === t
                    ? "btn-gitscope-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          {/* ── Featured repo ── */}
          {featured && (
            <div className="overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-surface-container-high">
                    <MaterialIcon
                      name="deployed_code"
                      size={28}
                      className="text-primary"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-destructive/20 text-destructive border-0 font-mono text-[9px] uppercase">
                        Hot #1
                      </Badge>
                      <span className="font-heading text-xl font-bold text-foreground">
                        {featured.full_name}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 max-w-md text-sm">
                      {featured.description}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-heading text-3xl font-bold text-foreground">
                    +{formatNumber(featured.stargazers_count)}
                  </p>
                  <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                    Stars Today
                  </p>
                </div>
              </div>

              {/* mini bar chart */}
              <div className="mt-6 flex items-end gap-1.5">
                {Array.from({ length: 14 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-primary/20"
                    style={{
                      height: `${20 + Math.random() * 60}px`,
                    }}
                  />
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-3 rounded-full"
                      style={{
                        backgroundColor: getLangColor(featured.language),
                      }}
                    />
                    {featured.language ?? "Unknown"}
                  </span>
                  <span className="flex items-center gap-1">
                    <MaterialIcon name="star" size={14} />
                    {formatNumber(featured.stargazers_count)}
                  </span>
                  <span className="flex items-center gap-1">
                    <MaterialIcon name="fork_right" size={14} />
                    {formatNumber(featured.forks_count)}
                  </span>
                </div>
                <Link
                  href={ROUTES.dashboard(
                    featured.full_name.split("/")[0],
                    featured.full_name.split("/")[1]
                  )}
                >
                  <Button className="btn-gitscope-primary gap-2 rounded-full font-mono text-[10px] font-bold tracking-widest uppercase">
                    Explore Repo
                    <MaterialIcon name="arrow_forward" size={16} />
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* ── High Momentum Feed ── */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-heading flex items-center gap-2 text-lg font-bold text-foreground">
                <MaterialIcon
                  name="bolt"
                  size={20}
                  className="text-tertiary"
                />
                High Momentum Feed
              </h2>
              <span className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                Real-time updates
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {feedItems.map((r, idx) => {
                const [owner, name] = r.full_name.split("/");
                return (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <Link href={ROUTES.dashboard(owner, name)}>
                      <div className="group rounded-xl border border-outline-variant/15 bg-surface-container p-5 transition-all hover:border-primary/30">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                            {r.language ?? "—"}
                          </span>
                          <span
                            className="size-3 rounded-full"
                            style={{
                              backgroundColor: getLangColor(r.language),
                            }}
                          />
                        </div>
                        <h3 className="font-heading text-base font-bold text-foreground group-hover:text-primary transition-colors">
                          {r.full_name}
                        </h3>
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                          {r.description}
                        </p>
                        <div className="mt-3 flex items-center gap-3 text-xs">
                          <span className="flex items-center gap-1 text-tertiary">
                            <MaterialIcon name="trending_up" size={14} />
                            {formatNumber(r.stargazers_count)} stars
                          </span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <MaterialIcon name="visibility" size={14} />
                            {formatNumber(r.watchers_count)}
                          </span>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <aside className="space-y-6">
          {/* Fastest Growing */}
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-base font-bold text-foreground">
                Fastest Growing
              </h3>
              <MaterialIcon
                name="trending_up"
                size={20}
                className="text-muted-foreground"
              />
            </div>
            <div className="space-y-4">
              {fastestGrowing.map((r, idx) => (
                <Link
                  key={r.id}
                  href={ROUTES.dashboard(
                    r.full_name.split("/")[0],
                    r.full_name.split("/")[1]
                  )}
                  className="block"
                >
                  <div className="group">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-md bg-surface-container-high font-mono text-xs font-bold text-muted-foreground">
                          #{idx + 1}
                        </span>
                        <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                          {r.full_name.split("/")[1]}
                        </span>
                      </div>
                      <span className="font-mono text-xs font-bold text-tertiary">
                        +{formatNumber(r.stargazers_count)}
                      </span>
                    </div>
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-container-highest">
                      <div
                        className="h-full rounded-full bg-tertiary"
                        style={{
                          width: `${Math.min(100, (r.stargazers_count / (fastestGrowing[0]?.stargazers_count || 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                      {formatNumber(r.stargazers_count)} Stars ·{" "}
                      {formatNumber(r.forks_count)} forks
                    </p>
                  </div>
                </Link>
              ))}
            </div>
            <a
              href="/trending"
              className="mt-4 block w-full text-center font-mono text-[9px] font-bold tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
            >
              View all trending →
            </a>
          </div>

          {/* Sector Trends — from real language data */}
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-5">
            <div className="mb-4 flex items-center gap-2">
              <MaterialIcon
                name="public"
                size={18}
                className="text-muted-foreground"
              />
              <h3 className="font-heading text-base font-bold text-foreground">
                Sector Trends
              </h3>
            </div>
            <div className="space-y-3">
              {(() => {
                // Aggregate languages from all trending items
                const langCounts: Record<string, number> = {};
                items.forEach((r) => {
                  if (r.language) {
                    langCounts[r.language] =
                      (langCounts[r.language] || 0) + 1;
                  }
                });
                const sorted = Object.entries(langCounts)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 4);
                const total = items.length || 1;
                return sorted.map(([lang, count]) => (
                  <div
                    key={lang}
                    className="flex items-center justify-between"
                  >
                    <span className="text-sm text-foreground">{lang}</span>
                    <span className="font-mono text-xs font-bold text-tertiary">
                      {((count / total) * 100).toFixed(1)}%
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Active Seekers — from contributor data of trending repos */}
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-5">
            <h4 className="mb-3 font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
              Top Repo Owners
            </h4>
            <div className="space-y-3">
              {(() => {
                const owners = items
                  .slice(0, 5)
                  .map((r) => ({
                    login: r.owner.login,
                    avatar: r.owner.avatar_url,
                    stars: r.stargazers_count,
                  }));
                // Deduplicate by login
                const seen = new Set<string>();
                const unique = owners.filter((o) => {
                  if (seen.has(o.login)) return false;
                  seen.add(o.login);
                  return true;
                });
                return unique.slice(0, 3).map((o) => (
                  <div
                    key={o.login}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Image
                        src={o.avatar}
                        width={28}
                        height={28}
                        alt={o.login}
                        className="size-7 rounded-full"
                      />
                      <span className="text-sm text-foreground">
                        @{o.login}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatNumber(o.stars)} ★
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </aside>
      </div>
    </motion.div>
  );
}
