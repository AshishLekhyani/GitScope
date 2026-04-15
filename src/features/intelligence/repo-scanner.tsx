"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { getCsrfToken } from "@/lib/csrf-client";
import type { RepoScanResult, RepoScanFinding } from "@/app/api/ai/repo-scan/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const GRADE_STYLE: Record<string, string> = {
  A: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  B: "text-teal-400 bg-teal-500/10 border-teal-500/20",
  C: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  D: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  F: "text-red-400 bg-red-500/10 border-red-500/20",
};

const PRIORITY_STYLE = {
  immediate: "bg-red-500/10 border-red-500/20 text-red-400",
  "short-term": "bg-amber-500/10 border-amber-500/20 text-amber-400",
  "long-term": "bg-indigo-500/10 border-indigo-500/20 text-indigo-400",
} as const;

const DEBT_LEVEL_COLOR = {
  minimal: "text-emerald-400",
  manageable: "text-teal-400",
  significant: "text-amber-400",
  severe: "text-red-400",
} as const;

function ScoreBar({ label, score, grade }: { label: string; score: number; grade: string }) {
  const color =
    score >= 80 ? "bg-emerald-400" :
    score >= 65 ? "bg-teal-400" :
    score >= 50 ? "bg-amber-400" :
    score >= 35 ? "bg-orange-400" : "bg-red-400";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-foreground/80">{score}</span>
          <span className={cn("text-[9px] font-black px-1.5 py-0.5 rounded border", GRADE_STYLE[grade] ?? GRADE_STYLE.C)}>
            {grade}
          </span>
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-container-highest overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-1000", color)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

const SEVERITY_STYLES = {
  critical: {
    border: "border-red-500/40",
    badge: "bg-red-500/20 text-red-300 border-red-500/30",
    dot: "bg-red-400",
    accent: "text-red-300",
    expand: "bg-red-500/10 border-red-500/20",
  },
  high: {
    border: "border-orange-500/35",
    badge: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    dot: "bg-orange-400",
    accent: "text-orange-300",
    expand: "bg-orange-500/8 border-orange-500/15",
  },
  medium: {
    border: "border-amber-500/35",
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    dot: "bg-amber-400",
    accent: "text-amber-300",
    expand: "bg-amber-500/8 border-amber-500/15",
  },
  low: {
    border: "border-outline-variant/25",
    badge: "bg-surface-container text-foreground/60 border-outline-variant/25",
    dot: "bg-muted-foreground/40",
    accent: "text-foreground/60",
    expand: "bg-surface-container/50 border-outline-variant/15",
  },
  info: {
    border: "border-indigo-500/30",
    badge: "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
    dot: "bg-indigo-400",
    accent: "text-indigo-300",
    expand: "bg-indigo-500/8 border-indigo-500/15",
  },
} as const;

function FindingItem({ finding }: { finding: RepoScanFinding }) {
  const [open, setOpen] = useState(false);
  const sev = (finding.severity in SEVERITY_STYLES ? finding.severity : "low") as keyof typeof SEVERITY_STYLES;
  const s = SEVERITY_STYLES[sev];
  const fileName = finding.file ? finding.file.split("/").slice(-1)[0] : null;

  return (
    <div className={cn("rounded-2xl border overflow-hidden bg-surface-container/25 dark:bg-surface-container/15", s.border)}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container/40 transition-colors">
        {/* Severity dot */}
        <span className={cn("size-2 rounded-full shrink-0 mt-px", s.dot)} />
        {/* Severity badge */}
        <span className={cn("text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0", s.badge)}>
          {finding.severity}
        </span>
        {/* Description */}
        <p className="flex-1 text-[11px] font-semibold text-foreground/85 leading-snug line-clamp-2">{finding.description}</p>
        {/* File name — always visible, prominent */}
        {fileName && (
          <span className="text-[9px] font-mono font-bold text-foreground/50 bg-surface-container-highest px-2 py-0.5 rounded border border-outline-variant/20 shrink-0 hidden sm:block max-w-[140px] truncate">
            {fileName}
          </span>
        )}
        {/* Expand indicator */}
        <div className={cn("shrink-0 size-6 rounded-lg flex items-center justify-center transition-colors",
          open ? "bg-indigo-500/20 text-indigo-400" : "bg-surface-container-highest text-muted-foreground/50"
        )}>
          <MaterialIcon name={open ? "expand_less" : "expand_more"} size={14} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 animate-in fade-in duration-150 border-t border-outline-variant/10">
          {finding.file && (
            <div className="flex items-center gap-2 pt-3">
              <MaterialIcon name="insert_drive_file" size={12} className="text-muted-foreground/50 shrink-0" />
              <span className="text-[10px] font-mono text-foreground/50 truncate">{finding.file}</span>
            </div>
          )}
          {finding.category && (
            <div className="flex items-center gap-2">
              <MaterialIcon name="label" size={12} className="text-muted-foreground/40 shrink-0" />
              <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground/50">{finding.category}</span>
            </div>
          )}
          <div className={cn("flex items-start gap-2.5 p-3 rounded-xl border", s.expand)}>
            <MaterialIcon name="lightbulb" size={13} className={cn("shrink-0 mt-0.5", s.accent)} />
            <div>
              <p className={cn("text-[10px] font-black uppercase tracking-wider mb-1", s.accent)}>Suggested fix</p>
              <p className="text-xs text-foreground/75 leading-relaxed">{finding.suggestion}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface RepoScannerProps {
  selectedRepo: string | null;
  canDeepScan: boolean;
  allowsPrivateRepo: boolean;
}

type ScanState = "idle" | "scanning" | "done" | "error";

function scanCacheKey(repo: string, mode: string) {
  return `gitscope-scan-v1:${repo}:${mode}`;
}

export function RepoScanner({ selectedRepo, canDeepScan, allowsPrivateRepo }: RepoScannerProps) {
  const [repoInput, setRepoInput] = useState(selectedRepo ?? "");
  const [scanMode, setScanMode] = useState<"quick" | "deep">("quick");
  const [state, setState] = useState<ScanState>("idle");
  const [progress, setProgress] = useState({ step: "", percent: 0 });
  const [result, setResult] = useState<RepoScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>("overview");
  const [secFilter, setSecFilter] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
  const [recsPage, setRecsPage] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const targetRepo = selectedRepo ?? repoInput;

  // Restore last scan result from sessionStorage on mount
  useEffect(() => {
    const repo = selectedRepo ?? repoInput;
    if (!repo) return;
    for (const mode of ["quick", "deep"] as const) {
      try {
        const raw = sessionStorage.getItem(scanCacheKey(repo, mode));
        if (raw) {
          const cached = JSON.parse(raw) as RepoScanResult;
          setResult(cached);
          setState("done");
          setScanMode(mode);
          return;
        }
      } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo]);

  const runScan = useCallback(async () => {
    if (!targetRepo || !/^[\w.-]+\/[\w.-]+$/.test(targetRepo)) {
      setError("Enter a valid repository (owner/repo).");
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setState("scanning");
    setProgress({ step: "Initializing scan…", percent: 2 });
    setResult(null);
    setError(null);

    try {
      const csrfToken = await getCsrfToken();
      const res = await fetch("/api/ai/repo-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ repo: targetRepo, scanMode }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Scan failed" }));
        throw new Error(err.error ?? "Scan failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6)) as {
              type: string;
              step?: string;
              percent?: number;
              result?: RepoScanResult;
              error?: string;
            };
            if (data.type === "progress" && data.step) {
              setProgress({ step: data.step, percent: data.percent ?? 0 });
            } else if (data.type === "done") {
              if (data.error) { setState("error"); setError(data.error); }
              else if (data.result) {
                setState("done");
                setResult(data.result);
                try {
                  sessionStorage.setItem(scanCacheKey(targetRepo, scanMode), JSON.stringify(data.result));
                } catch { /* quota exceeded — ignore */ }
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState("error");
      setError(err instanceof Error ? err.message : "Scan failed");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRepo, scanMode]);

  const reset = () => {
    abortRef.current?.abort();
    setState("idle");
    setResult(null);
    setError(null);
    setProgress({ step: "", percent: 0 });
    try {
      sessionStorage.removeItem(scanCacheKey(targetRepo, "quick"));
      sessionStorage.removeItem(scanCacheKey(targetRepo, "deep"));
    } catch { /* ignore */ }
  };

  // ── Scanning ──────────────────────────────────────────────────────────────
  if (state === "scanning") {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-8 animate-in fade-in duration-500">
        <div className="relative">
          <div className="size-24 rounded-3xl bg-indigo-500/5 border border-indigo-500/15 flex items-center justify-center">
            <MaterialIcon name="radar" size={40} className="text-indigo-500/60 animate-pulse" />
          </div>
          <div className="absolute inset-0 rounded-3xl border-2 border-indigo-500/20 animate-ping" />
          <div className="absolute inset-3 rounded-2xl border border-indigo-500/10 animate-ping [animation-delay:300ms]" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-black text-foreground/80">{progress.step}</p>
          <p className="text-[10px] font-mono text-muted-foreground/40">{targetRepo}</p>
        </div>
        <div className="w-full max-w-sm space-y-2">
          <div className="h-1.5 w-full rounded-full bg-surface-container-highest overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
              style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="text-center text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">
            {progress.percent}% · {scanMode === "deep" ? "Full Codebase Scan" : "Quick Health Check"}
          </p>
        </div>
        <button type="button" onClick={reset}
          className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 hover:text-muted-foreground transition-colors flex items-center gap-1.5">
          <MaterialIcon name="stop" size={12} /> Cancel
        </button>
      </div>
    );
  }

  // ── Result ────────────────────────────────────────────────────────────────
  if (state === "done" && result) {
    const healthColor =
      result.healthScore >= 80 ? "text-emerald-400" :
      result.healthScore >= 65 ? "text-teal-400" :
      result.healthScore >= 50 ? "text-amber-400" :
      result.healthScore >= 35 ? "text-orange-400" : "text-red-400";

    const sections = [
      { id: "overview", label: "Overview", icon: "dashboard" },
      { id: "security", label: "Security", icon: "security" },
      { id: "quality", label: "Quality", icon: "code_blocks" },
      { id: "deps", label: "Dependencies", icon: "account_tree" },
      { id: "recs", label: "Roadmap", icon: "map" },
    ];

    return (
      <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">

        {/* Health score hero */}
        <div className="relative overflow-hidden rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/5 via-violet-500/5 to-transparent p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-indigo-400/70">
                <MaterialIcon name="health_and_safety" size={12} /> Codebase Health Score
              </div>
              <div className={cn("text-6xl font-black italic", healthColor)}>{result.healthScore}</div>
              <p className="text-xs text-foreground/60 max-w-md leading-relaxed">{result.summary}</p>
              {result.isDemo && (
                <span className="inline-block text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                  Preview Mode
                </span>
              )}
            </div>
            <div className="shrink-0 space-y-2 text-right">
              <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">{targetRepo}</div>
              <div className="grid grid-cols-2 gap-2 text-center">
                {[
                  { label: "Files", value: result.metrics.fileCount },
                  { label: "LOC", value: result.metrics.estimatedLoc },
                  { label: "Stars", value: result.metrics.stars },
                  { label: "Issues", value: result.metrics.openIssues },
                ].map((m) => (
                  <div key={m.label} className="p-2 rounded-xl bg-background/30 border border-outline-variant/10">
                    <div className="text-sm font-black text-foreground/80">{m.value}</div>
                    <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">{m.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 p-1 bg-surface-container/30 rounded-2xl border border-outline-variant/10 overflow-x-auto">
          {sections.map((s) => (
            <button key={s.id} type="button" onClick={() => setActiveSection(s.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all whitespace-nowrap",
                activeSection === s.id ? "bg-indigo-500 text-white shadow-md" : "text-muted-foreground hover:text-foreground"
              )}>
              <MaterialIcon name={s.icon} size={12} />
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Overview section ── */}
        {activeSection === "overview" && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 rounded-2xl bg-surface-container/20 border border-outline-variant/10">
              <ScoreBar label="Security" score={result.security.score} grade={result.security.grade} />
              <ScoreBar label="Code Quality" score={result.codeQuality.score} grade={result.codeQuality.grade} />
              <ScoreBar label="Testability" score={result.testability.score} grade={result.testability.grade} />
              <ScoreBar label="Dependencies" score={result.dependencies.score} grade={
                result.dependencies.score >= 80 ? "A" : result.dependencies.score >= 65 ? "B" : result.dependencies.score >= 50 ? "C" : "D"
              } />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Architecture */}
              <div className="p-4 rounded-2xl bg-surface-container/20 border border-outline-variant/10 space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                  <MaterialIcon name="architecture" size={12} /> Architecture
                </p>
                <p className="text-xs text-foreground/70 leading-relaxed">{result.architecture.summary}</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.architecture.patterns.map((p) => (
                    <span key={p} className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/8 border border-indigo-500/15 text-indigo-400">{p}</span>
                  ))}
                </div>
              </div>

              {/* Tech debt */}
              <div className="p-4 rounded-2xl bg-surface-container/20 border border-outline-variant/10 space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                  <MaterialIcon name="debt" size={12} /> Tech Debt
                </p>
                <div className="flex items-center gap-3">
                  <span className={cn("text-2xl font-black uppercase italic", DEBT_LEVEL_COLOR[result.techDebt.level])}>
                    {result.techDebt.level}
                  </span>
                  <div>
                    <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Estimated effort</div>
                    <div className="text-xs font-bold text-foreground/70">{result.techDebt.estimatedHours}</div>
                  </div>
                </div>
                <div className="space-y-1">
                  {result.techDebt.hotspots.slice(0, 3).map((h) => (
                    <div key={h} className="text-[9px] font-mono text-muted-foreground/50 truncate">{h}</div>
                  ))}
                </div>
              </div>
            </div>

            {/* Test coverage */}
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-surface-container/20 border border-outline-variant/10">
              <div className="size-12 rounded-2xl flex items-center justify-center border" style={{
                background: result.testability.hasTestFramework ? "rgb(20 184 166 / 0.08)" : "rgb(239 68 68 / 0.08)",
                borderColor: result.testability.hasTestFramework ? "rgb(20 184 166 / 0.2)" : "rgb(239 68 68 / 0.2)",
              }}>
                <MaterialIcon name="science" size={22} className={result.testability.hasTestFramework ? "text-teal-400" : "text-red-400"} />
              </div>
              <div>
                <p className="text-xs font-black">{result.testability.hasTestFramework ? "Test framework detected" : "No test framework found"}</p>
                <p className="text-[10px] text-muted-foreground/60">
                  Estimated coverage: <span className="font-bold text-foreground/70">{result.testability.coverageEstimate}</span>
                </p>
              </div>
              <div className={cn("ml-auto text-[9px] font-black px-2 py-0.5 rounded border", GRADE_STYLE[result.testability.grade])}>
                Grade {result.testability.grade}
              </div>
            </div>
          </div>
        )}

        {/* ── Security section ── */}
        {activeSection === "security" && (() => {
          const SEC_SEVERITIES = ["all", "critical", "high", "medium", "low"] as const;
          const SEC_SEV_STYLE: Record<string, string> = {
            all:      "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
            critical: "bg-red-500/20 text-red-400 border-red-500/30",
            high:     "bg-orange-500/20 text-orange-400 border-orange-500/30",
            medium:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
            low:      "bg-surface-container text-muted-foreground border-outline-variant/30",
          };
          const filteredSecIssues = secFilter === "all"
            ? result.security.issues
            : result.security.issues.filter((f) => f.severity === secFilter);

          return (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center gap-4 p-5 rounded-2xl bg-surface-container/20 border border-outline-variant/10">
              <div className="flex flex-col items-center gap-1">
                <span className={cn("text-3xl font-black", GRADE_STYLE[result.security.grade].split(" ")[0])}>{result.security.grade}</span>
                <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">Security Grade</span>
              </div>
              <div className="flex-1">
                <div className="h-2 w-full rounded-full bg-surface-container-highest overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all duration-1000",
                    result.security.score >= 70 ? "bg-emerald-400" : result.security.score >= 50 ? "bg-amber-400" : "bg-red-400"
                  )} style={{ width: `${result.security.score}%` }} />
                </div>
                <p className="text-xs font-black text-foreground/70 mt-1">{result.security.score} / 100</p>
              </div>
            </div>

            {result.security.positives.length > 0 && (
              <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
                  <MaterialIcon name="verified_user" size={12} /> Security Strengths
                </p>
                <ul className="space-y-1.5">
                  {result.security.positives.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-emerald-400/70">
                      <MaterialIcon name="check" size={13} className="shrink-0 mt-0.5" /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.security.issues.length > 0 && (
              <div className="space-y-2">
                {/* Severity filter chips */}
                <div className="flex flex-wrap gap-1.5 px-1">
                  {SEC_SEVERITIES.map((sev) => {
                    const count = sev === "all"
                      ? result.security.issues.length
                      : result.security.issues.filter((f) => f.severity === sev).length;
                    if (count === 0 && sev !== "all") return null;
                    return (
                      <button
                        key={sev}
                        type="button"
                        aria-label={`Filter by ${sev}`}
                        onClick={() => setSecFilter(sev)}
                        className={cn(
                          "flex items-center gap-1 px-2.5 py-0.5 rounded-xl text-[9px] font-black uppercase tracking-wider border transition-all",
                          secFilter === sev
                            ? SEC_SEV_STYLE[sev]
                            : "bg-surface-container/40 text-muted-foreground/50 border-outline-variant/10 hover:border-outline-variant/25"
                        )}
                      >
                        {sev === "all" ? "All" : sev} <span className="opacity-60">({count})</span>
                      </button>
                    );
                  })}
                </div>
                {filteredSecIssues.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground/40 py-4">No {secFilter} issues</p>
                ) : (
                  filteredSecIssues.map((f, i) => <FindingItem key={i} finding={f} />)
                )}
              </div>
            )}
          </div>
          );
        })()}

        {/* ── Quality section ── */}
        {activeSection === "quality" && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {result.codeQuality.strengths.length > 0 && (
              <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
                  <MaterialIcon name="thumb_up" size={12} /> Strengths
                </p>
                <ul className="space-y-1.5">
                  {result.codeQuality.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-emerald-400/70">
                      <MaterialIcon name="check" size={13} className="shrink-0 mt-0.5" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.codeQuality.issues.length > 0 && (
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 px-1">
                  Quality Issues ({result.codeQuality.issues.length})
                </p>
                {result.codeQuality.issues.map((f, i) => <FindingItem key={i} finding={f} />)}
              </div>
            )}

            {result.testability.gaps.length > 0 && (
              <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
                  <MaterialIcon name="science" size={12} /> Test Coverage Gaps
                </p>
                <ul className="space-y-1.5">
                  {result.testability.gaps.map((g, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-amber-400/70">
                      <MaterialIcon name="arrow_right" size={13} className="shrink-0 mt-0.5" /> {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── Dependencies section ── */}
        {activeSection === "deps" && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total Deps", value: result.dependencies.totalCount, color: "text-indigo-400" },
                { label: "Dep Score", value: result.dependencies.score, color: result.dependencies.score >= 70 ? "text-emerald-400" : "text-amber-400" },
                { label: "Risk Level", value: result.dependencies.risks.length > 0 ? "⚠ Risks" : "✓ Clear", color: result.dependencies.risks.length > 0 ? "text-amber-400" : "text-emerald-400" },
              ].map((m) => (
                <div key={m.label} className="p-3 rounded-2xl bg-surface-container/20 border border-outline-variant/10 text-center">
                  <div className={cn("text-lg font-black", m.color)}>{m.value}</div>
                  <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40 mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>

            {result.dependencies.risks.length > 0 && (
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 px-1 flex items-center gap-1.5">
                  <MaterialIcon name="warning" size={12} className="text-amber-400" /> Dependency Risks
                </p>
                {result.dependencies.risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15 text-xs text-amber-400/80 font-medium">
                    <MaterialIcon name="arrow_right" size={13} className="shrink-0 mt-0.5" /> {r}
                  </div>
                ))}
              </div>
            )}

            {result.dependencies.outdatedSignals.length > 0 && (
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 px-1 flex items-center gap-1.5">
                  <MaterialIcon name="update" size={12} className="text-muted-foreground/50" /> Outdated Signals
                </p>
                {result.dependencies.outdatedSignals.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-surface-container/30 border border-outline-variant/10 text-xs text-muted-foreground/60">
                    <MaterialIcon name="circle" size={8} className="shrink-0 mt-1" /> {s}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Recommendations section ── */}
        {activeSection === "recs" && (() => {
          const RECS_PER_PAGE = 4;
          const recsTotal = result.recommendations.length;
          const recsPageCount = Math.max(1, Math.ceil(recsTotal / RECS_PER_PAGE));
          const rPage = Math.min(recsPage, recsPageCount - 1);
          const visibleRecs = result.recommendations.slice(rPage * RECS_PER_PAGE, (rPage + 1) * RECS_PER_PAGE);

          return (
          <div className="space-y-3 animate-in fade-in duration-300">
            <div className="flex items-center justify-between px-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
                {recsTotal} prioritized actions
              </p>
              {recsPageCount > 1 && (
                <span className="text-[9px] font-mono text-muted-foreground/40">
                  {rPage * RECS_PER_PAGE + 1}–{Math.min((rPage + 1) * RECS_PER_PAGE, recsTotal)} of {recsTotal}
                </span>
              )}
            </div>
            {visibleRecs.map((rec, i) => (
              <div key={`${rPage}-${i}`} className="rounded-2xl border border-outline-variant/10 bg-surface-container/20 overflow-hidden">
                <div className="flex items-start gap-3 p-4">
                  <span className={cn("text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0 mt-0.5",
                    PRIORITY_STYLE[rec.priority])}>
                    {rec.priority.replace("-", " ")}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-xs font-black text-foreground/85">{rec.title}</p>
                    <p className="text-[11px] text-foreground/60 leading-relaxed">{rec.description}</p>
                  </div>
                  <span className={cn("shrink-0 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded border",
                    rec.effort === "low" ? "bg-emerald-500/8 border-emerald-500/15 text-emerald-400" :
                    rec.effort === "medium" ? "bg-amber-500/8 border-amber-500/15 text-amber-400" :
                    "bg-red-500/8 border-red-500/15 text-red-400"
                  )}>
                    {rec.effort} effort
                  </span>
                </div>
              </div>
            ))}

            {/* Pagination controls */}
            {recsPageCount > 1 && (
              <div className="flex items-center justify-center gap-1 pt-1">
                <button
                  type="button"
                  aria-label="Previous recommendations page"
                  onClick={() => setRecsPage((p) => Math.max(0, p - 1))}
                  disabled={rPage === 0}
                  className="p-1.5 rounded-lg hover:bg-surface-container transition-colors disabled:opacity-30"
                >
                  <MaterialIcon name="chevron_left" size={14} className="text-muted-foreground" />
                </button>
                {Array.from({ length: recsPageCount }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Recommendations page ${i + 1}`}
                    onClick={() => setRecsPage(i)}
                    className={cn(
                      "size-6 rounded-lg text-[9px] font-black transition-all",
                      rPage === i ? "bg-indigo-500 text-white" : "text-muted-foreground hover:bg-surface-container"
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="Next recommendations page"
                  onClick={() => setRecsPage((p) => Math.min(recsPageCount - 1, p + 1))}
                  disabled={rPage === recsPageCount - 1}
                  className="p-1.5 rounded-lg hover:bg-surface-container transition-colors disabled:opacity-30"
                >
                  <MaterialIcon name="chevron_right" size={14} className="text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
          );
        })()}

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-outline-variant/10">
          <span className="text-[9px] font-mono text-muted-foreground/30">
            {result.isDemo ? "preview mode" : `analyzed with ${result.model}`}
          </span>
          <button type="button" onClick={reset}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-black uppercase tracking-widest text-indigo-400 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 transition-all">
            <MaterialIcon name="refresh" size={13} /> Rescan Repository
          </button>
        </div>
      </div>
    );
  }

  // ── Idle / Error ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {!selectedRepo ? (
        <input value={repoInput} onChange={(e) => setRepoInput(e.target.value)}
          placeholder="Repository to scan (owner/repo)"
          className="w-full bg-surface-container/40 border border-outline-variant/15 rounded-2xl px-5 py-4 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all" />
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-indigo-500/8 border border-indigo-500/20">
          <MaterialIcon name="folder" size={18} className="text-indigo-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400/60 mb-0.5">Target Repository</p>
            <p className="text-sm font-black text-foreground/90 truncate">{selectedRepo}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 p-1 bg-surface-container/30 rounded-xl border border-outline-variant/10">
          {(["quick", "deep"] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => setScanMode(mode)}
              disabled={mode === "deep" && !canDeepScan}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                scanMode === mode ? "bg-indigo-500 text-white shadow-md" : "text-muted-foreground hover:text-foreground",
                mode === "deep" && !canDeepScan && "opacity-40 cursor-not-allowed"
              )}>
              <MaterialIcon name={mode === "quick" ? "flash_on" : "manage_search"} size={12} />
              {mode === "quick" ? "Quick Health Check" : canDeepScan ? "Full Codebase Scan" : "Full Scan (Pro+)"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: "security", label: "Security Audit", desc: "OWASP patterns, secrets, injection" },
          { icon: "architecture", label: "Architecture", desc: "Patterns, structure, concerns" },
          { icon: "science", label: "Test Coverage", desc: "Coverage estimation and gaps" },
          { icon: "map", label: "Action Roadmap", desc: "Prioritized improvement plan" },
        ].map((f) => (
          <div key={f.label} className="p-3 rounded-2xl bg-surface-container/20 border border-outline-variant/8 space-y-1.5">
            <MaterialIcon name={f.icon} size={18} className="text-indigo-500/50" />
            <p className="text-[10px] font-black text-foreground/80">{f.label}</p>
            <p className="text-[9px] text-muted-foreground/40 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      {scanMode === "deep" && (
        <div className="p-4 rounded-2xl bg-violet-500/5 border border-violet-500/10 flex items-start gap-3">
          <MaterialIcon name="manage_search" size={16} className="shrink-0 mt-0.5 text-violet-400" />
          <div>
            <p className="text-xs font-black text-violet-400">Full Codebase Scan</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5 leading-relaxed">
              Reads key configuration files, README, and package manifests for deeper context. Uses 3× your hourly budget.
              {!allowsPrivateRepo && " Private repos require Professional plan."}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/5 border border-red-500/15">
          <MaterialIcon name="error" size={16} className="shrink-0 mt-0.5 text-red-400" />
          <p className="text-xs text-red-400 font-medium">{error}</p>
        </div>
      )}

      <button type="button" onClick={runScan}
        disabled={!targetRepo || !/^[\w.-]+\/[\w.-]+$/.test(targetRepo)}
        className={cn(
          "w-full py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2",
          targetRepo && /^[\w.-]+\/[\w.-]+$/.test(targetRepo)
            ? "bg-indigo-500 text-white hover:bg-indigo-600 shadow-xl shadow-indigo-500/20"
            : "bg-surface-container-highest text-muted-foreground/40 cursor-not-allowed"
        )}>
        <MaterialIcon name="radar" size={16} />
        {scanMode === "deep" ? "Launch Full Codebase Scan" : "Launch Quick Health Scan"}
      </button>
    </div>
  );
}
