"use client";

import { useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

interface Contributor {
  login: string;
  avatarUrl: string;
  totalCommits: number;
  additions: number;
  deletions: number;
  commitPct: number;
  weeks: number;
}

interface OwnershipData {
  repo: string;
  totalCommits: number;
  contributors: Contributor[];
  busFactor: number;
}

interface CodeOwnershipProps {
  repos: string[];
}

type RepoState = OwnershipData | "loading" | "error" | "empty" | "no-token" | "computing";

const PALETTE = [
  "#f59e0b", "#f59e0b", "#f59e0b", "#f43f5e", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#f59e0b",
];

const PAGE_SIZE = 20;

export function CodeOwnership({ repos }: CodeOwnershipProps) {
  const [data, setData] = useState<Record<string, RepoState>>({});
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [page, setPage] = useState<Record<string, number>>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    repos.forEach((repo) => {
      if (fetchedRef.current.has(repo)) return;
      fetchedRef.current.add(repo);
      setData((prev) => ({ ...prev, [repo]: "loading" }));
      fetchOwnership(repo);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos]);

  async function fetchOwnership(repo: string, attempt = 0) {
    setAttempts((prev) => ({ ...prev, [repo]: attempt }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`/api/github/contributors?repo=${encodeURIComponent(repo)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 202) {
        // GitHub is computing stats — retry with backoff up to 5 times (~20s total)
        if (attempt < 5) {
          const delay = Math.min(1500 + attempt * 1000, 6000);
          await new Promise((r) => setTimeout(r, delay));
          return fetchOwnership(repo, attempt + 1);
        }
        // Still computing after 5 retries — show a "still computing" state with retry
        setData((prev) => ({ ...prev, [repo]: "computing" }));
        return;
      }
      if (!res.ok) {
        setData((prev) => ({ ...prev, [repo]: "error" }));
        return;
      }
      const raw = await res.json() as Record<string, unknown>;
      if (raw.noToken) {
        setData((prev) => ({ ...prev, [repo]: "no-token" }));
        return;
      }
      processStats(repo, Array.isArray(raw) ? raw : []);
    } catch {
      clearTimeout(timeout);
      setData((prev) => ({ ...prev, [repo]: "error" }));
    }
  }

  function processStats(repo: string, raw: unknown[]) {
    if (raw.length === 0) {
      setData((prev) => ({ ...prev, [repo]: "empty" }));
      return;
    }

    const contributors: Contributor[] = (raw as Record<string, unknown>[])
      .map((c) => {
        const author = c.author as Record<string, string> | null;
        // GitHub stats/contributors returns weeks array with: w (week timestamp), a (additions), d (deletions), c (commits)
        const weeks = Array.isArray(c.weeks) ? (c.weeks as Record<string, number>[]) : [];
        const totalAdditions = weeks.reduce((s, w) => s + (typeof w.a === "number" ? w.a : 0), 0);
        const totalDeletions = weeks.reduce((s, w) => s + (typeof w.d === "number" ? w.d : 0), 0);
        return {
          login: author?.login ?? "unknown",
          avatarUrl: author?.avatar_url ?? "",
          totalCommits: typeof c.total === "number" ? c.total : 0,
          additions: totalAdditions,
          deletions: totalDeletions,
          commitPct: 0,
          weeks: weeks.filter((w) => (typeof w.c === "number" ? w.c : 0) > 0).length,
        };
      })
      .sort((a, b) => b.totalCommits - a.totalCommits);

    const totalCommits = contributors.reduce((s, c) => s + c.totalCommits, 0);
    contributors.forEach((c) => {
      c.commitPct = totalCommits > 0 ? Math.round((c.totalCommits / totalCommits) * 100) : 0;
    });

    let cumulative = 0;
    let busFactor = 0;
    for (const c of contributors) {
      cumulative += c.commitPct;
      busFactor++;
      if (cumulative >= 80) break;
    }

    // Store all contributors, paginate in UI
    setData((prev) => ({
      ...prev,
      [repo]: { repo, totalCommits, contributors, busFactor },
    }));
  }

  if (repos.length === 0) return null;

  return (
    <div className="space-y-10">
      {repos.map((repo) => {
        const state = data[repo];
        return (
          <div key={repo} className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-none bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                <MaterialIcon name="group" size={16} className="text-amber-400" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-amber-400/80">Code Ownership</p>
                <p className="text-sm font-black">{repo}</p>
              </div>
            </div>

            {!state && null}

            {state === "loading" && (
              <div className="flex items-center justify-center gap-3 py-16 rounded-none border border-outline-variant/10 bg-surface-container/20">
                <MaterialIcon name="sync" size={18} className="animate-spin text-amber-400" />
                <span className="text-sm text-muted-foreground/60">
                  Computing contributor ownership…
                  {attempts[repo] !== undefined && attempts[repo] > 0 && (
                    <span className="ml-1.5 text-[10px] font-mono text-amber-400/60">(attempt {attempts[repo]}/5)</span>
                  )}
                </span>
              </div>
            )}

            {state === "no-token" && (
              <div className="flex items-center gap-3 p-4 rounded-none bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
                <MaterialIcon name="link_off" size={16} className="shrink-0" />
                <span>Connect your GitHub account to see contributor data. Go to <a href="/settings" className="underline hover:text-amber-200">Settings → Connected Accounts</a>.</span>
              </div>
            )}

            {state === "computing" && (
              <div className="flex items-center justify-between gap-3 p-4 rounded-none bg-surface-container/30 border border-outline-variant/15 text-sm text-muted-foreground/70">
                <div className="flex items-center gap-3">
                  <MaterialIcon name="hourglass_top" size={16} className="shrink-0 text-amber-400/60" />
                  GitHub is still computing contributor stats for this repo. This can take a minute for large repos.
                </div>
                <button
                  type="button"
                  onClick={() => { fetchedRef.current.delete(repo); setData((prev) => ({ ...prev, [repo]: "loading" })); fetchOwnership(repo); }}
                  className="shrink-0 text-[10px] font-black px-3 py-1.5 rounded-none border border-amber-500/20 text-amber-400 hover:bg-amber-500/10 transition-all"
                >
                  Retry
                </button>
              </div>
            )}

            {state === "error" && (
              <div className="flex items-center justify-between gap-3 p-4 rounded-none bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                <div className="flex items-center gap-3">
                  <MaterialIcon name="error" size={16} className="shrink-0" />
                  Failed to load contributor stats — repo may be private, or GitHub API is temporarily unavailable.
                </div>
                <button
                  type="button"
                  onClick={() => { fetchedRef.current.delete(repo); setData((prev) => ({ ...prev, [repo]: "loading" })); fetchOwnership(repo); }}
                  className="shrink-0 text-[10px] font-black px-3 py-1.5 rounded-none border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all"
                >
                  Retry
                </button>
              </div>
            )}

            {state === "empty" && (
              <div className="flex items-center gap-3 p-4 rounded-none bg-surface-container border border-outline-variant/15 text-sm text-muted-foreground">
                <MaterialIcon name="group_off" size={16} className="shrink-0 text-amber-400/60" />
                No contributor history available — this repo may be new, empty, or GitHub is still computing its stats. Try again in a minute.
              </div>
            )}

            {state && state !== "loading" && state !== "error" && state !== "empty" && state !== "no-token" && state !== "computing" && (() => {
              const d = state as OwnershipData;
              const busRisk =
                d.busFactor === 1 ? "CRITICAL" :
                d.busFactor === 2 ? "HIGH" :
                d.busFactor <= 4 ? "MEDIUM" : "HEALTHY";
              const busClasses =
                busRisk === "CRITICAL" ? { text: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20"     } :
                busRisk === "HIGH"     ? { text: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/20"  } :
                busRisk === "MEDIUM"   ? { text: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20"   } :
                                        { text: "text-emerald-400",  bg: "bg-emerald-500/10", border: "border-emerald-500/20" };

              return (
                <div className="space-y-4">
                  {/* Summary strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="px-4 py-3 rounded-none bg-surface-container/30 border border-outline-variant/10 space-y-0.5">
                      <p className="text-lg font-black text-foreground">{d.contributors.length}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">Contributors</p>
                    </div>
                    <div className="px-4 py-3 rounded-none bg-surface-container/30 border border-outline-variant/10 space-y-0.5">
                      <p className="text-lg font-black text-foreground">{d.totalCommits.toLocaleString()}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">Total Commits</p>
                    </div>
                    <div className={cn("px-4 py-3 rounded-none border space-y-1", busClasses.bg, busClasses.border)}>
                      <div className="flex items-center gap-2">
                        <p className={cn("text-lg font-black", busClasses.text)}>{d.busFactor}</p>
                        <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded border", busClasses.text, busClasses.bg, busClasses.border)}>{busRisk}</span>
                      </div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">Bus Factor</p>
                    </div>
                  </div>

                  {/* Stacked ownership bar */}
                  <div className="p-4 rounded-none bg-surface-container/20 border border-outline-variant/10 space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                      <MaterialIcon name="bar_chart" size={12} /> Commit ownership breakdown
                    </p>
                    <div className="flex h-3 rounded-full overflow-hidden gap-px">
                      {d.contributors.slice(0, 8).map((c, i) => (
                        <div
                          key={c.login}
                          title={`${c.login}: ${c.commitPct}%`}
                          style={{ width: `${c.commitPct}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
                        />
                      ))}
                      {d.contributors.length > 8 && (
                        <div className="flex-1 bg-muted-foreground/20" title="Others" />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {d.contributors.slice(0, 8).map((c, i) => (
                        <div key={c.login} className="flex items-center gap-1">
                          <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                          <span className="text-[9px] font-mono text-muted-foreground/60">{c.login}</span>
                        </div>
                      ))}
                      {d.contributors.length > 8 && (
                        <span className="text-[9px] font-mono text-muted-foreground/40">+{d.contributors.length - 8} more</span>
                      )}
                    </div>
                  </div>

                  {/* Contributor rows */}
                  <div className="space-y-2">
                    {(() => {
                      const currentPage = page[repo] ?? 1;
                      const start = (currentPage - 1) * PAGE_SIZE;
                      const end = start + PAGE_SIZE;
                      const paginated = d.contributors.slice(start, end);
                      const totalPages = Math.ceil(d.contributors.length / PAGE_SIZE);

                      return (
                        <>
                          {paginated.map((c, i) => {
                            const overallRank = start + i + 1;
                            return (
                      <div
                        key={c.login}
                        className="flex items-center gap-3 px-4 py-3 rounded-none bg-surface-container/20 border border-outline-variant/8 hover:border-amber-500/20 transition-all"
                      >
                        <span className="text-[10px] font-black text-muted-foreground/25 w-4 text-center shrink-0">{overallRank}</span>
                        {c.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.avatarUrl} alt={c.login} className="size-7 rounded-full ring-1 ring-white/10 shrink-0" />
                        ) : (
                          <div className="size-7 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                            <MaterialIcon name="person" size={14} className="text-amber-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black text-foreground/85">{c.login}</span>
                            {overallRank === 1 && (
                              <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                Top Contributor
                              </span>
                            )}
                          </div>
                          <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-container-highest">
                            <div className="h-full rounded-full bg-amber-500 transition-all duration-700" style={{ width: `${c.commitPct}%` }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          <p className="text-xs font-black text-foreground/80">{c.commitPct}%</p>
                          <p className="text-[9px] font-mono text-muted-foreground/40">{c.totalCommits.toLocaleString()} commits</p>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5 hidden sm:block">
                          {c.additions > 0 || c.deletions > 0 ? (
                            <>
                              <p className="text-[10px] font-mono text-emerald-400">+{(c.additions / 1000).toFixed(1)}k</p>
                              <p className="text-[10px] font-mono text-red-400">-{(c.deletions / 1000).toFixed(1)}k</p>
                            </>
                          ) : (
                            <p className="text-[10px] font-mono text-muted-foreground/40">—</p>
                          )}
                        </div>
                      </div>
                    );})}
                    {d.contributors.length > PAGE_SIZE && (
                      <div className="flex items-center justify-between pt-4 border-t border-outline-variant/10">
                        <p className="text-[10px] font-mono text-muted-foreground/60">
                          Showing {start + 1}-{Math.min(end, d.contributors.length)} of {d.contributors.length} contributors
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={currentPage <= 1}
                            onClick={() => setPage((prev) => ({ ...prev, [repo]: currentPage - 1 }))}
                            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-none border border-outline-variant/20 disabled:opacity-40 hover:border-amber-500/30"
                          >
                            Previous
                          </button>
                          <span className="text-[10px] font-mono text-muted-foreground/60 px-2">
                            {currentPage} / {totalPages}
                          </span>
                          <button
                            type="button"
                            disabled={currentPage >= totalPages}
                            onClick={() => setPage((prev) => ({ ...prev, [repo]: currentPage + 1 }))}
                            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-none border border-outline-variant/20 disabled:opacity-40 hover:border-amber-500/30"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                    </>
                    );
                  })()}
                  </div>

                  {/* Bus factor callout */}
                  <div className={cn("flex items-start gap-3 p-4 rounded-none border", busClasses.bg, busClasses.border)}>
                    <MaterialIcon
                      name={busRisk === "HEALTHY" ? "verified_user" : "warning"}
                      size={15}
                      className={cn("shrink-0 mt-0.5", busClasses.text)}
                    />
                    <div className="space-y-0.5">
                      <p className={cn("text-xs font-black", busClasses.text)}>
                        Bus Factor {d.busFactor} —{" "}
                        {busRisk === "CRITICAL" ? "Single point of failure" :
                         busRisk === "HIGH"     ? "High key-person risk" :
                         busRisk === "MEDIUM"   ? "Moderate knowledge concentration" :
                                                  "Well-distributed ownership"}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                        {d.busFactor === 1
                          ? `If ${d.contributors[0]?.login} left tomorrow, 80%+ of commit history knowledge leaves with them.`
                          : `${d.busFactor} contributor${d.busFactor > 1 ? "s" : ""} account for 80% of all commits in this repo.`}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
