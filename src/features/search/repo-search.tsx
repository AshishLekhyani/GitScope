"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialIcon } from "@/components/material-icon";
import { ROUTES } from "@/constants/routes";
import {
  getTrendingRepos,
  searchRepositories,
} from "@/services/githubClient";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearRecentSearches,
  removeRecentSearch,
} from "@/store/slices/dashboardSlice";
import type { GitHubRepo } from "@/types/github";
import { formatNumber } from "@/utils/formatDate";
import { fuzzySort } from "@/utils/fuzzySearch";
import { useDebounce } from "@/hooks/useDebounce";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

function RepoNameHighlight({ fullName }: { fullName: string }) {
  const i = fullName.indexOf("/");
  if (i < 0) return <span className="font-mono text-sm">{fullName}</span>;
  const owner = fullName.slice(0, i);
  const repo = fullName.slice(i + 1);
  return (
    <span className="font-mono text-sm text-foreground">
      {owner}/
      <span className="text-primary font-bold">{repo}</span>
    </span>
  );
}

const FEATURED_SUGGESTIONS = [
  { fullName: "facebook/react", owner: "facebook", repo: "react" },
  { fullName: "vercel/next.js", owner: "vercel", repo: "next.js" },
  { fullName: "tailwindlabs/tailwindcss", owner: "tailwindlabs", repo: "tailwindcss" },
  { fullName: "microsoft/vscode", owner: "microsoft", repo: "vscode" },
];

export function RepoSearchPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [q, setQ] = useState(initial);
  const debounced = useDebounce(q, 350);
  const recent = useAppSelector((s) => s.dashboard.recentSearches);
  const dispatch = useAppDispatch();

  useEffect(() => {
    setQ(initial);
  }, [initial]);

  const searchQ = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => searchRepositories(debounced),
    enabled: debounced.trim().length > 1,
  });

  const trendingQ = useQuery({
    queryKey: ["trending", "search-sidebar"],
    queryFn: () => getTrendingRepos(),
  });

  const items = useMemo(() => {
    const raw = searchQ.data?.items ?? [];
    const searchStr = debounced.startsWith("@") ? debounced.slice(1) : debounced;
    return fuzzySort(raw, searchStr, (r) => r.full_name);
  }, [searchQ.data?.items, debounced]);

  const trendingItems = useMemo(
    () => (trendingQ.data?.items ?? []).slice(0, 4),
    [trendingQ.data?.items]
  );

  const openRepo = useCallback(
    (r: GitHubRepo) => {
      const [owner, name] = r.full_name.split("/");
      router.push(ROUTES.dashboard(owner, name));
    },
    [router]
  );

  const execute = useCallback(() => {
    const trimmed = q.trim();
    router.replace(
      trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search"
    );
    if (trimmed.includes("/")) {
      const [o, rname] = trimmed.split("/").filter(Boolean);
      if (o && rname) {
        router.push(ROUTES.dashboard(o, rname));
      }
    }
  }, [q, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setQ("");
        router.replace("/search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const showResults = debounced.trim().length > 1;

  return (
    <div className="relative w-full overflow-hidden">
      <div className="pointer-events-none absolute top-1/4 left-1/2 -z-10 h-[min(800px,90vw)] w-[min(800px,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-[120px]" />

      <div className="spotlight-glow glass-panel relative overflow-hidden rounded-2xl border border-outline-variant/20 shadow-2xl">
        <div className="border-border relative flex flex-wrap items-center gap-2 border-b border-white/5 py-2 pr-3 pl-2 sm:flex-nowrap sm:py-0 sm:pr-6 sm:pl-4">
          <div className="text-primary shrink-0 pl-2 sm:pl-4">
            <MaterialIcon name="search" size={28} />
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") execute();
            }}
            placeholder="Search repos (use @username for users)..."
            className="text-foreground placeholder:text-muted-foreground/60 min-w-0 flex-1 border-0 bg-transparent py-3 font-mono text-sm focus:ring-0 focus-visible:outline-none sm:py-8 sm:text-xl"
            autoFocus
            aria-label="Search repositories"
          />
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4">
            <kbd className="border-border text-muted-foreground hidden rounded border bg-slate-100/80 px-2 py-1 font-mono text-[10px] sm:inline-block dark:bg-slate-800/80">
              ESC
            </kbd>
            <Button
              type="button"
              size="sm"
              className="btn-gitscope-primary font-mono text-[10px] font-black uppercase tracking-widest"
              onClick={execute}
            >
              Execute
            </Button>
          </div>
        </div>

        <div className="flex max-h-[min(600px,70vh)] flex-col overflow-hidden md:flex-row">
          <div className="custom-scrollbar flex-1 overflow-y-auto border-b border-outline-variant/10 md:max-h-[600px] md:border-r md:border-b-0">
            {showResults ? (
              <div className="p-4 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-muted-foreground font-mono text-[10px] font-bold tracking-[0.3em] uppercase">
                    Results
                  </h3>
                  {searchQ.data?.total_count != null && (
                    <span className="text-muted-foreground font-mono text-xs">
                      {formatNumber(searchQ.data.total_count)} repos
                    </span>
                  )}
                </div>

                {searchQ.isLoading && (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full rounded-lg" />
                    ))}
                  </div>
                )}

                {searchQ.isError && (
                  <p className="text-destructive text-sm">
                    {(searchQ.error as Error).message}
                  </p>
                )}

                {!searchQ.isLoading &&
                  !searchQ.isError &&
                  items.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                      No repositories match your query.
                    </p>
                  )}

                <div className="space-y-1">
                  {items.map((r, idx) => (
                    <motion.button
                      key={r.id}
                      type="button"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.02 }}
                      onClick={() => openRepo(r)}
                      className="border-border hover:bg-muted/60 group flex w-full items-center justify-between rounded-lg border border-transparent p-3 text-left transition-all hover:border-outline-variant/20"
                    >
                      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                        <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded border border-outline-variant/20">
                          <MaterialIcon
                            name="deployed_code"
                            size={18}
                            className="text-tertiary"
                          />
                        </div>
                        <div className="min-w-0 flex-1 flex flex-col gap-0.5 overflow-hidden">
                          <RepoNameHighlight fullName={r.full_name} />
                          {r.description && (
                            <span className="text-muted-foreground line-clamp-1 max-w-full break-words text-[10px]">
                              {r.description}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-muted-foreground group-hover:text-tertiary flex shrink-0 items-center gap-3 font-mono text-[11px] transition-colors">
                        <span className="inline-flex items-center gap-0.5">
                          <MaterialIcon name="star" size={14} />
                          {formatNumber(r.stargazers_count)}
                        </span>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 sm:p-6">
                  <h3 className="text-muted-foreground mb-4 font-mono text-[10px] font-bold tracking-[0.3em] uppercase">
                    Trending globally
                  </h3>
                  {trendingQ.isLoading && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 rounded-lg" />
                      ))}
                    </div>
                  )}
                  {trendingQ.isError && (
                    <p className="text-destructive text-sm">
                      {(trendingQ.error as Error).message}
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {trendingItems.map((r) => {
                      const [owner, name] = r.full_name.split("/");
                      const dotClass =
                        r.language === "JavaScript"
                          ? "bg-[#f1e05a]"
                          : r.language === "TypeScript"
                            ? "bg-[#3178c6]"
                            : r.language === "Rust"
                              ? "bg-[#dea584]"
                              : r.language === "Go"
                                ? "bg-[#00add8]"
                                : r.language === "Python"
                                  ? "bg-[#3572A5]"
                                  : "bg-muted-foreground/60";
                      return (
                        <Link
                          key={r.id}
                          href={ROUTES.dashboard(owner, name)}
                          className="bg-muted/40 hover:border-primary/50 hover:bg-muted/80 rounded-lg border border-outline-variant/10 p-4 transition-all"
                        >
                          <div className="mb-2 flex items-center gap-2">
                            <MaterialIcon
                              name="bolt"
                              size={18}
                              className="text-tertiary"
                            />
                            <span className="font-mono text-[12px] text-foreground">
                              {r.full_name}
                            </span>
                          </div>
                          <p className="text-muted-foreground line-clamp-2 text-[10px]">
                            {r.description}
                          </p>
                          <div className="mt-3 flex items-center justify-between">
                            <span className="text-tertiary font-mono text-[10px] font-bold">
                              {formatNumber(r.stargazers_count)} stars
                            </span>
                            <span
                              className={`size-2 shrink-0 rounded-full ${dotClass}`}
                              aria-hidden
                            />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          <aside className="bg-muted/20 w-full shrink-0 space-y-6 p-4 sm:p-6 md:w-72 md:max-h-[600px] md:overflow-y-auto">
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-muted-foreground font-mono text-[10px] font-bold tracking-[0.25em] uppercase">
                  {recent.length > 0 ? "Recent" : "Suggested"}
                </h3>
                {recent.length > 0 && (
                  <button
                    type="button"
                    className="text-primary/80 hover:text-primary font-mono text-[9px] uppercase tracking-tighter"
                    onClick={() => dispatch(clearRecentSearches())}
                  >
                    Clear all
                  </button>
                )}
              </div>
              
              <div className="flex flex-col gap-2">
                {(recent.length > 0 ? recent : FEATURED_SUGGESTIONS).map((r) => (
                  <div
                    key={r.fullName}
                    className="group flex items-center justify-between gap-1"
                  >
                    <Link
                      href={ROUTES.dashboard(r.owner, r.repo)}
                      className="text-muted-foreground hover:text-primary flex min-w-0 items-center gap-2 py-1 font-mono text-[11px] transition-colors"
                    >
                      <MaterialIcon
                        name={recent.length > 0 ? "history" : "rocket_launch"}
                        size={14}
                        className="opacity-40"
                      />
                      <span className="truncate">{r.fullName}</span>
                    </Link>
                    {recent.length > 0 && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={`Remove ${r.fullName}`}
                        onClick={() =>
                          dispatch(removeRecentSearch(r.fullName))
                        }
                      >
                        <MaterialIcon name="close" size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="border-primary/10 bg-primary/5 rounded-lg border p-4">
              <h4 className="text-primary mb-2 font-mono text-[10px] font-bold uppercase">
                Pro search
              </h4>
              <p className="text-muted-foreground text-[10px] leading-relaxed">
                Use{" "}
                <code className="bg-muted rounded px-1 font-bold text-foreground">
                  org:
                </code>{" "}
                to filter by organization or{" "}
                <code className="bg-muted rounded px-1 font-bold text-foreground">
                  lang:
                </code>{" "}
                for language-specific results (GitHub search syntax).
              </p>
            </div>

            <div className="border-border border-t border-outline-variant/10 pt-4">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="bg-tertiary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                  <span className="bg-tertiary relative inline-flex h-2 w-2 rounded-full" />
                </span>
                <span className="text-muted-foreground font-mono text-[9px] tracking-[0.2em] uppercase">
                  GitHub API connected
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div className="mt-12 overflow-hidden px-4 text-center sm:mt-20">
        <h2 className="font-heading text-foreground mb-4 text-2xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl">
          Engineer&apos;s <span className="text-primary italic">Compass</span>
        </h2>
        <p className="text-muted-foreground mx-auto max-w-xl break-words font-mono text-xs leading-relaxed sm:text-sm">
          Precision query interface for the global software ecosystem. Deep
          indexing via the GitHub Search API.
        </p>
      </div>

      <footer className="text-muted-foreground mt-10 flex flex-col items-center justify-between gap-4 border-t border-outline-variant/5 px-4 py-6 font-mono text-[9px] tracking-widest uppercase sm:flex-row sm:px-8">
        <div className="flex flex-wrap items-center justify-center gap-6 sm:justify-start">
          <div>
            <p className="mb-1 opacity-50">Results</p>
            <p className="text-tertiary text-[11px] normal-case tracking-normal">
              {searchQ.data?.total_count != null
                ? formatNumber(searchQ.data.total_count)
                : "—"}
            </p>
          </div>
          <div>
            <p className="mb-1 opacity-50">API</p>
            <p className="text-foreground text-[11px] normal-case tracking-normal">
              GitHub REST
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4 opacity-70">
          <Link href={ROUTES.trending} className="hover:text-primary transition-colors">
            Trending
          </Link>
          <span className="bg-outline-variant size-1 rounded-full" />
          <Link href="/" className="hover:text-primary transition-colors">
            Engineering hub
          </Link>
        </div>
      </footer>

      <div className="pointer-events-none fixed bottom-24 left-4 z-20 hidden items-center gap-3 rounded-full border border-white/10 bg-slate-800/30 px-4 py-2 opacity-50 backdrop-blur-md lg:left-72 lg:flex">
        <MaterialIcon name="keyboard" size={14} />
        <span className="font-mono text-[10px] tracking-widest uppercase">
          ⌘ K command palette
        </span>
      </div>
    </div>
  );
}
