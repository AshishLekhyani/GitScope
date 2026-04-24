"use client";

import { useState, useEffect } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import Image from "next/image";
import type { DeepImpactResult } from "@/lib/ai";

interface ScoredPR {
  id: number;
  number: number;
  title: string;
  user: string;
  avatar: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  riskScore: number;
  riskLevel: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "STABLE";
  headline: string;
  analysis: string;
  flags: string[];
  hotFiles: string[];
}

type ScanState = "idle" | "scanning" | "done" | "error";
interface DeepImpactWithMeta extends DeepImpactResult {
  meta?: {
    plan?: string;
    tokenSource?: string;
    rateRemaining?: number;
    maxFilesAnalyzed?: number;
    githubCalls?: number;
  };
}
interface PRScanData { state: ScanState; result?: DeepImpactWithMeta; error?: string }
interface PRRiskMeta {
  plan?: string;
  aiMode?: "heuristic" | "single-pass" | "multi-agent";
  tokenSource?: string;
  prLimit?: number;
}

const FLAG_META: Record<string, { label: string; color: string }> = {
  security:        { label: "Security",       color: "bg-red-500/10 text-red-400 border-red-500/20" },
  "breaking-change":{ label: "Breaking",      color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  performance:     { label: "Performance",    color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  deps:            { label: "Dependencies",   color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  "high-churn":    { label: "High Churn",     color: "bg-amber-500/10 text-amber-400 border-pink-500/20" },
  auth:            { label: "Auth",           color: "bg-red-500/10 text-red-400 border-red-500/20" },
  database:        { label: "Database",       color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  "api-contract":  { label: "API Contract",   color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  "large-diff":    { label: "Large Diff",     color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  "test-coverage": { label: "Test Coverage",  color: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
  config:          { label: "Config",         color: "bg-stone-500/10 text-stone-400 border-stone-500/20" },
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-500/10 border-red-500/20 text-red-400",
  high:     "bg-orange-500/10 border-orange-500/20 text-orange-400",
  medium:   "bg-amber-500/10 border-amber-500/20 text-amber-400",
  low:      "bg-surface-container/50 border-outline-variant/10 text-muted-foreground",
};

const SEVERITY_ICON: Record<string, string> = {
  critical: "emergency_home", high: "error", medium: "warning", low: "info",
};

const CATEGORY_ICON: Record<string, string> = {
  security: "lock", performance: "speed", logic: "psychology", maintainability: "build",
  breaking: "warning_amber", testing: "science", config: "settings",
};

function DimensionBar({ label, score, color }: { label: string; score: number; color: string }) {
  const width = `${score}%`;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
        <span className="text-muted-foreground/60">{label}</span>
        <span className={color}>{score}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-container-highest overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-700", color.replace("text-", "bg-"))} style={{ width }} />
      </div>
    </div>
  );
}

export function RiskPredictor({ repo }: { repo: string }) {
  const [prs, setPrs] = useState<ScoredPR[]>([]);
  const [loading, setLoading] = useState(false);
  const [scans, setScans] = useState<Record<number, PRScanData>>({});
  const [expandedPR, setExpandedPR] = useState<number | null>(null);
  const [meta, setMeta] = useState<PRRiskMeta | null>(null);

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const pollDeepScanJob = async (jobId: string): Promise<DeepImpactWithMeta> => {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const res = await fetch(`/api/user/ai-jobs/${jobId}`, { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to fetch analysis job status");
      }

      const job = payload.job as { status: string; result?: DeepImpactWithMeta; error?: string };
      if (job.status === "completed" && job.result) {
        return job.result;
      }
      if (job.status === "failed" || job.status === "canceled") {
        throw new Error(job.error ?? "Deep scan job failed");
      }

      await wait(1200);
    }

    throw new Error("Deep scan timed out. Please retry.");
  };

  useEffect(() => {
    if (!repo) return;
    setLoading(true);
    setPrs([]);
    setMeta(null);
    fetch(`/api/user/pr-risk?repo=${encodeURIComponent(repo)}`)
      .then(async (r) => {
        const text = await r.text();
        // Try to parse as JSON, fallback to empty if HTML/error
        try {
          const data = JSON.parse(text);
          if (!r.ok) {
            console.error("PR Risk API error:", data.error || r.status);
            return { items: [], meta: null };
          }
          return data;
        } catch (parseErr) {
          // Response was HTML (likely error page)
          console.error("PR Risk API returned non-JSON:", text.substring(0, 100));
          return { items: [], meta: null };
        }
      })
      .then((payload: { items?: ScoredPR[]; meta?: PRRiskMeta }) => {
        setPrs(payload.items ?? []);
        setMeta(payload.meta ?? null);
      })
      .catch((err) => {
        console.error("PR Risk fetch error:", err);
      })
      .finally(() => setLoading(false));
  }, [repo]);

  const runDeepScan = async (pr: ScoredPR) => {
    if (scans[pr.number]?.state === "scanning") return;
    setScans((s) => ({ ...s, [pr.number]: { state: "scanning" } }));
    setExpandedPR(pr.number);
    try {
      const createRes = await fetch("/api/user/ai-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "deep-impact",
          repo,
          prNumber: pr.number,
        }),
      });
      const createPayload = await createRes.json();
      if (!createRes.ok) throw new Error(createPayload.error ?? "Could not queue deep scan");

      const jobId = createPayload.job?.id as string | undefined;
      if (!jobId) throw new Error("Invalid deep scan job response");

      const result = await pollDeepScanJob(jobId);
      setScans((s) => ({ ...s, [pr.number]: { state: "done", result } }));
    } catch (e) {
      setScans((s) => ({
        ...s, [pr.number]: { state: "error", error: e instanceof Error ? e.message : "Scan failed" },
      }));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 animate-pulse">
        <MaterialIcon name="security" size={48} className="text-amber-500/20" />
        <p className="text-xs font-bold text-muted-foreground/40 uppercase tracking-widest">
          Running AI risk analysis…
        </p>
      </div>
    );
  }

  if (prs.length === 0) {
    return (
      <div className="py-24 text-center bg-surface-container/20 rounded-none border border-dashed border-outline-variant/20">
        <MaterialIcon name="verified" size={48} className="text-emerald-500/10 mb-4" />
        <h4 className="text-xl font-bold">No Open Pull Requests</h4>
        <p className="text-sm text-muted-foreground/60 mt-2">
          All PRs are merged or this repository has no open work.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 px-2 flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
          AI Risk Vectors
        </h4>
        <div className="flex items-center gap-2">
          {meta?.aiMode && (
            <span className="text-[10px] font-black text-amber-500 uppercase px-3 py-1 rounded-full bg-amber-500/5 border border-amber-500/10">
              {meta.aiMode === "multi-agent" ? "Multi-Agent" : meta.aiMode === "single-pass" ? "Single Agent" : "Heuristic"}
            </span>
          )}
          <span className="text-[10px] font-black text-amber-500 uppercase px-3 py-1 rounded-full bg-amber-500/5 border border-amber-500/10">
            {prs.length} Open PR{prs.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="space-y-6">
        {prs.map((pr) => {
          const scan = scans[pr.number];
          const isExpanded = expandedPR === pr.number;
          const borderColor =
            pr.riskLevel === "CRITICAL" || pr.riskLevel === "HIGH"
              ? "border-red-500/20 bg-red-500/5"
              : pr.riskLevel === "MODERATE"
                ? "border-amber-500/20 bg-amber-500/5"
                : "border-outline-variant/10 bg-surface-container/30";
          const scoreColor =
            pr.riskLevel === "CRITICAL" || pr.riskLevel === "HIGH"
              ? "text-red-500"
              : pr.riskLevel === "MODERATE"
                ? "text-amber-500"
                : "text-emerald-500";

          return (
            <div key={pr.id} className={cn("rounded-none border transition-all", borderColor)}>
              {/* ── Card header ── */}
              <div className="p-6 space-y-5">
                {/* Author + score row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <Image src={pr.avatar} width={40} height={40} className="size-10 sm:size-11 rounded-none shadow-xl" alt="" />
                      <div className={cn(
                        "absolute -bottom-1 -right-1 size-5 rounded-none flex items-center justify-center border-2 border-background",
                        pr.riskLevel === "CRITICAL" || pr.riskLevel === "HIGH" ? "bg-red-500" :
                        pr.riskLevel === "MODERATE" ? "bg-amber-500" : "bg-emerald-500"
                      )}>
                        <MaterialIcon
                          name={pr.riskLevel === "CRITICAL" || pr.riskLevel === "HIGH" ? "error" : pr.riskLevel === "MODERATE" ? "warning" : "check"}
                          size={10} className="text-white sm:size-[12px]"
                        />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-black tracking-tight truncate">{pr.title}</div>
                      <div className="text-[9px] sm:text-[10px] font-bold text-muted-foreground/60 uppercase mt-0.5">
                        PR #{pr.number} · {pr.user}
                      </div>
                    </div>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-0 shrink-0">
                    <div className={cn("text-2xl sm:text-3xl font-black italic tabular-nums", scoreColor)}>{pr.riskScore}</div>
                    <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40 sm:mt-0.5">Risk Index</div>
                  </div>
                </div>

                {/* Headline */}
                {pr.headline && (
                  <div className="text-sm font-bold text-foreground/90 leading-snug">{pr.headline}</div>
                )}

                {/* Stat row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 py-3 border-y border-outline-variant/10">
                  <div className="text-center">
                    <div className="text-sm font-black text-emerald-500">+{pr.additions}</div>
                    <div className="text-[7px] sm:text-[8px] font-black text-muted-foreground uppercase tracking-widest mt-0.5">Added</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-black text-red-500">-{pr.deletions}</div>
                    <div className="text-[7px] sm:text-[8px] font-black text-muted-foreground uppercase tracking-widest mt-0.5">Removed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-black text-amber-500">{pr.changedFiles}</div>
                    <div className="text-[7px] sm:text-[8px] font-black text-muted-foreground uppercase tracking-widest mt-0.5">Files</div>
                  </div>
                </div>

                {/* Flags */}
                {pr.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pr.flags.map((f) => {
                      const meta = FLAG_META[f] ?? { label: f, color: "bg-muted text-muted-foreground border-outline-variant/20" };
                      return (
                        <span key={f} className={cn("text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-wider", meta.color)}>
                          {meta.label}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* AI analysis */}
                <div className="space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                    <MaterialIcon name="psychology" size={13} className="text-amber-400" />
                    AI Takeaway
                  </div>
                  <p className="text-xs font-medium leading-relaxed text-foreground/80">
                    {pr.analysis || "This change looks straightforward, but a deep scan will confirm file-level risk."}
                  </p>
                </div>

                {/* Hot files */}
                {pr.hotFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pr.hotFiles.map((f) => (
                      <span key={f} className="text-[8px] sm:text-[9px] font-mono font-bold px-2 py-1 rounded-none bg-surface-container-highest border border-outline-variant/10 text-muted-foreground truncate max-w-[150px] sm:max-w-[200px]">
                        {f.split("/").slice(-2).join("/")}
                      </span>
                    ))}
                  </div>
                )}

                {/* Deep scan button */}
                <button
                  type="button"
                  onClick={() => {
                    if (scan?.state === "done" || scan?.state === "error") {
                      setExpandedPR(isExpanded ? null : pr.number);
                    } else {
                      runDeepScan(pr);
                    }
                  }}
                  disabled={scan?.state === "scanning"}
                  className={cn(
                    "w-full py-3 rounded-none text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 border",
                    scan?.state === "done"
                      ? "bg-amber-500 text-white border-amber-500 hover:bg-amber-600"
                      : scan?.state === "scanning"
                        ? "bg-surface-container-highest border-outline-variant/10 text-muted-foreground cursor-not-allowed"
                        : "bg-surface-container-highest border-outline-variant/10 hover:bg-amber-500 hover:text-white hover:border-amber-500"
                  )}
                >
                  {scan?.state === "scanning" ? (
                    <><span className="size-3 rounded-full border-2 border-current border-t-transparent animate-spin" />Analyzing with AI…</>
                  ) : scan?.state === "done" ? (
                    <><MaterialIcon name={isExpanded ? "expand_less" : "expand_more"} size={14} />{isExpanded ? "Hide Deep Analysis" : "View Deep Analysis"}</>
                  ) : scan?.state === "error" ? (
                    <><MaterialIcon name="refresh" size={14} />Retry Deep Scan</>
                  ) : (
                    <><MaterialIcon name="manage_search" size={14} />Run Deep Code Impact Scan</>
                  )}
                </button>
              </div>

              {/* ── Deep scan panel ── */}
              {isExpanded && scan?.state === "done" && scan.result && (() => {
                const r = scan.result;
                return (
                  <div className="border-t border-outline-variant/10 px-6 pb-8 pt-6 space-y-7 animate-in fade-in slide-in-from-top-2 duration-300">
                    {/* Provider badge */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-widest text-amber-500 flex items-center gap-2">
                        <MaterialIcon name="auto_awesome" size={13} />
                        Deep Impact Report
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground/40 px-2 py-0.5 rounded-full border border-outline-variant/10">
                        {r.provider} · {r.model}
                      </span>
                    </div>

                    {r.meta?.plan && (
                      <div className="flex flex-wrap gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full bg-amber-500/5 border border-amber-500/10 text-amber-500">
                          {r.meta.plan} tier
                        </span>
                        {typeof r.meta.rateRemaining === "number" && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full bg-surface-container-highest border border-outline-variant/10 text-muted-foreground">
                            {r.meta.rateRemaining} deep scans left this hour
                          </span>
                        )}
                      </div>
                    )}

                    {/* Headline + summary */}
                    <div className="space-y-3 p-5 rounded-none bg-amber-500/5 border border-amber-500/10">
                      <p className="text-sm font-black text-foreground">{r.headline}</p>
                      <p className="text-xs leading-relaxed text-foreground/80">{r.summary}</p>
                    </div>

                    {/* Dimensional breakdown */}
                    <div className="space-y-3">
                      <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                        <MaterialIcon name="bar_chart" size={13} />
                        Risk Dimensions
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 p-4 rounded-none bg-surface-container/50 border border-outline-variant/10">
                        <DimensionBar label="Security"        score={r.dimensions.security}        color="text-red-400" />
                        <DimensionBar label="Performance"     score={r.dimensions.performance}     color="text-yellow-400" />
                        <DimensionBar label="Maintainability" score={r.dimensions.maintainability} color="text-amber-400" />
                        <DimensionBar label="Testability"     score={r.dimensions.testability}     color="text-teal-400" />
                        <DimensionBar label="Breaking Change" score={r.dimensions.breakingChange}  color="text-orange-400" />
                      </div>
                    </div>

                    {/* Breaking changes */}
                    {r.breakingChanges.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-orange-500 flex items-center gap-1.5">
                          <MaterialIcon name="warning_amber" size={13} />
                          Breaking Changes Detected
                        </div>
                        <ul className="space-y-1.5">
                          {r.breakingChanges.map((bc, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-orange-400 font-medium">
                              <MaterialIcon name="arrow_right" size={14} className="shrink-0 mt-0.5" />
                              {bc}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Concerns */}
                    {r.concerns.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                          <MaterialIcon name="report" size={13} />
                          Findings ({r.concerns.length})
                        </div>
                        <div className="space-y-2">
                          {r.concerns.map((c, i) => (
                            <div key={i} className={cn("rounded-none border p-4 space-y-2", SEVERITY_STYLE[c.severity])}>
                              <div className="flex items-center gap-2">
                                <MaterialIcon name={SEVERITY_ICON[c.severity] ?? "info"} size={14} className="shrink-0" />
                                <span className="text-[9px] font-black uppercase tracking-widest opacity-70">{c.severity}</span>
                                <span className="text-[9px] font-black uppercase tracking-widest opacity-50">·</span>
                                <MaterialIcon name={CATEGORY_ICON[c.category] ?? "code"} size={12} className="shrink-0 opacity-60" />
                                <span className="text-[9px] font-black uppercase tracking-widest opacity-50">{c.category}</span>
                                {c.file && (
                                  <span className="ml-auto text-[9px] font-mono opacity-50 truncate max-w-[120px]">
                                    {c.file.split("/").slice(-1)[0]}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs font-medium leading-relaxed">{c.description}</p>
                              <div className="flex items-start gap-1.5 pt-1 border-t border-current/10">
                                <MaterialIcon name="lightbulb" size={12} className="shrink-0 mt-0.5 opacity-60" />
                                <p className="text-[10px] leading-relaxed opacity-80">{c.suggestion}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Impact areas + affected systems */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {r.impactAreas.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Impact Areas</div>
                          <div className="flex flex-wrap gap-1.5">
                            {r.impactAreas.map((a) => (
                              <span key={a} className="text-[9px] font-bold px-2 py-1 rounded-full bg-surface-container-highest border border-outline-variant/20 text-foreground/70">{a}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {r.affectedSystems.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Affected Systems</div>
                          <div className="flex flex-wrap gap-1.5">
                            {r.affectedSystems.map((s) => (
                              <span key={s} className="text-[9px] font-bold px-2 py-1 rounded-full bg-amber-500/5 border border-amber-500/10 text-amber-400">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Recommendation */}
                    <div className="p-4 rounded-none bg-emerald-500/5 border border-emerald-500/10 space-y-1.5">
                      <div className="text-[9px] font-black uppercase tracking-widest text-emerald-500 flex items-center gap-1.5">
                        <MaterialIcon name="recommend" size={12} />
                        Recommendation
                      </div>
                      <p className="text-xs text-foreground/80 font-medium leading-relaxed">{r.recommendation}</p>
                    </div>

                    {/* Review checklist */}
                    {r.reviewChecklist.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                          <MaterialIcon name="checklist" size={13} />
                          Review Checklist
                        </div>
                        <ul className="space-y-1.5">
                          {r.reviewChecklist.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-foreground/70">
                              <span className="size-4 shrink-0 mt-0.5 rounded border border-outline-variant/20 flex items-center justify-center text-[8px] font-black text-muted-foreground/40">{i + 1}</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Stats footer */}
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 pt-2 border-t border-outline-variant/10">
                      <div className="text-center p-2 sm:p-3 rounded-none bg-surface-container/50 border border-outline-variant/10">
                        <div className="text-xl sm:text-2xl font-black">{r.suggestedReviewers}</div>
                        <div className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mt-0.5">Suggested Reviewers</div>
                      </div>
                      <div className="text-center p-2 sm:p-3 rounded-none bg-surface-container/50 border border-outline-variant/10">
                        <div className="text-base sm:text-lg font-black">{r.estimatedReviewTime}</div>
                        <div className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mt-0.5">Est. Review Time</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Error state */}
              {isExpanded && scan?.state === "error" && (
                <div className="border-t border-outline-variant/10 px-6 pb-5 pt-4">
                  <p className="text-xs text-destructive font-medium">{scan.error}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
