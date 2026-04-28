"use client";

import { useState, useEffect, useCallback } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

interface PRInsight {
  number: number;
  title: string;
  author: string;
  url: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  waitDays: number;
  reviewers: string[];
  labels: Array<{ name: string; color: string }>;
  complexityScore: number;
  risk: "low" | "medium" | "high" | "critical";
  complexityFactors: string[];
  createdAt: string;
}

interface WorkContributor {
  login: string;
  commits: number;
  prs: number;
  share: number;
  lastCommit: string;
}

interface CycleTime {
  medianHours: number | null;
  avgHours: number | null;
  sampleSize: number;
  doraRating: "elite" | "high" | "medium" | "low" | "unknown";
}

interface InsightsData {
  repo: string;
  generatedAt: string;
  openPRs: PRInsight[];
  cycleTime: CycleTime;
  workDistribution: WorkContributor[];
  reviewerLoad: Array<{ login: string; pendingReviews: number }>;
  sizeBuckets: { xs: number; s: number; m: number; l: number; xl: number };
  summary: {
    openCount: number;
    criticalCount: number;
    highRiskCount: number;
    stalePRs: number;
    noReviewerCount: number;
    avgComplexity: number;
  };
}

interface EngineeringInsightsProps {
  selectedRepo: string | null;
  isDeveloper?: boolean;
}

const RISK_CONFIG = {
  critical: { bg: "bg-red-500/10 border-red-500/25", text: "text-red-400", badge: "bg-red-500/15 text-red-400 border-red-500/20", label: "CRITICAL" },
  high:     { bg: "bg-orange-500/10 border-orange-500/25", text: "text-orange-400", badge: "bg-orange-500/15 text-orange-400 border-orange-500/20", label: "HIGH" },
  medium:   { bg: "bg-amber-500/10 border-amber-500/25", text: "text-amber-400", badge: "bg-amber-500/15 text-amber-400 border-amber-500/20", label: "MEDIUM" },
  low:      { bg: "bg-surface-container/50 border-outline-variant/15", text: "text-muted-foreground/60", badge: "bg-surface-container text-muted-foreground border-outline-variant/15", label: "LOW" },
};

const DORA_CONFIG = {
  elite:   { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", label: "Elite", desc: "< 24 hrs" },
  high:    { color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20",    label: "High",  desc: "< 72 hrs" },
  medium:  { color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",  label: "Medium", desc: "< 1 week" },
  low:     { color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20",      label: "Low",   desc: "> 1 week" },
  unknown: { color: "text-muted-foreground/50", bg: "bg-surface-container/30 border-outline-variant/10", label: "Unknown", desc: "No data" },
};

function formatHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function ComplexityBar({ score, className }: { score: number; className?: string }) {
  const color = score >= 70 ? "bg-red-500" : score >= 45 ? "bg-orange-500" : score >= 20 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className={cn("h-1.5 rounded-full bg-surface-container-highest overflow-hidden", className)}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
    </div>
  );
}

export function EngineeringInsights({ selectedRepo, isDeveloper = false }: EngineeringInsightsProps) {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"prs" | "cycle" | "distribution">("prs");
  const [sortBy, setSortBy] = useState<"risk" | "age" | "size">("risk");

  const loadInsights = useCallback(async () => {
    if (!selectedRepo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/pr-insights?repo=${encodeURIComponent(selectedRepo)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json: InsightsData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, [selectedRepo]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  if (!selectedRepo) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <div className="size-14 rounded-none bg-amber-500/5 border border-amber-500/10 flex items-center justify-center">
          <MaterialIcon name="insights" size={24} className="text-amber-500/30" />
        </div>
        <p className="text-sm font-black text-foreground/50">Select a repository to view engineering insights</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <MaterialIcon name="sync" size={24} className="animate-spin text-amber-400" />
        <p className="text-sm text-muted-foreground/60">Loading engineering insights…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-none bg-red-500/8 border border-red-500/20">
        <MaterialIcon name="error" size={16} className="text-red-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-bold text-red-400">Failed to load insights</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">{error}</p>
          <button type="button" onClick={loadInsights} className="mt-2 text-xs font-bold text-amber-400 hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const sortedPRs = [...data.openPRs].sort((a, b) => {
    if (sortBy === "risk") return b.complexityScore - a.complexityScore;
    if (sortBy === "age") return b.waitDays - a.waitDays;
    return (b.additions + b.deletions) - (a.additions + a.deletions);
  });

  const doraConfig = DORA_CONFIG[data.cycleTime.doraRating];

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          { label: "Open PRs",      value: data.summary.openCount,      color: "text-foreground" },
          { label: "Critical Risk", value: data.summary.criticalCount,   color: data.summary.criticalCount > 0 ? "text-red-400" : "text-muted-foreground/40" },
          { label: "High Risk",     value: data.summary.highRiskCount,   color: data.summary.highRiskCount > 0 ? "text-orange-400" : "text-muted-foreground/40" },
          { label: "Stale (7d+)",   value: data.summary.stalePRs,        color: data.summary.stalePRs > 0 ? "text-amber-400" : "text-muted-foreground/40" },
          { label: "No Reviewer",   value: data.summary.noReviewerCount, color: data.summary.noReviewerCount > 0 ? "text-amber-400" : "text-muted-foreground/40" },
          { label: "Avg Complexity",value: `${data.summary.avgComplexity}`, color: data.summary.avgComplexity > 50 ? "text-orange-400" : "text-muted-foreground/70" },
        ].map((m) => (
          <div key={m.label} className="px-3 py-2.5 rounded-none bg-surface-container/30 border border-outline-variant/10 space-y-0.5">
            <p className={cn("text-lg font-black leading-none", m.color)}>{m.value}</p>
            <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">{m.label}</p>
          </div>
        ))}
      </div>

      {/* View selector */}
      <div className="flex gap-1 p-1 bg-surface-container/30 border border-outline-variant/10 w-fit">
        {[
          { id: "prs" as const,          icon: "merge_type",     label: "PR Queue" },
          { id: "cycle" as const,        icon: "timer",          label: "Cycle Time" },
          { id: "distribution" as const, icon: "group",          label: "Work Distribution" },
        ].map((v) => (
          <button key={v.id} type="button" onClick={() => setView(v.id)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all",
              view === v.id ? "bg-amber-500 text-white" : "text-muted-foreground/60 hover:text-foreground hover:bg-surface-container-highest")}>
            <MaterialIcon name={v.icon} size={12} />
            {v.label}
          </button>
        ))}
        <button type="button" onClick={loadInsights} className="ml-2 px-2 py-1.5 text-muted-foreground/40 hover:text-amber-400 transition-colors" aria-label="Refresh">
          <MaterialIcon name="refresh" size={14} />
        </button>
      </div>

      {/* ── PR Queue view ── */}
      {view === "prs" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Sort by:</span>
            {(["risk", "age", "size"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSortBy(s)}
                className={cn("text-[9px] font-black uppercase tracking-wider px-2 py-1 border transition-all",
                  sortBy === s ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-outline-variant/15 text-muted-foreground/40 hover:text-foreground")}>
                {s}
              </button>
            ))}
          </div>

          {sortedPRs.length === 0 && (
            <div className="py-12 text-center text-muted-foreground/40 text-sm border border-dashed border-outline-variant/15">
              No open pull requests — all clear!
            </div>
          )}

          <div className="space-y-2">
            {sortedPRs.map((pr) => {
              const rc = RISK_CONFIG[pr.risk];
              return (
                <div key={pr.number} className={cn("p-4 rounded-none border space-y-3", rc.bg)}>
                  <div className="flex items-start gap-3">
                    {/* Risk badge */}
                    <span className={cn("shrink-0 text-[8px] font-black px-2 py-0.5 border rounded-none mt-0.5", rc.badge)}>
                      {rc.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <a href={pr.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-black text-foreground hover:text-amber-400 transition-colors truncate">
                          #{pr.number} {pr.title}
                        </a>
                        {pr.draft && <span className="text-[8px] font-black px-1.5 py-0.5 bg-surface-container-highest border border-outline-variant/15 text-muted-foreground/40">DRAFT</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground/50">@{pr.author}</span>
                        <span className="text-[10px] text-muted-foreground/50">{pr.waitDays}d open</span>
                        <span className="text-[10px] text-emerald-400/70">+{pr.additions.toLocaleString()}</span>
                        <span className="text-[10px] text-red-400/70">-{pr.deletions.toLocaleString()}</span>
                        <span className="text-[10px] text-muted-foreground/50">{pr.changedFiles} files</span>
                        {pr.reviewers.length > 0 && (
                          <span className="text-[10px] text-muted-foreground/50">👁 {pr.reviewers.join(", ")}</span>
                        )}
                        {pr.reviewers.length === 0 && (
                          <span className="text-[10px] text-amber-400/70 font-bold">⚠ No reviewer</span>
                        )}
                      </div>
                      {pr.complexityFactors.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {pr.complexityFactors.map((f) => (
                            <span key={f} className="text-[8px] font-mono px-1.5 py-0.5 bg-surface-container border border-outline-variant/10 text-muted-foreground/50">{f}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn("text-lg font-black", rc.text)}>{pr.complexityScore}</p>
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/30">complexity</p>
                      <ComplexityBar score={pr.complexityScore} className="w-16 mt-1" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* PR size distribution */}
          {data.openPRs.length > 0 && (
            <div className="p-4 rounded-none border border-outline-variant/10 bg-surface-container/20 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">PR Size Distribution</p>
              <div className="flex items-end gap-2 h-12">
                {Object.entries(data.sizeBuckets).map(([size, count]) => {
                  const max = Math.max(...Object.values(data.sizeBuckets), 1);
                  const pct = (count / max) * 100;
                  const colors = { xs: "bg-emerald-500", s: "bg-emerald-400", m: "bg-amber-400", l: "bg-orange-400", xl: "bg-red-500" };
                  return (
                    <div key={size} className="flex flex-col items-center gap-1 flex-1">
                      <div className="w-full flex items-end justify-center">
                        <div className={cn("w-full max-w-8 rounded-sm", colors[size as keyof typeof colors])} style={{ height: `${Math.max(4, pct * 0.4)}px` }} />
                      </div>
                      <p className="text-[8px] font-black text-muted-foreground/50 uppercase">{size}</p>
                      <p className="text-[9px] font-bold text-muted-foreground/60">{count}</p>
                    </div>
                  );
                })}
              </div>
              <p className="text-[8px] text-muted-foreground/30">XS ≤10 lines · S ≤50 · M ≤250 · L ≤1000 · XL 1000+</p>
            </div>
          )}
        </div>
      )}

      {/* ── Cycle Time view ── */}
      {view === "cycle" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={cn("p-4 rounded-none border space-y-1", doraConfig.bg)}>
              <p className={cn("text-2xl font-black", doraConfig.color)}>{formatHours(data.cycleTime.medianHours)}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Median Cycle Time</p>
              <p className="text-[9px] text-muted-foreground/40">{data.cycleTime.sampleSize} PRs sampled</p>
            </div>
            <div className="p-4 rounded-none border border-outline-variant/10 bg-surface-container/30 space-y-1">
              <p className="text-2xl font-black text-foreground">{formatHours(data.cycleTime.avgHours)}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Average Cycle Time</p>
            </div>
            <div className={cn("p-4 rounded-none border space-y-1", doraConfig.bg)}>
              <p className={cn("text-2xl font-black", doraConfig.color)}>{doraConfig.label}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">DORA Lead Time Band</p>
              <p className="text-[9px] text-muted-foreground/40">{doraConfig.desc}</p>
            </div>
          </div>

          <div className="p-4 rounded-none border border-outline-variant/10 bg-surface-container/20 space-y-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">DORA Lead Time for Changes — Benchmarks</p>
            <div className="space-y-2">
              {[
                { band: "Elite",  range: "< 1 hour",   color: "bg-emerald-500", pct: 25 },
                { band: "High",   range: "< 1 day",    color: "bg-blue-500",    pct: 50 },
                { band: "Medium", range: "< 1 week",   color: "bg-amber-500",   pct: 75 },
                { band: "Low",    range: "> 1 week",   color: "bg-red-500",     pct: 100 },
              ].map((b) => (
                <div key={b.band} className="flex items-center gap-3">
                  <span className="text-[9px] font-black w-12 text-muted-foreground/50">{b.band}</span>
                  <div className="flex-1 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", b.color)} style={{ width: `${b.pct}%` }} />
                  </div>
                  <span className="text-[9px] text-muted-foreground/40 w-16 text-right">{b.range}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-outline-variant/10">
              <p className="text-[10px] text-muted-foreground/50">
                Your median: <span className={cn("font-bold", doraConfig.color)}>{formatHours(data.cycleTime.medianHours)}</span>
                {" "}— {doraConfig.label} performer
              </p>
            </div>
          </div>

          {/* Reviewer load */}
          {data.reviewerLoad.length > 0 && (
            <div className="p-4 rounded-none border border-outline-variant/10 bg-surface-container/20 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Reviewer Queue Load</p>
              <div className="space-y-2">
                {data.reviewerLoad.slice(0, 8).map((r) => (
                  <div key={r.login} className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-muted-foreground/60 w-24 truncate">@{r.login}</span>
                    <div className="flex-1 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full", r.pendingReviews >= 5 ? "bg-red-500" : r.pendingReviews >= 3 ? "bg-amber-500" : "bg-emerald-500")}
                        style={{ width: `${Math.min(100, r.pendingReviews * 15)}%` }} />
                    </div>
                    <span className="text-[9px] font-bold text-muted-foreground/50 w-8 text-right">{r.pendingReviews}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Work Distribution view ── */}
      {view === "distribution" && (
        <div className="space-y-4">
          {data.workDistribution.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground/40 text-sm border border-dashed border-outline-variant/15">
              No commit data available for the last 90 days.
            </div>
          ) : (
            <>
              <div className="p-4 rounded-none border border-outline-variant/10 bg-surface-container/20 space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Commit Share — Last 90 Days</p>
                {/* Stacked bar */}
                <div className="flex h-4 rounded-none overflow-hidden gap-px">
                  {data.workDistribution.slice(0, 10).map((c, i) => {
                    const colors = ["bg-amber-500","bg-rose-500","bg-violet-500","bg-emerald-500","bg-blue-500","bg-orange-400","bg-teal-500","bg-pink-500","bg-indigo-400","bg-yellow-500"];
                    return <div key={c.login} title={`${c.login}: ${c.share}%`} className={colors[i % colors.length]} style={{ width: `${c.share}%` }} />;
                  })}
                </div>
              </div>

              <div className="space-y-2">
                {data.workDistribution.map((c, i) => {
                  const colors = ["text-amber-400","text-rose-400","text-violet-400","text-emerald-400","text-blue-400","text-orange-400","text-teal-400","text-pink-400","text-indigo-400","text-yellow-400"];
                  const busRisk = c.share > 40 ? "text-red-400" : c.share > 25 ? "text-amber-400" : "text-muted-foreground/40";
                  return (
                    <div key={c.login} className="flex items-center gap-3 px-3 py-2.5 rounded-none border border-outline-variant/10 bg-surface-container/20">
                      <span className="text-[10px] font-black w-5 text-center text-muted-foreground/30">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[10px] font-black", colors[i % colors.length])}>@{c.login}</span>
                          {c.share > 40 && <span className="text-[8px] font-black px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20">BUS FACTOR RISK</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-[9px] text-muted-foreground/40">{c.commits} commits</span>
                          <span className="text-[9px] text-muted-foreground/40">{c.prs} PRs</span>
                          {c.lastCommit && <span className="text-[9px] text-muted-foreground/30">last: {new Date(c.lastCommit).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn("text-base font-black", busRisk)}>{c.share}%</p>
                        <div className="w-20 h-1 bg-surface-container-highest rounded-full overflow-hidden mt-1">
                          <div className={cn("h-full rounded-full", colors[i % colors.length].replace("text-", "bg-"))} style={{ width: `${c.share}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 rounded-none border border-amber-500/10 bg-amber-500/5 text-[10px] text-muted-foreground/50 leading-relaxed">
                <span className="font-bold text-amber-400">Bus factor risk:</span> Any contributor with &gt;40% of commits represents a single point of failure. Cross-train team members on these areas.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
