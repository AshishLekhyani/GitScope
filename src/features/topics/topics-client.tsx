"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/material-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  Cell
} from "recharts";
import { 
  Search, 
  Grid3X3, 
  Cloud, 
  List, 
  ArrowUpDown, 
  Filter,
  Copy,
  Download,
  ExternalLink,
  X,
  Check,
  TrendingUp,
  BarChart3,
  Tag,
  Folder,
  FolderOpen,
  ChevronDown,
  Sparkles
} from "lucide-react";

// Types
interface TopicEntry {
  name: string;
  count: number;
}

interface RepoTopicGroup {
  query: string;
  topics: string[];
}

interface TopicsPageClientProps {
  repoQueries: string[];
  repoTopics: RepoTopicGroup[];
  rankedTopics: (TopicEntry & { source?: 'user' | 'trending' | 'popular' })[];
  trendingTopics?: Array<{ name: string; count: number; repos: string[] }>;
  popularTopics?: string[];
}

// Storage key for persisting state
const STORAGE_KEY = "topics-explorer-state";

// Default state
const defaultState = {
  viewMode: "cloud" as ViewMode,
  sortMode: "count" as SortMode,
  currentPage: 1,
  searchQuery: "",
  minCount: 1,
  showFilters: false,
};

// Load state from localStorage
function loadSavedState() {
  if (typeof window === "undefined") return defaultState;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultState, ...parsed };
    }
  } catch {
    // Ignore errors
  }
  return defaultState;
}

// Save state to localStorage
function saveState(state: typeof defaultState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore errors
  }
}

type ViewMode = "cloud" | "grid" | "list" | "discover";
type SortMode = "count" | "name" | "trending";

export function TopicsPageClient({ 
  repoQueries, 
  repoTopics, 
  rankedTopics,
  trendingTopics = [],
  popularTopics = []
}: TopicsPageClientProps) {
  const router = useRouter();
  
  // Load saved state on mount
  const savedState = loadSavedState();
  
  const [searchQuery, setSearchQuery] = useState(savedState.searchQuery);
  const [viewMode, setViewMode] = useState<ViewMode>(savedState.viewMode);
  const [sortMode, setSortMode] = useState<SortMode>(savedState.sortMode);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [copiedTopic, setCopiedTopic] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(savedState.showFilters);
  const [currentPage, setCurrentPage] = useState(savedState.currentPage);
  const [minCount, setMinCount] = useState(savedState.minCount);
  const [bookmarks, setBookmarks] = useState<string[]>(savedState.bookmarks);
  const itemsPerPage = 20;

  // Save state whenever it changes
  useEffect(() => {
    saveState({
      viewMode,
      sortMode,
      currentPage,
      searchQuery,
      minCount,
      showFilters,
    });
  }, [viewMode, sortMode, currentPage, searchQuery, minCount, showFilters]);

  const maxCount = rankedTopics[0]?.count ?? 1;
  const hasHistory = repoQueries.length > 0;
  const hasTopics = rankedTopics.length > 0;

  // Filter, sort and paginate topics
  const filteredTopics = useMemo(() => {
    let topics = [...rankedTopics];
    
    // Search filter
    if (searchQuery) {
      topics = topics.filter(t => 
        t.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Min count filter
    topics = topics.filter(t => t.count >= minCount);
    
    // Sort
    switch (sortMode) {
      case "name":
        topics.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "count":
        topics.sort((a, b) => b.count - a.count);
        break;
      case "trending":
        topics.sort(() => Math.random() - 0.5);
        break;
    }
    
    return topics;
  }, [rankedTopics, searchQuery, sortMode, minCount]);

  // Pagination
  const totalPages = Math.ceil(filteredTopics.length / itemsPerPage);
  const paginatedTopics = filteredTopics.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Reset to page 1 when filters change
  useMemo(() => {
    setCurrentPage(1);
  }, [searchQuery, sortMode, minCount]);

  // Get repos for a specific topic
  const getReposForTopic = (topic: string) => {
    return repoTopics
      .filter(rt => rt.topics.includes(topic))
      .map(rt => rt.query);
  };

  // Get related topics (topics that appear with this one)
  const getRelatedTopics = (topic: string) => {
    const reposWithTopic = repoTopics.filter(rt => rt.topics.includes(topic));
    const relatedCounts = new Map<string, number>();
    
    reposWithTopic.forEach(rt => {
      rt.topics.forEach(t => {
        if (t !== topic) {
          relatedCounts.set(t, (relatedCounts.get(t) || 0) + 1);
        }
      });
    });
    
    return Array.from(relatedCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  };

  // Copy topic to clipboard
  const copyTopic = async (topic: string) => {
    await navigator.clipboard.writeText(topic);
    setCopiedTopic(topic);
    setTimeout(() => setCopiedTopic(null), 2000);
  };

  // Export topics as JSON
  const exportTopics = () => {
    const data = {
      topics: rankedTopics,
      generatedAt: new Date().toISOString(),
      totalRepos: repoQueries.length,
      reposWithTopics: repoTopics.length
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "topics-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Tag size class
  const tagSizeClass = (count: number) => {
    const ratio = count / maxCount;
    if (ratio >= 0.75) return "text-lg font-bold px-4 py-2";
    if (ratio >= 0.5) return "text-base font-semibold px-3.5 py-1.5";
    if (ratio >= 0.35) return "text-sm font-medium px-3 py-1.5";
    if (ratio >= 0.2) return "text-xs font-medium px-2.5 py-1";
    return "text-xs font-normal px-2 py-1";
  };

  // Selected topic data
  const selectedTopicData = selectedTopic ? {
    name: selectedTopic,
    count: rankedTopics.find(t => t.name === selectedTopic)?.count || 0,
    repos: getReposForTopic(selectedTopic),
    related: getRelatedTopics(selectedTopic)
  } : null;

  if (!hasHistory) {
    return (
      <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border-2 border-dashed border-border/50 gap-6">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-violet-500/10">
            <MaterialIcon name="travel_explore" size={32} className="text-violet-500/60" />
          </div>
          <div className="space-y-2 max-w-sm">
            <h3 className="text-xl font-semibold">No Repository History Yet</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Analyze some public GitHub repositories first to explore topics and discover patterns across your searches.
            </p>
          </div>
          <Link href="/search">
            <Button className="gap-2">
              <Search size={18} />
              Analyze a Repository
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!hasTopics) {
    return (
      <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-2xl border-2 border-dashed border-border/50 gap-4">
          <MaterialIcon name="label_off" size={40} className="text-muted-foreground/30" />
          <div>
            <h3 className="text-lg font-semibold mb-1">No Topics Found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              None of your analyzed repositories have GitHub topics set.
            </p>
          </div>
          <Link href="/search">
            <Button variant="outline">Analyze More Repositories</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 mb-3">
              <span className="size-2 rounded-full bg-violet-500 animate-pulse" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                Discovery
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <MaterialIcon name="travel_explore" size={32} className="text-violet-500" />
              Topic Explorer
            </h1>
            <p className="text-muted-foreground mt-1.5 text-sm">
              Discover patterns and insights across your repositories
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={exportTopics}
              className="gap-2"
            >
              <Download size={16} />
              Export
            </Button>
            <div className="flex items-center gap-4 px-5 py-3 rounded-xl bg-card border border-border shadow-sm">
              <div className="p-2 rounded-lg bg-violet-500/10">
                <Tag size={18} className="text-violet-500" />
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Topics
                </div>
                <div className="text-2xl font-bold">{filteredTopics.length}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
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

          <div className="flex items-center gap-2">
            {/* View Toggle */}
            <div className="flex items-center border rounded-lg p-1 bg-muted/50">
              <button
                onClick={() => setViewMode("cloud")}
                className={cn(
                  "p-2 rounded-md transition-all",
                  viewMode === "cloud" && "bg-white dark:bg-slate-800 shadow-sm"
                )}
              >
                <Cloud size={16} />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "p-2 rounded-md transition-all",
                  viewMode === "grid" && "bg-white dark:bg-slate-800 shadow-sm"
                )}
              >
                <Grid3X3 size={16} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "p-2 rounded-md transition-all",
                  viewMode === "list" && "bg-white dark:bg-slate-800 shadow-sm"
                )}
              >
                <List size={16} />
              </button>
              <button
                onClick={() => setViewMode("discover")}
                className={cn(
                  "p-2 rounded-md transition-all",
                  viewMode === "discover" && "bg-white dark:bg-slate-800 shadow-sm"
                )}
                title="Discover"
              >
                <Sparkles size={16} />
              </button>
            </div>

            {/* Sort Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger>
                <button className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-background hover:bg-muted text-sm font-medium transition-colors">
                  <ArrowUpDown size={14} />
                  Sort
                  <ChevronDown size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSortMode("count")}>
                  <BarChart3 size={14} className="mr-2" />
                  By Count
                  {sortMode === "count" && <Check size={14} className="ml-2" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortMode("name")}>
                  <ArrowUpDown size={14} className="mr-2" />
                  By Name
                  {sortMode === "name" && <Check size={14} className="ml-2" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortMode("trending")}>
                  <TrendingUp size={14} className="mr-2" />
                  Trending
                  {sortMode === "trending" && <Check size={14} className="ml-2" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Filter Toggle */}
            <Button
              variant={showFilters ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="gap-2"
            >
              <Filter size={14} />
              Filter
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
              <div className="p-4 rounded-xl bg-muted/50 border border-border">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium">Min repos:</span>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 5].map(n => (
                      <button
                        key={n}
                        onClick={() => setMinCount(n)}
                        className={cn(
                          "px-3 py-1 rounded-md text-sm transition-colors",
                          minCount === n 
                            ? "bg-violet-500 text-white" 
                            : "bg-white dark:bg-slate-800 hover:bg-muted"
                        )}
                      >
                        {n}+
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { 
              label: "With Topics", 
              value: repoTopics.length,
              icon: Folder,
              color: "text-emerald-500",
              bg: "bg-emerald-500/10"
            },
            { 
              label: "Without Topics", 
              value: repoQueries.length - repoTopics.length,
              icon: FolderOpen,
              color: "text-amber-500",
              bg: "bg-amber-500/10"
            },
            { 
              label: "Total Topics", 
              value: rankedTopics.length,
              icon: Tag,
              color: "text-violet-500",
              bg: "bg-violet-500/10"
            },
            { 
              label: "Coverage", 
              value: `${Math.round((repoTopics.length / repoQueries.length) * 100)}%`,
              icon: Sparkles,
              color: "text-blue-500",
              bg: "bg-blue-500/10"
            },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <motion.div 
              key={label}
              whileHover={{ y: -2 }}
              className="p-4 rounded-xl bg-card border border-border shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={`p-1.5 rounded-lg ${bg}`}>
                  <Icon size={16} className={color} />
                </div>
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
              </div>
              <div className="text-xl font-bold pl-10">{value}</div>
            </motion.div>
          ))}
        </div>

        {/* Topics View */}
        <AnimatePresence mode="wait">
          {viewMode === "cloud" && (
            <motion.section
              key="cloud"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Cloud size={18} className="text-violet-500" />
                  Topic Cloud
                </h2>
                <span className="text-xs text-muted-foreground">
                  Click a topic to view details
                </span>
              </div>
              <div className="flex flex-wrap gap-3 items-center justify-center min-h-[200px]">
                {filteredTopics.map(({ name, count }) => (
                  <Tooltip key={name}>
                    <TooltipTrigger>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setSelectedTopic(name)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full",
                          "bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300",
                          "hover:bg-violet-500/20 hover:border-violet-500/40",
                          "transition-all duration-150 cursor-pointer",
                          tagSizeClass(count)
                        )}
                      >
                        <span className="text-violet-500/60 text-[10px]">#</span>
                        {name}
                        {count > 1 && (
                          <span className="text-[10px] font-medium bg-violet-500/20 rounded-full px-1.5 py-0.5 ml-0.5">
                            {count}
                          </span>
                        )}
                      </motion.button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{count} repositories</p>
                      <p className="text-xs text-muted-foreground">Click to view details</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </motion.section>
          )}

          {viewMode === "grid" && (
            <motion.div
              key="grid"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {filteredTopics.map(({ name, count }) => {
                const repos = getReposForTopic(name);
                return (
                  <motion.div
                    key={name}
                    whileHover={{ y: -4 }}
                    className="p-5 rounded-2xl border border-border bg-card shadow-sm hover:shadow-md transition-all cursor-pointer"
                    onClick={() => setSelectedTopic(name)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <Badge 
                        variant="secondary" 
                        className="bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20"
                      >
                        #{name}
                      </Badge>
                      <span className="text-xs font-medium text-muted-foreground">
                        {count}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {repos.slice(0, 3).map(repo => (
                        <p key={repo} className="text-xs text-muted-foreground truncate">
                          {repo}
                        </p>
                      ))}
                      {repos.length > 3 && (
                        <p className="text-xs text-violet-500">
                          +{repos.length - 3} more
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {viewMode === "list" && (
            <motion.div
              key="list"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
                <div className="flex items-center gap-2">
                  <List size={18} className="text-violet-500" />
                  <h2 className="font-semibold text-sm">
                    Topics {filteredTopics.length > 0 && `(${filteredTopics.length})`}
                  </h2>
                </div>
                {totalPages > 1 && (
                  <span className="text-xs text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                )}
              </div>
              <div className="divide-y divide-border/50">
                {paginatedTopics.map(({ name, count, source }, i) => {
                  const actualIndex = (currentPage - 1) * itemsPerPage + i;
                  const pct = Math.round((count / maxCount) * 100);
                  return (
                    <motion.div
                      key={name}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="group flex items-center gap-4 px-6 py-3.5 hover:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => setSelectedTopic(name)}
                    >
                      <span className="text-xs font-medium text-muted-foreground w-6 shrink-0 text-right">
                        {actualIndex + 1}
                      </span>
                      <div className="flex-1 space-y-1.5 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">#{name}</span>
                            {source === 'trending' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600">Hot</span>
                            )}
                            {source === 'popular' && count === 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600">Explore</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-violet-600 dark:text-violet-400 shrink-0">
                              {count > 0 ? `${count} repo${count !== 1 ? "s" : ""}` : "—"}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copyTopic(name);
                              }}
                              className="p-1 rounded hover:bg-muted transition-colors"
                            >
                              {copiedTopic === name ? (
                                <Check size={12} className="text-emerald-500" />
                              ) : (
                                <Copy size={12} className="text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
              
              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-muted/30">
                  <button
                    onClick={() => setCurrentPage((p: number) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
                  >
                    ← Previous
                  </button>
                  
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      // Show pages around current page
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={cn(
                            "w-8 h-8 rounded-md text-sm font-medium transition-colors",
                            currentPage === pageNum
                              ? "bg-violet-500 text-white"
                              : "hover:bg-muted text-muted-foreground"
                          )}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  
                  <button
                    onClick={() => setCurrentPage((p: number) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
                  >
                    Next →
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {viewMode === "discover" && (
            <motion.div
              key="discover"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {/* Top Stats Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <motion.div 
                  whileHover={{ y: -4 }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-rose-500/10 to-orange-500/10 border border-rose-500/20"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp size={18} className="text-rose-500" />
                    <span className="text-xs font-medium text-rose-600">Trending</span>
                  </div>
                  <div className="text-3xl font-bold text-rose-600">{trendingTopics.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Hot topics now</div>
                </motion.div>
                
                <motion.div 
                  whileHover={{ y: -4 }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/10 border border-violet-500/20"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Tag size={18} className="text-violet-500" />
                    <span className="text-xs font-medium text-violet-600">Your Topics</span>
                  </div>
                  <div className="text-3xl font-bold text-violet-600">
                    {rankedTopics.filter(t => t.source === 'user').length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">From your repos</div>
                </motion.div>
                
                <motion.div 
                  whileHover={{ y: -4 }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 to-yellow-500/10 border border-amber-500/20"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles size={18} className="text-amber-500" />
                    <span className="text-xs font-medium text-amber-600">Popular</span>
                  </div>
                  <div className="text-3xl font-bold text-amber-600">{popularTopics.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">To explore</div>
                </motion.div>
                
                <motion.div 
                  whileHover={{ y: -4 }}
                  className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Folder size={18} className="text-emerald-500" />
                    <span className="text-xs font-medium text-emerald-600">Total Repos</span>
                  </div>
                  <div className="text-3xl font-bold text-emerald-600">{repoQueries.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">Analyzed</div>
                </motion.div>
              </div>

              {/* Trending Topics Chart */}
              {trendingTopics.length > 0 && (
                <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={20} className="text-rose-500" />
                      <h2 className="text-lg font-semibold">Trending Topics</h2>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {trendingTopics.reduce((acc, t) => acc + t.count, 0)} repositories
                    </span>
                  </div>
                  
                  {/* Bar Chart */}
                  <div className="h-[200px] mb-6">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trendingTopics.slice(0, 10)} layout="vertical" margin={{ left: 80, right: 20, top: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                        <XAxis type="number" hide />
                        <YAxis 
                          dataKey="name" 
                          type="category" 
                          tick={{ fontSize: 11, fill: 'var(--foreground)' }}
                          width={70}
                        />
                        <RechartsTooltip 
                          cursor={{fill: 'var(--muted)'}}
                          contentStyle={{ 
                            backgroundColor: 'var(--background)', 
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            fontSize: '12px'
                          }}
                        />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                          {trendingTopics.slice(0, 10).map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={index < 3 ? '#f43f5e' : '#fb7185'} 
                              cursor="pointer"
                              onClick={() => setSelectedTopic(entry.name)}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Trending Tags */}
                  <div className="flex flex-wrap gap-2">
                    {trendingTopics.map(({ name, count }, index) => (
                      <motion.button
                        key={name}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setSelectedTopic(name)}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                          index < 3 
                            ? "bg-rose-500/15 border border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-500/25"
                            : "bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-300 hover:bg-rose-500/20"
                        )}
                      >
                        {index < 3 && <span className="text-rose-500">🔥</span>}
                        <span className={index < 3 ? "text-rose-500/80" : "text-rose-500/60"}>#</span>
                        {name}
                        <span className={cn(
                          "text-xs rounded-full px-1.5 py-0.5 ml-0.5",
                          index < 3 ? "bg-rose-500/20" : "bg-rose-500/10"
                        )}>
                          {count}
                        </span>
                      </motion.button>
                    ))}
                  </div>
                </section>
              )}

              {/* Featured Repos Section */}
              {trendingTopics.length > 0 && (
                <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <Folder size={20} className="text-blue-500" />
                    <h2 className="text-lg font-semibold">Featured Trending Repos</h2>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {trendingTopics.slice(0, 6).flatMap(topic => 
                      topic.repos.slice(0, 1).map(repo => {
                        const [owner, repoName] = repo.split("/");
                        return (
                          <motion.div
                            key={`${topic.name}-${repo}`}
                            whileHover={{ y: -2 }}
                            className="p-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => setSelectedTopic(topic.name)}
                          >
                            <div className="flex items-start gap-3">
                              <div className="p-2 rounded-lg bg-blue-500/10">
                                <Folder size={16} className="text-blue-500" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{owner}/{repoName}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="secondary" className="text-[10px] bg-rose-500/10 text-rose-600">
                                    #{topic.name}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">{topic.count} repos</span>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })
                    )}
                  </div>
                </section>
              )}

              {/* Popular Topics Grid */}
              <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles size={20} className="text-amber-500" />
                    <h2 className="text-lg font-semibold">Popular Topics to Explore</h2>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-violet-500" />
                      In your repos
                    </span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {popularTopics.map((topic) => {
                    const isUserTopic = rankedTopics.some(t => t.name === topic && t.count > 0);
                    const topicData = rankedTopics.find(t => t.name === topic);
                    return (
                      <motion.button
                        key={topic}
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setSelectedTopic(topic)}
                        className={cn(
                          "p-3 rounded-xl border text-left transition-all",
                          isUserTopic
                            ? "bg-violet-500/5 border-violet-500/20 hover:bg-violet-500/10 hover:border-violet-500/30"
                            : "bg-muted/30 border-border hover:bg-muted/50 hover:border-amber-500/20"
                        )}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={cn(
                            "text-xs",
                            isUserTopic ? "text-violet-500/70" : "text-muted-foreground/50"
                          )}>#</span>
                          <span className="text-sm font-medium truncate">{topic}</span>
                          {isUserTopic && (
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                          )}
                        </div>
                        {topicData && topicData.count > 0 ? (
                          <p className="text-xs text-violet-600">{topicData.count} repos</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Explore</p>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </section>

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-3">
                <Button 
                  variant="outline" 
                  className="gap-2"
                  onClick={() => {
                    setViewMode("cloud");
                    setSortMode("count");
                  }}
                >
                  <Cloud size={16} />
                  View Cloud
                </Button>
                <Button 
                  variant="outline" 
                  className="gap-2"
                  onClick={() => {
                    setViewMode("list");
                    setSortMode("trending");
                  }}
                >
                  <BarChart3 size={16} />
                  Trending List
                </Button>
                <Button 
                  variant="outline" 
                  className="gap-2"
                  onClick={exportTopics}
                >
                  <Download size={16} />
                  Export All
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Topic Detail Modal */}
        <Dialog open={!!selectedTopic} onOpenChange={() => setSelectedTopic(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <Badge 
                  variant="secondary" 
                  className="bg-violet-500/10 text-violet-700 dark:text-violet-300 text-lg px-3 py-1"
                >
                  #{selectedTopicData?.name}
                </Badge>
                <span className="text-sm font-normal text-muted-foreground">
                  {selectedTopicData?.count} repositories
                </span>
              </DialogTitle>
            </DialogHeader>
            
            <div className="flex-1 overflow-y-auto space-y-6 pr-2">
              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedTopicData && copyTopic(selectedTopicData.name)}
                  className="gap-2"
                >
                  {copiedTopic === selectedTopicData?.name ? (
                    <>
                      <Check size={14} className="text-emerald-500" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      Copy
                    </>
                  )}
                </Button>
                <a
                  href={`https://github.com/topics/${selectedTopicData?.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" size="sm" className="gap-2">
                    <ExternalLink size={14} />
                    View on GitHub
                  </Button>
                </a>
              </div>

              {/* Repos with this topic */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Folder size={16} className="text-violet-500" />
                  Repositories ({selectedTopicData?.repos.length})
                </h3>
                <div className="grid gap-2">
                  {selectedTopicData?.repos.map(repo => {
                    const [owner, repoName] = repo.split("/");
                    return (
                      <Link
                        key={repo}
                        href={`/dashboard/${owner}/${repoName}`}
                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted transition-colors group"
                      >
                        <MaterialIcon 
                          name="code" 
                          size={14} 
                          className="text-muted-foreground group-hover:text-violet-500" 
                        />
                        <span className="text-sm font-mono">
                          <span className="text-muted-foreground">{owner}/</span>
                          <span className="font-medium">{repoName}</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>

              {/* Related topics */}
              {selectedTopicData?.related && selectedTopicData.related.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Sparkles size={16} className="text-amber-500" />
                    Related Topics
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedTopicData.related.map(([topic, count]) => (
                      <button
                        key={topic}
                        onClick={() => setSelectedTopic(topic)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted hover:bg-violet-500/10 border border-border hover:border-violet-500/30 transition-all text-sm"
                      >
                        #{topic}
                        <span className="text-xs text-muted-foreground">({count})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
