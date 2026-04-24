"use client";

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

interface CoverageData {
  coverage: number | null;
  source: string;
  frameworks: string[];
  hasConfig: boolean;
  configFiles: string[];
  trend?: { date: string; coverage: number }[];
}

interface PrCoverage {
  prNumber: number;
  baseCoverage: number | null;
  headCoverage: number | null;
  delta: number | null;
  status: "improved" | "degraded" | "unchanged" | "unknown";
  source: string;
  filesChanged: { filename: string; additions: number; deletions: number; isTestFile: boolean }[];
  testFilesCount: number;
  totalFilesChanged: number;
}

function PrCoverageChecker({ repo }: { repo: string }) {
  const [prInput, setPrInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PrCoverage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    const n = parseInt(prInput.trim(), 10);
    if (isNaN(n) || n < 1) { setError("Enter a valid PR number"); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(`/api/github/coverage/pr?repo=${encodeURIComponent(repo)}&pr=${n}`);
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Failed");
      setResult(await res.json() as PrCoverage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch PR coverage");
    } finally {
      setLoading(false);
    }
  };

  const statusColor = result?.status === "improved" ? "text-emerald-400"
    : result?.status === "degraded" ? "text-red-400"
    : "text-muted-foreground";

  const statusIcon = result?.status === "improved" ? "trending_up"
    : result?.status === "degraded" ? "trending_down"
    : "trending_flat";

  return (
    <div className="p-5 rounded-none border border-outline-variant/10 bg-surface-container/20 space-y-4">
      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
        <MaterialIcon name="difference" size={12} /> PR Coverage Diff
      </p>

      <div className="flex gap-2">
        <input
          type="number"
          min="1"
          placeholder="PR number (e.g. 42)"
          value={prInput}
          onChange={(e) => setPrInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && check()}
          className="flex-1 text-sm bg-surface-container-highest border border-outline-variant/20 rounded-none px-3 py-2 font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          title="PR number"
        />
        <button
          type="button"
          onClick={check}
          disabled={loading || !prInput}
          className="px-4 py-2 rounded-none bg-primary/90 hover:bg-primary text-white text-xs font-black uppercase tracking-widest disabled:opacity-50 transition-colors"
        >
          {loading ? "…" : "Check"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <MaterialIcon name="error" size={13} />{error}
        </p>
      )}

      {result && (
        <div className="space-y-3">
          {/* Delta summary */}
          <div className="flex items-center gap-3 p-3 rounded-none border border-outline-variant/10 bg-surface-container-highest/30">
            <MaterialIcon name={statusIcon} size={20} className={statusColor} />
            <div className="flex-1">
              <p className={cn("text-sm font-black", statusColor)}>
                {result.status === "improved" ? `+${result.delta}% coverage` :
                 result.status === "degraded" ? `${result.delta}% coverage` :
                 result.status === "unchanged" ? "Coverage unchanged" : "Coverage data unavailable"}
              </p>
              <p className="text-[10px] text-muted-foreground/50 font-mono">
                {result.baseCoverage !== null && result.headCoverage !== null
                  ? `${result.baseCoverage}% → ${result.headCoverage}%`
                  : "No baseline data"}
                {result.source === "estimated" && " (estimated)"}
                {result.source === "codecov" && " · via Codecov"}
              </p>
            </div>
            <span className={cn("text-[9px] font-black px-2 py-1 rounded-none border",
              result.status === "improved" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
              result.status === "degraded" ? "bg-red-500/10 border-red-500/20 text-red-400" :
              "bg-muted border-outline-variant/20 text-muted-foreground"
            )}>
              PR #{result.prNumber}
            </span>
          </div>

          {/* File stats */}
          <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
            <div className="p-2 rounded-none bg-surface-container-highest/20 border border-outline-variant/10">
              <p className="font-black text-foreground/80">{result.totalFilesChanged}</p>
              <p className="text-muted-foreground/50 uppercase tracking-widest">Files Changed</p>
            </div>
            <div className="p-2 rounded-none bg-surface-container-highest/20 border border-outline-variant/10">
              <p className={cn("font-black", result.testFilesCount > 0 ? "text-emerald-400" : "text-red-400")}>
                {result.testFilesCount}
              </p>
              <p className="text-muted-foreground/50 uppercase tracking-widest">Test Files</p>
            </div>
            <div className="p-2 rounded-none bg-surface-container-highest/20 border border-outline-variant/10">
              <p className="font-black text-foreground/80">
                {result.totalFilesChanged > 0
                  ? `${Math.round((result.testFilesCount / result.totalFilesChanged) * 100)}%`
                  : "—"}
              </p>
              <p className="text-muted-foreground/50 uppercase tracking-widest">Test Ratio</p>
            </div>
          </div>

          {/* File list (collapsed if > 8) */}
          {result.filesChanged.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {result.filesChanged.slice(0, 12).map((f) => (
                <div key={f.filename} className="flex items-center gap-2 py-1 px-2 rounded-none hover:bg-surface-container-highest/20 transition-colors">
                  <MaterialIcon
                    name={f.isTestFile ? "science" : "code"}
                    size={11}
                    className={f.isTestFile ? "text-teal-400 shrink-0" : "text-muted-foreground/40 shrink-0"}
                  />
                  <span className="font-mono text-[10px] text-foreground/60 truncate flex-1 min-w-0">{f.filename}</span>
                  <span className="text-[9px] text-emerald-400 font-mono shrink-0">+{f.additions}</span>
                  <span className="text-[9px] text-red-400 font-mono shrink-0">-{f.deletions}</span>
                </div>
              ))}
              {result.filesChanged.length > 12 && (
                <p className="text-[9px] text-muted-foreground/40 px-2">+{result.filesChanged.length - 12} more files</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TestCoverageProps {
  repos: string[];
}

function coverageColor(pct: number | null) {
  if (pct === null) return { text: "text-muted-foreground", bar: "bg-muted-foreground/40", ring: "#6b7280" };
  if (pct >= 80) return { text: "text-emerald-400", bar: "bg-emerald-500", ring: "#10b981" };
  if (pct >= 60) return { text: "text-amber-400",   bar: "bg-amber-500",   ring: "#f59e0b" };
  if (pct >= 40) return { text: "text-orange-400",  bar: "bg-orange-500",  ring: "#f97316" };
  return           { text: "text-red-400",    bar: "bg-red-500",     ring: "#ef4444" };
}

function coverageGrade(pct: number | null) {
  if (pct === null) return "—";
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
}

export function TestCoverage({ repos }: TestCoverageProps) {
  const [data, setData] = useState<Record<string, CoverageData | "loading" | "error">>({});

  useEffect(() => {
    repos.forEach((repo) => {
      if (data[repo]) return;
      setData((prev) => ({ ...prev, [repo]: "loading" }));
      fetch(`/api/github/coverage?repo=${encodeURIComponent(repo)}`)
        .then((r) => r.json())
        .then((d: CoverageData) => setData((prev) => ({ ...prev, [repo]: d })))
        .catch(() => setData((prev) => ({ ...prev, [repo]: "error" })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos]);

  if (repos.length === 0) return null;

  return (
    <div className="space-y-10">
      {repos.map((repo) => {
        const state = data[repo];
        return (
          <div key={repo} className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-none bg-teal-500/10 border border-teal-500/20 flex items-center justify-center shrink-0">
                <MaterialIcon name="science" size={16} className="text-teal-400" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-teal-400/80">Test Coverage</p>
                <p className="text-sm font-black">{repo}</p>
              </div>
            </div>

            {state === "loading" && (
              <div className="flex items-center justify-center gap-3 py-16 rounded-none border border-outline-variant/10 bg-surface-container/20">
                <MaterialIcon name="sync" size={18} className="animate-spin text-teal-400" />
                <span className="text-sm text-muted-foreground/60">Fetching coverage data…</span>
              </div>
            )}

            {state === "error" && (
              <div className="flex items-center gap-3 p-4 rounded-none bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                <MaterialIcon name="error" size={16} className="shrink-0" />
                Failed to load coverage data.
              </div>
            )}

            {state && state !== "loading" && state !== "error" && (() => {
              const d = state as CoverageData;
              const col = coverageColor(d.coverage);
              const grade = coverageGrade(d.coverage);
              const ringR = 44;
              const ringCirc = 2 * Math.PI * ringR;
              const pct = d.coverage ?? 0;
              const filled = (pct / 100) * ringCirc;

              return (
                <div className="space-y-5">
                  {/* Main coverage card */}
                  <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-6 p-4 sm:p-6 rounded-none border border-outline-variant/10 bg-surface-container/20">
                    {/* Ring gauge */}
                    <div className="shrink-0 relative">
                      <svg width="120" height="120" viewBox="0 0 120 120" aria-label={`Coverage: ${d.coverage ?? "unknown"}%`}>
                        <circle cx="60" cy="60" r={ringR} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="8" />
                        <circle
                          cx="60" cy="60" r={ringR} fill="none"
                          stroke={col.ring} strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={`${filled.toFixed(2)} ${ringCirc.toFixed(2)}`}
                          transform="rotate(-90 60 60)"
                          opacity={d.coverage !== null ? "0.9" : "0.3"}
                        />
                        <text x="60" y="55" textAnchor="middle" fontSize="20" fontWeight="900" fill={col.ring} fontFamily="monospace">
                          {d.coverage !== null ? `${d.coverage}` : "—"}
                        </text>
                        <text x="60" y="70" textAnchor="middle" fontSize="10" fontWeight="700" fill={col.ring} fontFamily="monospace">
                          {d.coverage !== null ? "%" : ""}
                        </text>
                      </svg>
                    </div>

                    <div className="flex-1 space-y-4 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className={cn("text-3xl font-black", col.text)}>
                          {d.coverage !== null ? `${d.coverage}%` : "Unknown"}
                        </div>
                        <span className={cn("text-[10px] font-black px-2 py-1 rounded-none border", col.text,
                          d.coverage !== null && d.coverage >= 80 ? "bg-emerald-500/10 border-emerald-500/20" :
                          d.coverage !== null && d.coverage >= 60 ? "bg-amber-500/10 border-amber-500/20" :
                          d.coverage !== null ? "bg-red-500/10 border-red-500/20" :
                          "bg-muted border-outline-variant/20"
                        )}>
                          Grade: {grade}
                        </span>
                        {d.source === "codecov" && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
                            via Codecov
                          </span>
                        )}
                      </div>

                      <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-container-highest">
                        <div className={cn("h-full rounded-full transition-all duration-700", col.bar)}
                          style={{ width: `${d.coverage ?? 0}%` }} />
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:gap-3 text-[10px]">
                        <div>
                          <p className="font-black text-muted-foreground/40 uppercase tracking-widest">Source</p>
                          <p className="font-bold text-foreground/70 capitalize">{d.source === "none" ? "Not detected" : d.source}</p>
                        </div>
                        <div>
                          <p className="font-black text-muted-foreground/40 uppercase tracking-widest">Frameworks</p>
                          <p className="font-bold text-foreground/70">
                            {d.frameworks.length > 0 ? d.frameworks.slice(0, 3).join(", ") : "None detected"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Coverage trend */}
                  {d.trend && d.trend.length > 1 && (
                    <div className="p-5 rounded-none border border-outline-variant/10 bg-surface-container/20 space-y-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                        <MaterialIcon name="trending_up" size={12} /> Coverage trend (last {d.trend.length} commits)
                      </p>
                      <div className="flex items-end gap-1 h-16">
                        {d.trend.map((point, i) => {
                          const heightPct = point.coverage;
                          const c = coverageColor(point.coverage);
                          return (
                            <div
                              key={i}
                              className="flex-1 rounded-t-sm transition-all"
                              style={{ height: `${heightPct}%`, backgroundColor: c.ring, opacity: 0.7 + (i / d.trend!.length) * 0.3 }}
                              title={`${new Date(point.date).toLocaleDateString("en", { month: "short", day: "numeric" })}: ${point.coverage}%`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground/35">
                        <span>{d.trend.length} commits ago</span>
                        {d.trend.length >= 2 && (() => {
                          const delta = d.trend![d.trend!.length - 1].coverage - d.trend![0].coverage;
                          return (
                            <span className={delta >= 0 ? "text-emerald-400" : "text-red-400"}>
                              {delta >= 0 ? "+" : ""}{delta.toFixed(1)}% trend
                            </span>
                          );
                        })()}
                        <span>Latest</span>
                      </div>
                    </div>
                  )}

                  {/* Config files detected */}
                  {d.configFiles.length > 0 && (
                    <div className="p-4 rounded-none border border-outline-variant/10 bg-surface-container/20 space-y-2">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                        <MaterialIcon name="description" size={12} /> Config files detected
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {d.configFiles.map((f) => (
                          <span key={f} className="font-mono text-[10px] px-2.5 py-1 rounded-none bg-surface-container-highest border border-outline-variant/15 text-foreground/60">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Coverage not found state */}
                  {d.coverage === null && d.frameworks.length === 0 && (
                    <div className="flex flex-col items-center gap-3 py-10 rounded-none border-2 border-dashed border-outline-variant/15 bg-surface-container/10 text-center">
                      <MaterialIcon name="science" size={32} className="text-muted-foreground/20" />
                      <div>
                        <p className="text-sm font-black text-foreground/50">No test coverage found</p>
                        <p className="text-[11px] text-muted-foreground/40 mt-1 max-w-xs mx-auto leading-relaxed">
                          No Codecov integration or test config detected. Set up{" "}
                          <a href="https://codecov.io" target="_blank" rel="noopener noreferrer" className="text-teal-400 underline underline-offset-2">Codecov</a> or add a Jest/pytest config to track coverage.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Coverage quality callout */}
                  {d.coverage !== null && (
                    <div className={cn("flex items-start gap-3 p-4 rounded-none border",
                      d.coverage >= 80 ? "bg-emerald-500/5 border-emerald-500/15" :
                      d.coverage >= 60 ? "bg-amber-500/5 border-amber-500/15" :
                      "bg-red-500/5 border-red-500/15"
                    )}>
                      <MaterialIcon
                        name={d.coverage >= 80 ? "verified" : d.coverage >= 60 ? "warning" : "dangerous"}
                        size={15}
                        className={cn("shrink-0 mt-0.5", col.text)}
                      />
                      <div>
                        <p className={cn("text-xs font-black", col.text)}>
                          {d.coverage >= 80 ? "Good coverage — low risk of undetected regressions" :
                           d.coverage >= 60 ? "Moderate coverage — some critical paths may be untested" :
                           d.coverage >= 40 ? "Low coverage — significant regression risk" :
                           "Critical: very low coverage — most code paths are untested"}
                        </p>
                        <p className="text-[10px] text-muted-foreground/55 mt-0.5 leading-relaxed">
                          {d.coverage >= 80
                            ? "Target 80%+ coverage for production-grade reliability. You're there."
                            : `Industry standard is 80%. Aim to cover at least your critical paths first.`}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* PR Coverage Diff */}
                  <PrCoverageChecker repo={repo} />
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
