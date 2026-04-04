"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialIcon } from "@/components/material-icon";
import { ConnectGitHubButton } from "@/components/connect-github-button";
import { ROUTES } from "@/constants/routes";
import { getTrendingRepos } from "@/services/githubClient";
import { formatNumber } from "@/utils/formatDate";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Search,
  Grid3X3,
  List,
  Filter,
  Star,
  GitFork,
  Eye,
  ExternalLink,
  Bookmark,
  TrendingUp,
  Code2,
  Users,
  ArrowUpRight,
  Sparkles,
  Flame,
  Zap,
  X,
  ChevronDown,
} from "lucide-react";

type TimeRange = "today" | "week" | "month";
type ViewMode = "grid" | "list";
type SortMode = "stars" | "forks" | "recent" | "name";

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
  PHP: "#4F5D95",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
};

const PIE_COLORS = ["#f43f5e", "#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#6366f1", "#ec4899", "#14b8a6"];

function getLangColor(lang: string | null) {
  return lang ? LANG_COLORS[lang] ?? "#94a3b8" : "#94a3b8";
}

interface RepoItem {
  id: number;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  language: string | null;
  owner: {
    login: string;
    avatar_url: string;
  };
  created_at: string;
  updated_at: string;
  topics?: string[];
}

export function TrendingReposPanel() {
  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("stars");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [bookmarkedRepos, setBookmarkedRepos] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  const q = useQuery({
    queryKey: ["trending", timeRange],
    queryFn: () => getTrendingRepos(timeRange),
  });

  const items: RepoItem[] = q.data?.items ?? [];

  // Extract all languages and topics
  const { languages, allTopics } = useMemo(() => {
    const langCounts: Record<string, number> = {};
    const topicCounts: Record<string, number> = {};
    
    items.forEach((r) => {
      if (r.language) {
        langCounts[r.language] = (langCounts[r.language] || 0) + 1;
      }
      r.topics?.forEach((t) => {
        topicCounts[t] = (topicCounts[t] || 0) + 1;
      });
    });
    
    return {
      languages: Object.entries(langCounts).sort((a, b) => b[1] - a[1]),
      allTopics: Object.entries(topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    };
  }, [items]);

  // Filter and sort repos
  const filteredRepos = useMemo(() => {
    let filtered = [...items];
    
    // Time range filter (based on updated_at)
    const now = new Date();
    if (timeRange === "today") {
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      filtered = filtered.filter((r) => new Date(r.updated_at) >= oneDayAgo);
    } else if (timeRange === "week") {
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      filtered = filtered.filter((r) => new Date(r.updated_at) >= oneWeekAgo);
    } else if (timeRange === "month") {
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      filtered = filtered.filter((r) => new Date(r.updated_at) >= oneMonthAgo);
    }
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.full_name.toLowerCase().includes(query) ||
          r.description?.toLowerCase().includes(query) ||
          r.language?.toLowerCase().includes(query) ||
          r.topics?.some((t) => t.toLowerCase().includes(query))
      );
    }
    
    // Language filter
    if (selectedLang) {
      filtered = filtered.filter((r) => r.language === selectedLang);
    }
    
    // Sort
    switch (sortMode) {
      case "stars":
        filtered.sort((a, b) => b.stargazers_count - a.stargazers_count);
        break;
      case "forks":
        filtered.sort((a, b) => b.forks_count - a.forks_count);
        break;
      case "name":
        filtered.sort((a, b) => a.full_name.localeCompare(b.full_name));
        break;
      case "recent":
        filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
    }
    
    return filtered;
  }, [items, searchQuery, selectedLang, sortMode, timeRange]);

  const featured = filteredRepos[0];
  const otherRepos = filteredRepos.slice(1);
  const topRepos = filteredRepos.slice(0, 10);

  const toggleBookmark = (id: number) => {
    setBookmarkedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Chart data
  const chartData = useMemo(() => {
    return topRepos.map((r, i) => ({
      name: r.full_name.split("/")[1].substring(0, 15),
      stars: r.stargazers_count,
      forks: r.forks_count,
      fullName: r.full_name,
    }));
  }, [topRepos]);

  const pieData = useMemo(() => {
    return languages.slice(0, 8).map(([lang, count]) => ({
      name: lang,
      value: count,
      color: getLangColor(lang),
    }));
  }, [languages]);

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
    const err = q.error as Error & { status?: number };
    const is401 = err.status === 401 || err.message?.includes("401");
    const isRate = err.status === 403 || err.message?.toLowerCase().includes("rate limit");

    return (
      <div className="flex flex-col items-center justify-center py-24 text-center rounded-2xl border-2 border-dashed border-border/50 gap-5 px-6">
        <div className="size-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <MaterialIcon name={is401 ? "link_off" : isRate ? "speed" : "error_outline"} size={28} className="text-amber-500" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-black">
            {is401 ? "GitHub Not Connected" : isRate ? "Rate Limit Reached" : "Failed to Load Trending"}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
            {is401
              ? "Trending data requires GitHub API access. Connect your GitHub account to unlock this page."
              : isRate
              ? "You've hit the GitHub API rate limit. Sign in with GitHub OAuth for a personal 5,000 req/hr limit."
              : err.message}
          </p>
        </div>
        {(is401 || isRate) && (
          <ConnectGitHubButton callbackUrl={ROUTES.trending} />
        )}
        {!is401 && !isRate && (
          <button
            type="button"
            onClick={() => q.refetch()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-accent transition-colors"
          >
            <MaterialIcon name="refresh" size={18} />
            Try Again
          </button>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full space-y-6 overflow-x-hidden"
    >
      {/* Hero Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Repos", value: items.length, icon: Flame, color: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/20" },
          { label: "Languages", value: languages.length, icon: Code2, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
          { label: "Total Stars", value: formatNumber(items.reduce((acc, r) => acc + r.stargazers_count, 0)), icon: Star, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
          { label: "Bookmarked", value: bookmarkedRepos.size, icon: Bookmark, color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20" },
        ].map(({ label, value, icon: Icon, color, bg, border }) => (
          <motion.div
            key={label}
            whileHover={{ y: -4 }}
            className={`p-4 rounded-2xl ${bg} border ${border}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon size={18} className={color} />
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
            </div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
          </motion.div>
        ))}
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Flame size={28} className="text-orange-500" />
              Trending Repositories
            </h1>
            <p className="text-muted-foreground text-sm">
              Discover the most starred repositories on GitHub
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search repos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-full sm:w-[200px]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X size={14} className="text-muted-foreground" />
              </button>
            )}
          </div>

          <div className="flex rounded-lg border border-border bg-muted/50 p-0.5">
            {(["today", "week", "month"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTimeRange(t)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize",
                  timeRange === t
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="relative">
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="appearance-none px-3 py-1.5 pr-8 rounded-lg border border-border bg-background text-xs font-medium cursor-pointer hover:bg-muted transition-colors"
            >
              <option value="stars">Most Stars</option>
              <option value="forks">Most Forks</option>
              <option value="recent">Recently Created</option>
              <option value="name">Name A-Z</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
          </div>

          <div className="flex rounded-lg border border-border bg-muted/50 p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === "grid" && "bg-background shadow-sm"
              )}
            >
              <Grid3X3 size={16} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === "list" && "bg-background shadow-sm"
              )}
            >
              <List size={16} />
            </button>
          </div>

          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-1"
          >
            <Filter size={14} />
            Filters
          </Button>
        </div>
      </div>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 rounded-xl bg-muted/50 border border-border space-y-4">
              <div>
                <span className="text-sm font-medium mb-2 block">Filter by Language</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedLang(null)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium transition-all",
                      selectedLang === null
                        ? "bg-violet-500 text-white"
                        : "bg-background border border-border hover:bg-muted"
                    )}
                  >
                    All
                  </button>
                  {languages.slice(0, 10).map(([lang, count]) => (
                    <button
                      key={lang}
                      onClick={() => setSelectedLang(lang === selectedLang ? null : lang)}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1.5",
                        selectedLang === lang
                          ? "bg-violet-500 text-white"
                          : "bg-background border border-border hover:bg-muted"
                      )}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: getLangColor(lang) }}
                      />
                      {lang}
                      <span className="text-[10px] opacity-70">({count})</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col xl:flex-row gap-4">
        <div className="flex-1 min-w-0 space-y-6">
          {/* Top 3 Podium - Old Style */}
          {!searchQuery && !selectedLang && filteredRepos.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Flame size={18} className="text-rose-500" />
                  Fastest Growing
                </h2>
                <span className="text-xs text-muted-foreground">
                  Top trending repositories
                </span>
              </div>
              <div className="space-y-3">
                {filteredRepos.slice(0, 3).map((r, idx) => (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className="group"
                  >
                    <Link
                      href={ROUTES.dashboard(
                        r.full_name.split("/")[0],
                        r.full_name.split("/")[1]
                      )}
                      className="flex items-center gap-4 p-3 rounded-xl hover:bg-muted/50 transition-colors"
                    >
                      {/* Rank Badge */}
                      <div className={cn(
                        "flex size-8 items-center justify-center rounded-lg font-bold text-xs shrink-0",
                        idx === 0 ? "bg-amber-500/10 text-amber-600 border border-amber-500/20" :
                        idx === 1 ? "bg-slate-400/10 text-slate-500 border border-slate-400/20" :
                        "bg-orange-600/10 text-orange-600 border border-orange-600/20"
                      )}>
                        #{idx + 1}
                      </div>

                      {/* Repo Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-foreground group-hover:text-violet-600 transition-colors truncate">
                            {r.full_name}
                          </h3>
                          {r.language && (
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: getLangColor(r.language) }}
                            />
                          )}
                        </div>
                        <p className="text-muted-foreground text-sm truncate">
                          {r.description || "No description"}
                        </p>
                      </div>

                      {/* Stats */}
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <div className="flex items-center gap-1 text-amber-500 font-semibold">
                            <Star size={14} />
                            {formatNumber(r.stargazers_count)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatNumber(r.forks_count)} forks
                          </div>
                        </div>

                        {/* Bookmark */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleBookmark(r.id);
                          }}
                          className={cn(
                            "p-2 rounded-lg transition-colors shrink-0",
                            bookmarkedRepos.has(r.id) ? "text-rose-500 bg-rose-500/10" : "text-muted-foreground hover:bg-muted"
                          )}
                        >
                          <Bookmark size={16} className={bookmarkedRepos.has(r.id) ? "fill-current" : ""} />
                        </button>
                      </div>
                    </Link>

                    {/* Progress bar for visual ranking */}
                    <div className="px-3">
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            idx === 0 ? "bg-amber-500" :
                            idx === 1 ? "bg-slate-400" :
                            "bg-orange-600"
                          )}
                          style={{ width: `${Math.min(100, (r.stargazers_count / (filteredRepos[0]?.stargazers_count || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Repo Grid/List */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Zap size={16} className="text-amber-500" />
                {searchQuery || selectedLang ? `Results (${filteredRepos.length - 3})` : `Repositories #4-${filteredRepos.length}`}
              </h2>
            </div>

            <AnimatePresence mode="wait">
              {viewMode === "grid" ? (
                <motion.div
                  key="grid"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="grid gap-4 sm:grid-cols-2"
                >
                  {otherRepos.map((repo, idx) => (
                    <motion.div
                      key={repo.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      <RepoCard
                        repo={repo}
                        bookmarked={bookmarkedRepos.has(repo.id)}
                        onBookmark={() => toggleBookmark(repo.id)}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="list"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2"
                >
                  {otherRepos.map((repo, idx) => (
                    <motion.div
                      key={repo.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.03 }}
                    >
                      <RepoListItem
                        repo={repo}
                        bookmarked={bookmarkedRepos.has(repo.id)}
                        onBookmark={() => toggleBookmark(repo.id)}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Sidebar */}
        <aside className="space-y-4 w-full xl:w-[240px] shrink-0">
          {/* Language Distribution Chart */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Code2 size={18} className="text-violet-500" />
              Language Distribution
            </h3>
            {pieData.length > 0 ? (
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--background)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">
                No language data available
              </p>
            )}
            <div className="mt-4 space-y-1">
              {pieData.slice(0, 5).map((item) => (
                <div key={item.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="font-medium">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stars Chart */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-rose-500" />
              Top 10 by Stars
            </h3>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 60, right: 20, top: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 10, fill: "var(--foreground)" }}
                    width={55}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--background)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(value) => [formatNumber(Number(value)), "Stars"]}
                  />
                  <Bar dataKey="stars" fill="#f43f5e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Popular Topics */}
          {allTopics.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Sparkles size={18} className="text-amber-500" />
                Popular Topics
              </h3>
              <div className="flex flex-wrap gap-2">
                {allTopics.map(([topic, count]) => (
                  <button
                    key={topic}
                    onClick={() => setSearchQuery(topic)}
                    className="px-2.5 py-1 rounded-full bg-muted hover:bg-violet-500/10 hover:text-violet-600 text-xs font-medium transition-colors"
                  >
                    #{topic}
                    <span className="ml-1 text-muted-foreground">({count})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Top Contributors */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Users size={18} className="text-blue-500" />
              Top Organizations
            </h3>
            <div className="space-y-3">
              {items
                .slice(0, 5)
                .map((r) => r.owner)
                .filter((o, i, arr) => arr.findIndex((t) => t.login === o.login) === i)
                .slice(0, 4)
                .map((owner) => (
                  <a
                    key={owner.login}
                    href={`https://github.com/${owner.login}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-muted transition-colors group"
                  >
                    <Image
                      src={owner.avatar_url}
                      alt={owner.login}
                      width={36}
                      height={36}
                      className="rounded-full"
                    />
                    <span className="text-sm font-medium group-hover:text-violet-600 transition-colors">
                      @{owner.login}
                    </span>
                    <ArrowUpRight size={14} className="ml-auto text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                ))}
            </div>
          </div>
        </aside>
      </div>
    </motion.div>
  );
}

// Repo Card Component
function RepoCard({
  repo,
  bookmarked,
  onBookmark,
}: {
  repo: RepoItem;
  bookmarked: boolean;
  onBookmark: () => void;
}) {
  const [owner, name] = repo.full_name.split("/");

  return (
    <div className="group rounded-xl border border-border bg-card p-4 hover:shadow-md hover:border-violet-500/20 transition-all">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: getLangColor(repo.language) }}
          />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">
            {repo.language ?? "—"}
          </span>
        </div>
        <button
          onClick={onBookmark}
          className={cn(
            "p-1 rounded-md transition-colors",
            bookmarked ? "text-rose-500 bg-rose-500/10" : "text-muted-foreground hover:bg-muted"
          )}
        >
          <Bookmark size={14} className={bookmarked ? "fill-current" : ""} />
        </button>
      </div>

      <Link href={ROUTES.dashboard(owner, name)}>
        <h3 className="font-semibold text-sm text-foreground group-hover:text-violet-600 transition-colors mb-1 line-clamp-1">
          {repo.full_name}
        </h3>
      </Link>

      <p className="text-muted-foreground text-xs line-clamp-2 mb-3 h-8">
        {repo.description || "No description available"}
      </p>

      {repo.topics && repo.topics.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {repo.topics.slice(0, 2).map((topic) => (
            <span
              key={topic}
              className="px-1.5 py-0.5 rounded-full bg-muted text-[9px] text-muted-foreground"
            >
              #{topic}
            </span>
          ))}
          {repo.topics.length > 2 && (
            <span className="px-1.5 py-0.5 rounded-full bg-muted text-[9px] text-muted-foreground">
              +{repo.topics.length - 2}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-2 border-t border-border">
        <span className="flex items-center gap-1 text-amber-500">
          <Star size={10} />
          {formatNumber(repo.stargazers_count)}
        </span>
        <span className="flex items-center gap-1">
          <GitFork size={10} />
          {formatNumber(repo.forks_count)}
        </span>
        <span className="flex items-center gap-1">
          <Eye size={10} />
          {formatNumber(repo.watchers_count)}
        </span>
      </div>
    </div>
  );
}

// Repo List Item Component
function RepoListItem({
  repo,
  bookmarked,
  onBookmark,
}: {
  repo: RepoItem;
  bookmarked: boolean;
  onBookmark: () => void;
}) {
  const [owner, name] = repo.full_name.split("/");

  return (
    <div className="group flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors">
      <div
        className="size-3 rounded-full shrink-0"
        style={{ backgroundColor: getLangColor(repo.language) }}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link href={ROUTES.dashboard(owner, name)}>
            <h3 className="font-medium text-foreground group-hover:text-violet-600 transition-colors">
              {repo.full_name}
            </h3>
          </Link>
          {repo.topics && repo.topics.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] text-muted-foreground">
              #{repo.topics[0]}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-sm truncate">
          {repo.description || "No description"}
        </p>
      </div>

      <div className="flex items-center gap-4 text-sm text-muted-foreground shrink-0">
        <span className="flex items-center gap-1">
          <Star size={14} className="text-amber-500" />
          {formatNumber(repo.stargazers_count)}
        </span>
        <span className="flex items-center gap-1">
          <GitFork size={14} />
          {formatNumber(repo.forks_count)}
        </span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onBookmark}
          className={cn(
            "p-2 rounded-lg transition-colors",
            bookmarked ? "text-rose-500 bg-rose-500/10" : "text-muted-foreground hover:bg-muted"
          )}
        >
          <Bookmark size={16} className={bookmarked ? "fill-current" : ""} />
        </button>
        <a
          href={`https://github.com/${repo.full_name}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="ghost" size="icon" className="size-8">
            <ExternalLink size={14} />
          </Button>
        </a>
      </div>
    </div>
  );
}
