"use client";

import { useState, useEffect } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { getCsrfToken } from "@/lib/csrf-client";

interface OpenPR {
  number: number;
  title: string;
  author: string;
  authorAvatar: string;
  head: string;
  base: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  labels: { name: string; color: string }[];
  url: string;
}

interface ReviewResult {
  prNumber: number;
  verdict: string;
  summary: string;
  riskLevel: string;
  findings: { severity: string; description: string }[];
  loading: boolean;
  error?: string;
}

interface PrQueueProps {
  selectedRepo: string | null;
  isPro: boolean;
}

function verdictStyle(verdict: string) {
  if (verdict === "APPROVE")          return { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", icon: "check_circle",  label: "Approve"   };
  if (verdict === "REQUEST_CHANGES")  return { text: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20",     icon: "cancel",        label: "Req Changes" };
  return                                     { text: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20",   icon: "comment",       label: "Discuss"   };
}

function riskColor(risk: string) {
  if (risk === "low")      return "text-emerald-400";
  if (risk === "medium")   return "text-amber-400";
  if (risk === "high")     return "text-orange-400";
  if (risk === "critical") return "text-red-400";
  return "text-muted-foreground";
}

function sizeBadge(additions: number, deletions: number) {
  const total = additions + deletions;
  if (total < 100)  return { label: "XS", cls: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" };
  if (total < 300)  return { label: "S",  cls: "bg-teal-500/10 border-teal-500/20 text-teal-400"         };
  if (total < 800)  return { label: "M",  cls: "bg-amber-500/10 border-amber-500/20 text-amber-400"      };
  if (total < 2000) return { label: "L",  cls: "bg-orange-500/10 border-orange-500/20 text-orange-400"   };
  return                    { label: "XL", cls: "bg-red-500/10 border-red-500/20 text-red-400"            };
}

export function PrQueue({ selectedRepo, isPro }: PrQueueProps) {
  const [repo, setRepo] = useState(selectedRepo ?? "");
  const [prs, setPrs] = useState<OpenPR[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reviews, setReviews] = useState<Map<number, ReviewResult>>(new Map());
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (selectedRepo) setRepo(selectedRepo);
  }, [selectedRepo]);

  const fetchPRs = async () => {
    const target = repo.trim();
    if (!target || loading) return;
    setLoading(true);
    setError(null);
    setPrs([]);
    setSelected(new Set());
    setReviews(new Map());
    try {
      const res = await fetch(`/api/github/open-prs?repo=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to fetch PRs"); return; }
      setPrs(data.prs ?? []);
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  };

  const toggleSelect = (num: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(prs.map((p) => p.number)));
  const clearAll  = () => setSelected(new Set());

  const reviewSelected = async () => {
    if (!isPro) return;
    const toReview = prs.filter((p) => selected.has(p.number));
    if (toReview.length === 0) return;

    setReviewing(true);
    // Mark all as loading
    const init = new Map<number, ReviewResult>();
    toReview.forEach((pr) => init.set(pr.number, {
      prNumber: pr.number, verdict: "", summary: "", riskLevel: "", findings: [], loading: true,
    }));
    setReviews(init);

    const csrf = await getCsrfToken();

    // Review sequentially to avoid hammering the AI
    for (const pr of toReview) {
      try {
        const res = await fetch("/api/ai/code-review", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify({ repo: repo.trim(), prNumber: pr.number, mode: "quick" }),
        });
        const data = await res.json();
        if (!res.ok) {
          setReviews((prev) => new Map(prev).set(pr.number, {
            prNumber: pr.number, verdict: "COMMENT", summary: "", riskLevel: "unknown",
            findings: [], loading: false, error: data.error ?? "Review failed",
          }));
        } else {
          setReviews((prev) => new Map(prev).set(pr.number, {
            prNumber: pr.number,
            verdict: data.verdict ?? "COMMENT",
            summary: data.summary ?? "",
            riskLevel: data.riskLevel ?? "unknown",
            findings: (data.findings ?? []).slice(0, 3),
            loading: false,
          }));
        }
      } catch {
        setReviews((prev) => new Map(prev).set(pr.number, {
          prNumber: pr.number, verdict: "COMMENT", summary: "", riskLevel: "unknown",
          findings: [], loading: false, error: "Network error",
        }));
      }
    }
    setReviewing(false);
  };

  if (!isPro) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center rounded-3xl border-2 border-dashed border-indigo-500/15 bg-indigo-500/3">
        <div className="size-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
          <MaterialIcon name="lock" size={24} className="text-indigo-400" />
        </div>
        <div>
          <p className="font-black text-foreground/70">Professional plan required</p>
          <p className="text-xs text-muted-foreground/50 mt-1">PR Queue bulk review requires a Professional plan or higher.</p>
        </div>
        <a href="/pricing-settings" className="text-[10px] font-black px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
          Upgrade Plan
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Repo input */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <MaterialIcon name="folder" size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 pointer-events-none" />
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchPRs()}
            placeholder="owner/repo (e.g. vercel/next.js)"
            className="w-full bg-surface-container/40 border border-outline-variant/15 rounded-2xl pl-10 pr-4 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
          />
        </div>
        <button
          type="button"
          onClick={fetchPRs}
          disabled={loading || !repo.trim()}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-black uppercase tracking-wider transition-colors shrink-0"
        >
          {loading ? <MaterialIcon name="sync" size={15} className="animate-spin" /> : <MaterialIcon name="refresh" size={15} />}
          {loading ? "Loading…" : "Load PRs"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          <MaterialIcon name="error" size={16} className="shrink-0" />{error}
        </div>
      )}

      {prs.length === 0 && !loading && !error && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10">
          <MaterialIcon name="info" size={15} className="text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Load open PRs from any public repo, then select any combination and run AI reviews in bulk. Results appear inline — no page reloads.
          </p>
        </div>
      )}

      {prs.length > 0 && (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">
                {prs.length} open PR{prs.length !== 1 ? "s" : ""} · {selected.size} selected
              </span>
              <button type="button" onClick={selectAll} className="text-[9px] font-black text-indigo-400 hover:underline">All</button>
              <span className="text-muted-foreground/30">·</span>
              <button type="button" onClick={clearAll} className="text-[9px] font-black text-muted-foreground/50 hover:underline">None</button>
            </div>
            <button
              type="button"
              onClick={reviewSelected}
              disabled={selected.size === 0 || reviewing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-black uppercase tracking-wider transition-colors"
            >
              {reviewing
                ? <><MaterialIcon name="sync" size={13} className="animate-spin" /> Reviewing…</>
                : <><MaterialIcon name="auto_awesome" size={13} /> Review {selected.size > 0 ? `${selected.size} PR${selected.size > 1 ? "s" : ""}` : "Selected"}</>
              }
            </button>
          </div>

          {/* PR list */}
          <div className="space-y-2">
            {prs.map((pr) => {
              const isSelected = selected.has(pr.number);
              const review = reviews.get(pr.number);
              const sz = sizeBadge(pr.additions, pr.deletions);

              return (
                <div key={pr.number} className={cn(
                  "rounded-2xl border transition-all overflow-hidden",
                  isSelected ? "border-indigo-500/30 bg-indigo-500/3" : "border-outline-variant/10 bg-surface-container/20 hover:border-outline-variant/20"
                )}>
                  {/* PR row */}
                  <div className="flex items-start gap-3 p-4">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(pr.number)}
                      className="mt-1 shrink-0 accent-indigo-500"
                    />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-start gap-2 flex-wrap">
                        <a href={pr.url} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-black text-foreground/90 hover:text-indigo-400 transition-colors leading-tight">
                          #{pr.number} {pr.title}
                        </a>
                        {pr.draft && (
                          <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-muted border border-outline-variant/20 text-muted-foreground">Draft</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-[9px]">
                        {pr.authorAvatar && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={pr.authorAvatar} alt={pr.author} className="size-4 rounded-full" />
                        )}
                        <span className="font-mono text-muted-foreground/50">{pr.author}</span>
                        <span className="text-muted-foreground/30">·</span>
                        <span className="font-mono text-muted-foreground/40">{pr.head} → {pr.base}</span>
                        <span className="text-muted-foreground/30">·</span>
                        <span className="text-emerald-400 font-mono">+{pr.additions}</span>
                        <span className="text-red-400 font-mono">-{pr.deletions}</span>
                        <span className="text-muted-foreground/40 font-mono">{pr.changedFiles} files</span>
                        <span className={cn("px-1.5 py-0.5 rounded border font-black text-[8px]", sz.cls)}>{sz.label}</span>
                      </div>
                      {pr.labels.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {pr.labels.map((l) => (
                            <span key={l.name}
                              className="text-[8px] font-bold px-1.5 py-0.5 rounded-full border border-current/20"
                              style={{ color: `#${l.color}`, backgroundColor: `#${l.color}20` }}>
                              {l.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Review result */}
                  {review && (
                    <div className="border-t border-outline-variant/10 px-4 pb-4 pt-3 space-y-3">
                      {review.loading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                          <MaterialIcon name="sync" size={14} className="animate-spin text-indigo-400" />
                          Reviewing PR #{pr.number}…
                        </div>
                      ) : review.error ? (
                        <div className="flex items-center gap-2 text-xs text-red-400">
                          <MaterialIcon name="error" size={14} className="shrink-0" />
                          {review.error}
                        </div>
                      ) : (() => {
                        const vs = verdictStyle(review.verdict);
                        return (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[9px] font-black", vs.text, vs.bg, vs.border)}>
                                <MaterialIcon name={vs.icon} size={12} />
                                {vs.label}
                              </div>
                              <span className={cn("text-[9px] font-black uppercase tracking-widest", riskColor(review.riskLevel))}>
                                {review.riskLevel} risk
                              </span>
                            </div>
                            {review.summary && (
                              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{review.summary}</p>
                            )}
                            {review.findings.length > 0 && (
                              <div className="space-y-1">
                                {review.findings.map((f, i) => (
                                  <div key={i} className="flex items-start gap-1.5 text-[10px]">
                                    <span className={cn("font-black shrink-0 mt-0.5",
                                      f.severity === "critical" ? "text-red-400" :
                                      f.severity === "high" ? "text-orange-400" :
                                      f.severity === "medium" ? "text-amber-400" : "text-muted-foreground/60"
                                    )}>▸</span>
                                    <span className="text-muted-foreground/65">{f.description}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
