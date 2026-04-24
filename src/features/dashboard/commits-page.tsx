"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts/es6";
import { format } from "date-fns";
import Image from "next/image";
import { GitCommit, User, X, FileCode, Plus, Minus, ChevronRight, Menu, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Commit = {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  author: {
    avatar_url: string;
    login: string;
  } | null;
  html_url: string;
};

type CommitFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
};

type CommitDetail = Commit & {
  files: CommitFile[];
  stats: {
    total: number;
    additions: number;
    deletions: number;
  };
};

export function CommitsPage({ owner, repo }: { owner: string; repo: string }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "6m" | "1y">("30d");
  const [page, setPage] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<CommitDetail | null>(null);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitDetailLoading, setCommitDetailLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<CommitFile | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const PER_PAGE = 20;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function fetchCommits() {
      setLoading(true);
      try {
        const sinceDate = new Date();
        if (range === "7d") sinceDate.setDate(sinceDate.getDate() - 7);
        else if (range === "30d") sinceDate.setDate(sinceDate.getDate() - 30);
        else if (range === "90d") sinceDate.setDate(sinceDate.getDate() - 90);
        else if (range === "6m") sinceDate.setMonth(sinceDate.getMonth() - 6);
        else if (range === "1y") sinceDate.setFullYear(sinceDate.getFullYear() - 1);

        const res = await fetch(
          `/api/github/repos/${owner}/${repo}/commits?per_page=100&since=${sinceDate.toISOString()}`
        );
        const data = await res.json();
        setCommits(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchCommits();
  }, [owner, repo, range]);

  // Analytics Calculations
  const totalCommits = commits.length;
  const uniqueAuthors = new Set(commits.map(c => c.author?.login || c.commit.author.name)).size;
  
  // Weekly distribution for momentum chart
  const chartData = [...commits].reverse().map((c, i) => ({
    name: i + 1,
    date: format(new Date(c.commit.author.date), "MMM d"),
    msg: c.commit.message.split("\n")[0],
  }));

  // Compute Top Committers
  const committerCounts = commits.reduce((acc, c) => {
    const name = c.author?.login || c.commit.author.name;
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const committerData = Object.entries(committerCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  async function handleCommitClick(commit: Commit) {
    setCommitModalOpen(true);
    setCommitDetailLoading(true);
    try {
      const res = await fetch(
        `/api/github/repos/${owner}/${repo}/commits/${commit.sha}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelectedCommit(data as CommitDetail);
    } catch (e) {
      console.error("Failed to fetch commit details:", e);
    } finally {
      setCommitDetailLoading(false);
    }
  }

  function closeCommitModal() {
    setCommitModalOpen(false);
    setSidebarOpen(false);
    setTimeout(() => {
      setSelectedCommit(null);
      setSelectedFile(null);
    }, 200);
  }

  if (loading || !mounted) {
    return (
      <div className="space-y-6">
        <div className="h-[200px] w-full rounded-none border border-outline-variant/10 overflow-hidden">
           <Skeleton className="h-full w-full" />
        </div>
        <div className="h-24 w-full rounded-none border border-outline-variant/10 overflow-hidden">
           <Skeleton className="h-full w-full" />
        </div>
        <div className="h-96 w-full rounded-none border border-outline-variant/10 overflow-hidden">
           <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-xl font-bold text-foreground">
          Commit Analytics
        </h2>
        <div className="flex items-center gap-1 rounded-none bg-surface-container p-1 ring-1 ring-white/10">
          {(["7d", "30d", "90d", "6m", "1y"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { setRange(r); setPage(0); }}
              className={cn(
                "rounded-none px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all",
                range === r
                  ? "bg-primary text-white shadow-lg"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Total Volume", value: totalCommits, icon: GitCommit, color: "text-primary" },
          { label: "Active Authors", value: uniqueAuthors, icon: User, color: "text-emerald-400" },
          { label: "Range Duration", value: range.toUpperCase(), icon: GitCommit, color: "text-tertiary" },
        ].map((s) => (
          <Card key={s.label} className="bg-surface-container border-none shadow-sm dark:shadow-none">
            <CardContent className="flex items-center gap-4 p-4">
              <div className={cn("flex size-10 items-center justify-center rounded-none bg-white/5", s.color)}>
                <s.icon className="size-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {s.label}
                </p>
                <p className="font-heading text-xl font-bold text-foreground">
                  {s.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Commit Activity Momentum Area Chart */}
        <Card className="bg-surface-container border-none shadow-sm dark:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="font-heading flex items-center gap-2 text-lg">
              <GitCommit className="size-5 text-primary" />
              Momentum
            </CardTitle>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Commit depth for selected range
            </p>
          </CardHeader>
          <CardContent className="h-[200px] pt-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="commitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fontSize: 10 }} 
                  stroke="var(--muted-foreground)"
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    background: "var(--surface-container-high)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                    color: "var(--foreground)",
                  }}
                  itemStyle={{ color: "var(--foreground)" }}
                />
                <Area
                  type="monotone"
                  dataKey="name"
                  stroke="var(--primary)"
                  fill="url(#commitGrad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Committers Bar Chart */}
        <Card className="bg-surface-container border-none shadow-sm dark:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="font-heading flex items-center gap-2 text-lg">
              <User className="size-5 text-emerald-400" />
              Contributors
            </CardTitle>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Volume distribution by author
            </p>
          </CardHeader>
          <CardContent className="h-[200px] pt-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={committerData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  width={80} 
                  tick={{ fontSize: 9 }} 
                  stroke="var(--muted-foreground)" 
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    background: "var(--surface-container-high)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                    color: "var(--foreground)",
                  }}
                  itemStyle={{ color: "var(--foreground)" }}
                />
                <Area
                  type="step"
                  dataKey="count"
                  stroke="var(--tertiary)"
                  fill="var(--tertiary)"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Commit List with Pagination */}
      <Card className="bg-surface-container border-none shadow-sm dark:shadow-none">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-heading text-lg">
            Commit History
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({commits.length} total)
            </span>
          </CardTitle>
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
            Page {page + 1} / {Math.max(1, Math.ceil(commits.length / PER_PAGE))}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-white/4">
            {commits.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map((c) => (
              <button
                key={c.sha}
                onClick={() => handleCommitClick(c)}
                className="group flex w-full cursor-pointer flex-col gap-2 p-4 text-left transition-all hover:bg-primary/5 active:bg-primary/10 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex shrink-0 items-center gap-3">
                  {c.author?.avatar_url ? (
                    <Image
                      src={c.author.avatar_url}
                      width={32}
                      height={32}
                      alt={c.author.login}
                      className="size-8 rounded-full ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="flex size-8 items-center justify-center rounded-full bg-surface-container-high text-muted-foreground ring-1 ring-white/10">
                      <User className="size-4" />
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold tracking-tight text-foreground">
                      {c.author?.login || c.commit.author.name}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {format(new Date(c.commit.author.date), "MMM d, yyyy")}
                    </span>
                  </div>
                </div>

                <div className="flex-1 overflow-hidden">
                  <p className="line-clamp-1 text-sm font-medium text-foreground/90 leading-snug">
                    {c.commit.message.split("\n")[0]}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {c.sha.substring(0, 7)}
                  </p>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground">
                  <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            ))}
          </div>

          {/* Pagination controls */}
          {commits.length > PER_PAGE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/4">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-4 py-1.5 rounded-none border border-white/8 text-xs font-bold disabled:opacity-30 hover:bg-white/5 transition-colors"
              >
                ← Previous
              </button>
              <span className="font-mono text-[10px] text-muted-foreground">
                Showing {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, commits.length)} of {commits.length}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(Math.ceil(commits.length / PER_PAGE) - 1, p + 1))}
                disabled={(page + 1) * PER_PAGE >= commits.length}
                className="px-4 py-1.5 rounded-none border border-white/8 text-xs font-bold disabled:opacity-30 hover:bg-white/5 transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Commit Detail Modal - Responsive with Collapsible Sidebar */}
      <Dialog open={commitModalOpen} onOpenChange={(open) => !open && closeCommitModal()}>
        <DialogContent showCloseButton={false} className="w-[98vw] h-[95vh] sm:h-[90vh] p-0 gap-0 bg-background border border-border shadow-2xl rounded-none overflow-hidden flex flex-col">
          
          {/* Header */}
          <DialogHeader className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border flex-shrink-0 bg-surface-container">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                {/* Mobile sidebar toggle */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden shrink-0"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                >
                  {sidebarOpen ? <ChevronLeft className="size-5" /> : <Menu className="size-5" />}
                </Button>
                <DialogTitle className="font-heading text-sm sm:text-base flex items-center gap-2 m-0 shrink-0">
                  <GitCommit className="size-4 sm:size-5 text-primary" />
                  <span className="hidden sm:inline">Commit</span>
                </DialogTitle>
                {selectedCommit && (
                  <code className="text-xs text-muted-foreground font-mono truncate">
                    {selectedCommit.sha.substring(0, 7)}
                  </code>
                )}
              </div>
              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                {selectedCommit && (
                  <a
                    href={selectedCommit.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-none text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
                  >
                    <svg className="size-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    <span className="hidden md:inline">View on GitHub</span>
                  </a>
                )}
                <button
                  onClick={closeCommitModal}
                  className="flex size-8 items-center justify-center rounded-none text-muted-foreground hover:text-foreground hover:bg-surface-container-high transition-colors"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>
          </DialogHeader>

          {/* Content Area */}
          <div className="flex-1 flex overflow-hidden relative">
            {commitDetailLoading ? (
              <div className="flex-1 p-4 sm:p-8 space-y-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : selectedCommit ? (
              <>
                {/* File Sidebar - Collapsible on mobile */}
                <div className={cn(
                  "absolute lg:relative z-20 h-full flex-shrink-0 border-r border-border flex flex-col bg-surface-container-low transition-transform duration-300 ease-in-out",
                  "w-[85vw] sm:w-80",
                  sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
                )}>
                  {/* Commit Info */}
                  <div className="p-3 sm:p-4 border-b border-border bg-surface-container">
                    <div className="flex items-start gap-2 sm:gap-3 mb-3">
                      {selectedCommit.author?.avatar_url ? (
                        <Image
                          src={selectedCommit.author.avatar_url}
                          width={36}
                          height={36}
                          alt={selectedCommit.author.login}
                          className="size-8 sm:size-9 rounded-full ring-1 ring-white/10"
                        />
                      ) : (
                        <div className="flex size-8 sm:size-9 items-center justify-center rounded-full bg-surface-container-high text-muted-foreground ring-1 ring-border">
                          <User className="size-4" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {selectedCommit.author?.login || selectedCommit.commit.author.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(selectedCommit.commit.author.date), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-3">
                      {selectedCommit.commit.message}
                    </p>
                  </div>

                  {/* Stats Summary */}
                  {selectedCommit.stats && (
                    <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-border flex items-center gap-2 sm:gap-4 text-xs bg-surface-container/50">
                      <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <Plus className="size-3" />
                        <span className="font-semibold">{selectedCommit.stats.additions}</span>
                      </div>
                      <div className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
                        <Minus className="size-3" />
                        <span className="font-semibold">{selectedCommit.stats.deletions}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground ml-auto">
                        <FileCode className="size-3.5" />
                        <span>{selectedCommit.files?.length || 0} files</span>
                      </div>
                    </div>
                  )}

                  {/* File List */}
                  <div className="flex-1 overflow-y-auto scrollbar-hide">
                    <div className="py-2">
                      <p className="px-3 sm:px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Changed Files
                      </p>
                      {selectedCommit.files?.map((file, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setSelectedFile(file);
                            setSidebarOpen(false);
                          }}
                          className={cn(
                            "w-full px-3 sm:px-4 py-2 text-left text-xs transition-colors flex items-center gap-2",
                            selectedFile?.filename === file.filename
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-surface-container-high"
                          )}
                        >
                          <span className={cn(
                            "size-2 rounded-full flex-shrink-0",
                            file.status === "added" && "bg-emerald-400",
                            file.status === "removed" && "bg-rose-400",
                            file.status === "modified" && "bg-amber-400",
                            file.status === "renamed" && "bg-amber-400"
                          )} />
                          <span className="flex-1 truncate font-mono text-[10px] sm:text-xs">{file.filename}</span>
                          <span className="flex items-center gap-1 flex-shrink-0">
                            {file.additions > 0 && (
                              <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">+{file.additions}</span>
                            )}
                            {file.deletions > 0 && (
                              <span className="text-rose-600 dark:text-rose-400 text-[10px]">-{file.deletions}</span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Overlay for mobile when sidebar is open */}
                {sidebarOpen && (
                  <div 
                    className="absolute inset-0 bg-black/20 z-10 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                  />
                )}

                {/* Diff Viewer */}
                <div className="flex-1 overflow-y-auto scrollbar-hide bg-surface-container-low dark:bg-black/20">
                  {/* Mobile file selector when no file selected */}
                  {!selectedFile && (
                    <div className="lg:hidden h-full flex flex-col items-center justify-center text-muted-foreground p-6">
                      <FileCode className="size-12 mb-4 opacity-20" />
                      <p className="text-sm mb-4">Select a file to view changes</p>
                      <Button variant="outline" onClick={() => setSidebarOpen(true)}>
                        <Menu className="size-4 mr-2" />
                        View Files
                      </Button>
                    </div>
                  )}
                  
                  {selectedFile ? (
                    <div className="min-h-full">
                      {/* File Header */}
                      <div className="sticky top-0 z-10 px-3 sm:px-4 py-2 sm:py-3 bg-surface-container border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="lg:hidden shrink-0"
                            onClick={() => setSelectedFile(null)}
                          >
                            <ChevronLeft className="size-4" />
                          </Button>
                          <code className="text-xs sm:text-sm font-mono text-foreground truncate">{selectedFile.filename}</code>
                          {selectedFile.previous_filename && selectedFile.previous_filename !== selectedFile.filename && (
                            <span className="hidden sm:inline text-xs text-muted-foreground">
                              ← {selectedFile.previous_filename}
                            </span>
                          )}
                        </div>
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-medium uppercase shrink-0",
                          selectedFile.status === "added" && "bg-emerald-500/20 text-emerald-400",
                          selectedFile.status === "removed" && "bg-rose-500/20 text-rose-400",
                          selectedFile.status === "modified" && "bg-amber-500/20 text-amber-400",
                          selectedFile.status === "renamed" && "bg-amber-500/20 text-amber-400"
                        )}>
                          {selectedFile.status}
                        </span>
                      </div>

                      {/* File Stats */}
                      <div className="px-3 sm:px-4 py-2 border-b border-border flex items-center gap-4 text-xs text-muted-foreground bg-surface-container/50">
                        <span>{selectedFile.additions} additions</span>
                        <span>{selectedFile.deletions} deletions</span>
                        <span className="hidden sm:inline">{selectedFile.changes} changes</span>
                      </div>

                      {/* Diff Content */}
                      {selectedFile.patch ? (
                        <div className="overflow-x-auto">
                          <pre className="text-xs font-mono leading-relaxed">
                            <code>
                              {selectedFile.patch.split('\n').map((line, lineIdx) => {
                                const isAddition = line.startsWith('+') && !line.startsWith('+++');
                                const isDeletion = line.startsWith('-') && !line.startsWith('---');
                                const isHunk = line.startsWith('@@');
                                const isNoNewline = line.includes('\\ No newline at end of file');
                                return (
                                  <div
                                    key={lineIdx}
                                    className={cn(
                                      "flex",
                                      isAddition && "bg-emerald-50 dark:bg-emerald-950/30 border-l-4 border-l-emerald-600",
                                      isDeletion && "bg-rose-50 dark:bg-rose-950/30 border-l-4 border-l-rose-600",
                                      isHunk && "bg-amber-50 dark:bg-amber-950/30 border-l-4 border-l-amber-600",
                                      !isHunk && !isAddition && !isDeletion && "hover:bg-surface-container-high"
                                    )}
                                  >
                                    <span className={cn(
                                      "w-8 sm:w-12 flex-shrink-0 text-right pr-2 sm:pr-3 select-none border-r border-border font-mono text-[10px] sm:text-xs py-1",
                                      isHunk && "text-amber-600 dark:text-amber-400",
                                      isAddition && "text-emerald-600 dark:text-emerald-400 font-bold",
                                      isDeletion && "text-rose-600 dark:text-rose-400 font-bold",
                                      !isHunk && !isAddition && !isDeletion && "text-muted-foreground"
                                    )}>
                                      {isHunk ? '⚡' : isAddition ? '▶' : isDeletion ? '◀' : lineIdx + 1}
                                    </span>
                                    <span className={cn(
                                      "flex-1 pl-2 sm:pl-3 whitespace-pre font-mono text-[10px] sm:text-xs py-1",
                                      isAddition && "text-emerald-900 dark:text-emerald-200",
                                      isDeletion && "text-rose-900 dark:text-rose-200 line-through decoration-rose-500",
                                      isHunk && "text-amber-900 dark:text-amber-200 font-bold",
                                      isNoNewline && "text-muted-foreground italic"
                                    )}>
                                      {isAddition ? `+ ${line.substring(1)}` : isDeletion ? `- ${line.substring(1)}` : line}
                                    </span>
                                  </div>
                                );
                              })}
                            </code>
                          </pre>
                        </div>
                      ) : (
                        <div className="p-4 sm:p-8 text-center text-muted-foreground text-sm">
                          {selectedFile.status === "added" && "File was added"}
                          {selectedFile.status === "removed" && "File was deleted"}
                          {selectedFile.status === "renamed" && "File was renamed"}
                          {selectedFile.status === "modified" && "Binary file or diff too large"}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="hidden lg:flex h-full items-center justify-center text-muted-foreground">
                      <p className="text-sm">Select a file to view changes</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <p>Failed to load commit details</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
