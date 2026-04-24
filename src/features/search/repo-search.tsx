"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Star,
  GitFork,
  Clock,
  TrendingUp,
  Sparkles,
  Target,
  Compass,
  BookOpen,
  Code2,
  Layers,
  Box,
  Cpu,
  Globe,
  Flame,
  Bookmark,
} from "lucide-react";

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
    // Only sync from URL if the query param is different from current state
    // and we're not currently typing (debounced value matches current value)
    if (initial !== q && initial !== debounced) {
      setQ(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]); // intentionally omits q/debounced — including them would cause an infinite sync loop

  const searchQ = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => searchRepositories(debounced),
    enabled: debounced.trim().length > 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  const trendingQ = useQuery({
    queryKey: ["trending", "search-sidebar"],
    queryFn: () => getTrendingRepos(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Fetch rate limit data
  const rateLimitQ = useQuery({
    queryKey: ["rate-limit"],
    queryFn: async () => {
      const res = await fetch("/api/github/rate-limit");
      if (!res.ok) throw new Error("Failed to fetch rate limit");
      return res.json();
    },
    staleTime: 30 * 1000, // 30 seconds
  });

  const items = useMemo(() => {
    const raw = searchQ.data?.items ?? [];
    const searchStr = debounced.startsWith("@") ? debounced.slice(1) : debounced;
    // Skip fuzzy filtering if query contains GitHub search qualifiers
    const hasQualifiers = /(language:|stars:|topic:|pushed:|org:|repo:)/.test(searchStr);
    if (hasQualifiers) return raw;
    return fuzzySort(raw, searchStr, (r) => r.full_name);
  }, [searchQ.data?.items, debounced]);

  const [trendingPage, setTrendingPage] = useState(0);
  const [searchPage, setSearchPage] = useState(0);
  const itemsPerPage = 6;

  // Calculate paginated search items
  const paginatedSearchItems = useMemo(() => {
    const start = searchPage * itemsPerPage;
    return items.slice(start, start + itemsPerPage);
  }, [items, searchPage]);

  // Total pages for search
  const totalSearchPages = useMemo(() => {
    return Math.ceil(items.length / itemsPerPage);
  }, [items]);
  const trendingItems = useMemo(() => {
    const all = trendingQ.data?.items ?? [];
    const start = trendingPage * itemsPerPage;
    return all.slice(start, start + itemsPerPage);
  }, [trendingQ.data?.items, trendingPage]);

  // Total pages for trending
  const totalTrendingPages = useMemo(() => {
    const total = trendingQ.data?.items?.length ?? 0;
    return Math.ceil(total / itemsPerPage);
  }, [trendingQ.data?.items]);

  // Get trending topic from first trending repo

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

  // Helper to set search query and execute immediately
  const setSearchQuery = useCallback((query: string) => {
    setQ(query);
    setSearchPage(0); // Reset to first page
    // Trigger search immediately without waiting for debounce
    router.push(`/search?q=${encodeURIComponent(query)}`);
    // Manually trigger the search query
    setTimeout(() => {
      searchQ.refetch();
    }, 0);
  }, [router, searchQ]);

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

      <div className="spotlight-glow glass-panel relative overflow-hidden rounded-none border border-outline-variant/20 shadow-2xl">
        <div className="relative flex flex-wrap items-center gap-2 border-b border-white/5 py-2 pr-3 pl-2 sm:flex-nowrap sm:py-0 sm:pr-6 sm:pl-4">
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
            <kbd className="border-border text-muted-foreground hidden rounded border bg-stone-100/80 px-2 py-1 font-mono text-[10px] sm:inline-block dark:bg-stone-800/80">
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

        <div className="flex h-150 flex-col overflow-hidden md:flex-row">
          <div className="flex-1 overflow-hidden border-b border-outline-variant/10 md:border-r md:border-b-0">
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
                      <Skeleton key={i} className="h-16 w-full rounded-none" />
                    ))}
                  </div>
                )}

                {searchQ.isError && (() => {
                  const err = searchQ.error as Error & { status?: number };
                  const is401 = err.status === 401 || err.message?.includes("401");
                  return (
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                      <MaterialIcon name={is401 ? "link_off" : "error_outline"} size={28} className="text-amber-500" />
                      <p className="text-sm font-bold text-foreground">
                        {is401 ? "GitHub Not Connected" : "Search unavailable"}
                      </p>
                      <p className="text-xs text-muted-foreground max-w-xs">
                        {is401 ? "Connect your GitHub account to enable search." : err.message}
                      </p>
                      {is401 && (
                        <button
                          type="button"
                          onClick={() => signIn("github", { callbackUrl: ROUTES.search })}
                          className="text-xs font-bold text-amber-500 hover:underline"
                        >
                          Connect GitHub →
                        </button>
                      )}
                    </div>
                  );
                })()}

                {!searchQ.isLoading &&
                  !searchQ.isError &&
                  items.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                      No repositories match your query.
                    </p>
                  )}

                <div className="space-y-1">
                  {paginatedSearchItems.map((r: GitHubRepo, idx: number) => (
                    <motion.button
                      key={r.id}
                      type="button"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.02 }}
                      onClick={() => openRepo(r)}
                      className="hover:bg-muted/60 group flex w-full items-center justify-between rounded-none border border-transparent p-3 text-left transition-all hover:border-outline-variant/20"
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
                            <span className="text-muted-foreground line-clamp-1 max-w-full wrap-break-word text-[10px]">
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

                {/* Search Results Pagination - Smart */}
                {totalSearchPages > 1 && (
                  <SmartPagination
                    currentPage={searchPage}
                    totalPages={totalSearchPages}
                    onPageChange={setSearchPage}
                  />
                )}
              </div>
            ) : (
              <>
                <div className="p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-muted-foreground font-mono text-[10px] font-bold tracking-[0.3em] uppercase">
                      Trending globally
                    </h3>
                    <TrendingPagination 
                      currentPage={trendingPage}
                      totalPages={totalTrendingPages}
                      onPageChange={setTrendingPage}
                    />
                  </div>
                  {trendingQ.isLoading && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 rounded-none" />
                      ))}
                    </div>
                  )}
                  {trendingQ.isError && (
                    <p className="text-xs text-muted-foreground px-3 py-2">
                      {(trendingQ.error as Error & { status?: number }).status === 401
                        ? "Connect GitHub to see trending repos."
                        : "Could not load trending repos."}
                    </p>
                  )}
                  <TrendingReposGrid 
                    items={trendingItems} 
                    page={trendingPage}
                  />
                </div>
              </>
            )}
          </div>

          <aside className="bg-muted/20 w-full shrink-0 space-y-6 p-4 sm:p-6 md:w-72 md:max-h-150 md:overflow-y-auto">
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

            <div className="border-primary/10 bg-primary/5 rounded-none border p-4">
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

            <div className="border-t border-outline-variant/10 pt-4">
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

      {/* Engineer's Compass - Now Functional */}
      <section className="mt-12 sm:mt-20 px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-4">
            <Compass className="size-4 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              Quick Navigator
            </span>
          </div>
          <h2 className="font-heading text-foreground mb-3 text-2xl font-bold tracking-tighter sm:text-3xl md:text-4xl">
            Engineer&apos;s <span className="text-primary italic">Compass</span>
          </h2>
          <p className="text-muted-foreground mx-auto max-w-lg text-xs sm:text-sm">
            Jump to popular categories, trending topics, or discover new repositories across the ecosystem.
          </p>
        </div>

        {/* Quick Action Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 max-w-4xl mx-auto mb-8">
          <QuickActionCard
            icon={Flame}
            title="Trending"
            description="Hot repos today"
            href={ROUTES.trending}
            color="text-rose-500"
            bgColor="bg-rose-500/10"
          />
          <QuickActionCard
            icon={Star}
            title="Most Starred"
            description="Top rated repos"
            onClick={() => setSearchQuery("stars:>1000")}
            color="text-amber-500"
            bgColor="bg-amber-500/10"
          />
          <QuickActionCard
            icon={Clock}
            title="Recently Updated"
            description="Fresh commits"
            onClick={() => setSearchQuery("pushed:>2024-12-01")}
            color="text-emerald-500"
            bgColor="bg-emerald-500/10"
          />
          <QuickActionCard
            icon={Bookmark}
            title="Your Bookmarks"
            description="Saved repos"
            href={ROUTES.bookmarks}
            color="text-amber-500"
            bgColor="bg-amber-500/10"
          />
        </div>

        {/* Search Categories */}
        <div className="max-w-4xl mx-auto">
          <h3 className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4">
            Popular Categories
          </h3>
          <div className="flex flex-wrap justify-center gap-2">
            <CategoryBadge icon={Code2} label="JavaScript" onClick={() => setSearchQuery("language:javascript")} />
            <CategoryBadge icon={Layers} label="TypeScript" onClick={() => setSearchQuery("language:typescript")} />
            <CategoryBadge icon={Box} label="React" onClick={() => setSearchQuery("react")} />
            <CategoryBadge icon={Cpu} label="Rust" onClick={() => setSearchQuery("language:rust")} />
            <CategoryBadge icon={Globe} label="Go" onClick={() => setSearchQuery("language:go")} />
            <CategoryBadge icon={BookOpen} label="Python" onClick={() => setSearchQuery("language:python")} />
            <CategoryBadge icon={Sparkles} label="AI/ML" onClick={() => setSearchQuery("machine-learning")} />
            <CategoryBadge icon={Target} label="DevTools" onClick={() => setSearchQuery("devtools")} />
          </div>
        </div>
      </section>

      {/* Enhanced Footer */}
      <footer className="mt-16 border-t border-outline-variant/10">
        {/* Stats Bar */}
        <div className="border-b border-outline-variant/5 px-4 py-4 sm:px-8">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-center sm:justify-between gap-4">
            <div className="flex items-center gap-6">
              <FooterStat
                label="Total Results"
                value={searchQ.data?.total_count != null ? formatNumber(searchQ.data.total_count) : "—"}
                icon={Search}
              />
              <FooterStat
                label="API Source"
                value="GitHub REST"
                icon={Code2}
              />
              <FooterStat
                label="Rate Limit"
                value={rateLimitQ.data?.remaining != null 
                  ? `${rateLimitQ.data.remaining}/${rateLimitQ.data.limit}` 
                  : "—"}
                icon={Clock}
              />
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="bg-emerald-500 absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                <span className="bg-emerald-500 relative inline-flex h-2 w-2 rounded-full" />
              </span>
              System Operational
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="px-4 py-6 sm:px-8">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex flex-wrap items-center justify-center gap-6">
              <FooterLink href={ROUTES.trending} icon={TrendingUp}>
                Trending
              </FooterLink>
              <FooterLink href="/compare" icon={GitFork}>
                Compare
              </FooterLink>
              <FooterLink href="/topics" icon={Layers}>
                Topics
              </FooterLink>
              <FooterLink href="/" icon={Compass}>
                Dashboard
              </FooterLink>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground opacity-70">
              <span>Press</span>
              <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[9px]">ESC</kbd>
              <span>to clear</span>
              <span className="mx-2">•</span>
              <span>Press</span>
              <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[9px]">ENTER</kbd>
              <span>to search</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}

// Sub-components - Memoized for performance

const QuickActionCard = React.memo(function QuickActionCard({
  icon: Icon,
  title,
  description,
  href,
  onClick,
  color,
  bgColor,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href?: string;
  onClick?: () => void;
  color: string;
  bgColor: string;
}) {
  const content = (
    <motion.div
      whileHover={{ y: -2 }}
      className="group cursor-pointer"
    >
      <Card className="p-4 h-full border-border hover:border-primary/30 transition-all hover:shadow-md">
        <div className={`w-10 h-10 rounded-none ${bgColor} flex items-center justify-center mb-3`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <h4 className="font-semibold text-sm mb-1 group-hover:text-primary transition-colors">
          {title}
        </h4>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </Card>
    </motion.div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return <div onClick={onClick}>{content}</div>;
});

const CategoryBadge = React.memo(function CategoryBadge({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border hover:bg-muted hover:border-primary/30 transition-all text-xs font-medium"
    >
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      {label}
    </button>
  );
});

const FooterStat = React.memo(function FooterStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <div>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground opacity-70">{label}</p>
        <p className="text-[11px] font-medium">{value}</p>
      </div>
    </div>
  );
});

const FooterLink = React.memo(function FooterLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
      {children}
    </Link>
  );
});

// Trending Pagination Component
function TrendingPagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onPageChange(Math.max(0, currentPage - 1))}
        disabled={currentPage === 0}
        className="p-1.5 rounded-none hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous page"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-[10px] font-mono text-muted-foreground min-w-[3ch] text-center">
        {currentPage + 1}/{totalPages}
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
        disabled={currentPage >= totalPages - 1}
        className="p-1.5 rounded-none hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Next page"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

// Trending Repos Grid Component
function TrendingReposGrid({
  items,
}: {
  items: GitHubRepo[];
  page: number;
}) {
  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <AnimatePresence>
        {items.map((r, idx) => {
          const [owner, name] = r.full_name.split("/");
          const dotClass =
            r.language === "JavaScript"
              ? "bg-[#f1e05a]"
              : r.language === "TypeScript"
                ? "bg-[#c77a12]"
                : r.language === "Rust"
                  ? "bg-[#dea584]"
                  : r.language === "Go"
                    ? "bg-[#d97706]"
                    : r.language === "Python"
                      ? "bg-[#0e9966]"
                      : "bg-muted-foreground/60";
          return (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Link
                href={ROUTES.dashboard(owner, name)}
                className="bg-muted/40 hover:border-primary/50 hover:bg-muted/80 rounded-none border border-outline-variant/10 p-4 transition-all block"
              >
                <div className="mb-2 flex items-center gap-2">
                  <MaterialIcon
                    name="bolt"
                    size={18}
                    className="text-tertiary"
                  />
                  <span className="font-mono text-[12px] text-foreground truncate">
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
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// Smart Pagination Component - Shows nearby pages only
function SmartPagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const getVisiblePages = () => {
    const pages: (number | string)[] = [];
    const delta = 1; // Show 1 page before and after current

    // Always show first page
    pages.push(0);

    // Calculate range around current page
    const rangeStart = Math.max(1, currentPage - delta);
    const rangeEnd = Math.min(totalPages - 2, currentPage + delta);

    // Add ellipsis after first page if needed
    if (rangeStart > 1) {
      pages.push('...');
    }

    // Add pages in range
    for (let i = rangeStart; i <= rangeEnd; i++) {
      pages.push(i);
    }

    // Add ellipsis before last page if needed
    if (rangeEnd < totalPages - 2) {
      pages.push('...');
    }

    // Always show last page if different from first
    if (totalPages > 1) {
      pages.push(totalPages - 1);
    }

    return pages;
  };

  const visiblePages = getVisiblePages();

  return (
    <div className="mt-4 flex items-center justify-center gap-1">
      {/* Previous Button */}
      <button
        onClick={() => onPageChange(Math.max(0, currentPage - 1))}
        disabled={currentPage === 0}
        className="p-1.5 rounded-none hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous page"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Page Numbers */}
      <div className="flex items-center gap-0.5">
        {visiblePages.map((page, idx) => (
          page === '...' ? (
            <span key={`ellipsis-${idx}`} className="px-2 text-xs text-muted-foreground">
              ...
            </span>
          ) : (
            <button
              key={page}
              onClick={() => onPageChange(page as number)}
              className={`min-w-7 h-7 px-2 rounded-none text-xs font-medium transition-colors ${
                currentPage === page
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-muted-foreground'
              }`}
            >
              {(page as number) + 1}
            </button>
          )
        ))}
      </div>

      {/* Next Button */}
      <button
        onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
        disabled={currentPage >= totalPages - 1}
        className="p-1.5 rounded-none hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Next page"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
