"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { getCsrfToken } from "@/lib/csrf-client";
import type { CodeReviewResult } from "@/app/api/ai/code-review/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface GHCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  author?: { login: string; avatar_url: string };
  stats?: { additions: number; deletions: number };
}

const VERDICT_CONFIG = {
  APPROVE: { icon: "check_circle", label: "Clean Commit", text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
  REQUEST_CHANGES: { icon: "cancel", label: "Issues Found", text: "text-red-400", bg: "bg-red-500/10 border-red-500/25" },
  COMMENT: { icon: "comment", label: "Review Suggested", text: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/25" },
} as const;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Main component ────────────────────────────────────────────────────────────

interface CommitInspectorProps {
  selectedRepo: string | null;
  canDeepScan: boolean;
}

type ScanState = "idle" | "loading-commits" | "scanning" | "done" | "error";

export function CommitInspector({ selectedRepo, canDeepScan }: CommitInspectorProps) {
  const [repo, setRepo] = useState(selectedRepo ?? "");
  const [commits, setCommits] = useState<GHCommit[]>([]);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [shaInput, setShaInput] = useState("");
  const [scanMode, setScanMode] = useState<"quick" | "deep">("quick");
  const [state, setState] = useState<ScanState>("idle");
  const [progress, setProgress] = useState({ step: "", percent: 0 });
  const [result, setResult] = useState<CodeReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load recent commits when repo changes
  useEffect(() => {
    const target = selectedRepo ?? repo;
    if (!target || !/^[\w.-]+\/[\w.-]+$/.test(target)) {
      setCommits([]);
      return;
    }

    let cancelled = false;
    setLoadingCommits(true);
    fetch(`/api/github/proxy?path=/repos/${encodeURIComponent(target)}/commits?per_page=8`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: GHCommit[]) => {
        if (!cancelled) setCommits(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setCommits([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingCommits(false);
      });

    return () => { cancelled = true; };
  }, [selectedRepo, repo]);

  const runAnalysis = useCallback(async (sha: string, targetRepo: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setState("scanning");
    setProgress({ step: "Initializing…", percent: 2 });
    setResult(null);
    setError(null);
    setSelectedSha(sha);

    try {
      const csrfToken = await getCsrfToken();
      const res = await fetch("/api/ai/code-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          repo: targetRepo,
          commitSha: sha,
          scanMode,
          analysisType: "commit",
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error ?? "Analysis failed");
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
              result?: CodeReviewResult;
              error?: string;
            };
            if (data.type === "progress" && data.step) {
              setProgress({ step: data.step, percent: data.percent ?? 0 });
            } else if (data.type === "done") {
              if (data.error) {
                setState("error");
                setError(data.error);
              } else if (data.result) {
                setState("done");
                setResult(data.result);
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState("error");
      setError(err instanceof Error ? err.message : "Analysis failed");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanMode]);

  const handleManualSha = () => {
    const sha = shaInput.trim();
    const target = selectedRepo ?? repo;
    if (!sha || !target) return;
    runAnalysis(sha, target);
  };

  const reset = () => {
    abortRef.current?.abort();
    setState("idle");
    setResult(null);
    setError(null);
    setSelectedSha(null);
    setProgress({ step: "", percent: 0 });
  };

  const targetRepo = selectedRepo ?? repo;

  // ── Scanning state ────────────────────────────────────────────────────────
  if (state === "scanning") {
    const commit = commits.find((c) => c.sha === selectedSha);
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-6 animate-in fade-in duration-500">
        <div className="relative">
          <div className="size-20 rounded-3xl bg-indigo-500/5 border border-indigo-500/15 flex items-center justify-center">
            <MaterialIcon name="commit" size={36} className="text-indigo-500/60 animate-pulse" />
          </div>
          <div className="absolute inset-0 rounded-3xl border-2 border-indigo-500/20 animate-ping" />
        </div>
        {commit && (
          <div className="text-center space-y-1">
            <p className="text-xs font-mono text-muted-foreground/50">{selectedSha?.slice(0, 10)}</p>
            <p className="text-sm font-bold text-foreground/70 max-w-xs truncate">
              {commit.commit.message.split("\n")[0]}
            </p>
          </div>
        )}
        <div className="w-full max-w-xs space-y-2 text-center">
          <p className="text-xs font-black text-foreground/70">{progress.step}</p>
          <div className="h-1.5 w-full rounded-full bg-surface-container-highest overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
        <button type="button" onClick={reset}
          className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 hover:text-muted-foreground transition-colors flex items-center gap-1.5">
          <MaterialIcon name="stop" size={12} /> Cancel
        </button>
      </div>
    );
  }

  // ── Result state ────────────────────────────────────────────────────────────
  if (state === "done" && result) {
    const vcfg = VERDICT_CONFIG[result.verdict];
    const commit = commits.find((c) => c.sha === selectedSha);

    return (
      <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {commit && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-surface-container/30 border border-outline-variant/10">
            <MaterialIcon name="commit" size={18} className="text-indigo-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black truncate">{commit.commit.message.split("\n")[0]}</p>
              <p className="text-[9px] text-muted-foreground/50 font-mono mt-0.5">
                {selectedSha?.slice(0, 10)} · {commit.commit.author.name} · {timeAgo(commit.commit.author.date)}
              </p>
            </div>
          </div>
        )}

        <div className={cn("rounded-2xl border p-5 space-y-3", vcfg.bg)}>
          <div className="flex items-center gap-3">
            <MaterialIcon name={vcfg.icon} size={24} className={vcfg.text} />
            <h3 className={cn("text-xl font-black uppercase tracking-tight", vcfg.text)}>{vcfg.label}</h3>
            <span className="ml-auto text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-background/40 text-muted-foreground border border-outline-variant/20">
              {result.confidence}% confidence
            </span>
            {result.isDemo && (
              <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                Preview
              </span>
            )}
          </div>
          <p className="text-xs text-foreground/70 leading-relaxed">{result.summary}</p>
        </div>

        {/* Score mini-bars */}
        <div className="grid grid-cols-2 gap-2 p-4 rounded-2xl bg-surface-container/20 border border-outline-variant/10">
          {([
            ["Security", result.scores.security, result.scores.security >= 70 ? "bg-emerald-400" : result.scores.security >= 40 ? "bg-amber-400" : "bg-red-400"],
            ["Value", result.scores.value, "bg-indigo-400"],
            ["Quality", result.scores.quality, result.scores.quality >= 70 ? "bg-emerald-400" : result.scores.quality >= 50 ? "bg-amber-400" : "bg-red-400"],
            ["Breaking Risk", result.scores.breakingRisk, result.scores.breakingRisk <= 30 ? "bg-emerald-400" : result.scores.breakingRisk <= 60 ? "bg-amber-400" : "bg-red-400"],
          ] as [string, number, string][]).map(([label, score, color]) => (
            <div key={label} className="space-y-1.5">
              <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
                <span className="text-muted-foreground/50">{label}</span>
                <span className="text-foreground/70">{score}</span>
              </div>
              <div className="h-1 w-full rounded-full bg-surface-container-highest overflow-hidden">
                <div className={cn("h-full rounded-full transition-all duration-700", color)} style={{ width: `${score}%` }} />
              </div>
            </div>
          ))}
        </div>

        {/* Findings */}
        {result.findings.length > 0 && (
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5 px-1">
              <MaterialIcon name="bug_report" size={12} /> Findings ({result.findings.length})
            </p>
            {result.findings.map((f, i) => {
              const sty = { critical: "border-red-500/25 bg-red-500/8 text-red-400", high: "border-orange-500/25 bg-orange-500/8 text-orange-400", medium: "border-amber-500/25 bg-amber-500/8 text-amber-400", low: "border-outline-variant/15 bg-surface-container/30 text-muted-foreground" }[f.severity];
              return (
                <div key={i} className={cn("rounded-2xl border p-4 space-y-2", sty)}>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest opacity-80">{f.severity}</span>
                    <span className="opacity-40">·</span>
                    <span className="text-[9px] font-black uppercase tracking-widest opacity-60">{f.category}</span>
                    {f.file && <span className="ml-auto text-[9px] font-mono opacity-40 truncate max-w-[120px]">{f.file.split("/").slice(-1)[0]}</span>}
                  </div>
                  <p className="text-xs font-medium leading-snug opacity-90">{f.description}</p>
                  <div className="flex items-start gap-1.5 pt-1.5 border-t border-current/10">
                    <MaterialIcon name="lightbulb" size={11} className="shrink-0 mt-0.5 opacity-60" />
                    <p className="text-[10px] opacity-70 leading-relaxed">{f.suggestion}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Recommendation */}
        <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400 flex items-center gap-1.5">
            <MaterialIcon name="recommend" size={12} /> Recommendation
          </p>
          <p className="text-xs text-foreground/75 font-medium leading-relaxed">{result.recommendation}</p>
        </div>

        <div className="flex justify-end pt-2 border-t border-outline-variant/10">
          <button type="button" onClick={reset}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 hover:text-indigo-400 transition-colors">
            <MaterialIcon name="refresh" size={12} /> Inspect Another
          </button>
        </div>
      </div>
    );
  }

  // ── Idle state ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {!selectedRepo && (
        <div className="space-y-2">
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="Repository (owner/repo)"
            className="w-full bg-surface-container/40 border border-outline-variant/15 rounded-2xl px-5 py-3.5 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
          />
        </div>
      )}

      {/* Scan mode */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 p-1 bg-surface-container/30 rounded-xl border border-outline-variant/10">
          {(["quick", "deep"] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => setScanMode(mode)}
              disabled={mode === "deep" && !canDeepScan}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                scanMode === mode ? "bg-indigo-500 text-white" : "text-muted-foreground hover:text-foreground",
                mode === "deep" && !canDeepScan && "opacity-40 cursor-not-allowed"
              )}>
              <MaterialIcon name={mode === "quick" ? "bolt" : "manage_search"} size={11} />
              {mode === "deep" && !canDeepScan ? `${mode} (Pro+)` : mode}
            </button>
          ))}
        </div>
        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">Scan Depth</span>
      </div>

      {/* Manual SHA input */}
      <div className="flex gap-2">
        <input
          value={shaInput}
          onChange={(e) => setShaInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleManualSha()}
          placeholder="Paste a commit SHA to inspect it directly…"
          className="flex-1 bg-surface-container/40 border border-outline-variant/15 rounded-2xl px-4 py-3 text-sm font-mono placeholder:font-sans placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
        />
        <button type="button" onClick={handleManualSha}
          disabled={!shaInput.trim() || !targetRepo}
          className={cn(
            "px-5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5",
            shaInput.trim() && targetRepo
              ? "bg-indigo-500 text-white hover:bg-indigo-600"
              : "bg-surface-container-highest text-muted-foreground/40 cursor-not-allowed"
          )}>
          <MaterialIcon name="search" size={14} /> Inspect
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/5 border border-red-500/15">
          <MaterialIcon name="error" size={16} className="shrink-0 mt-0.5 text-red-400" />
          <p className="text-xs text-red-400 font-medium">{error}</p>
        </div>
      )}

      {/* Recent commits list */}
      {targetRepo && (
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 px-1 flex items-center gap-1.5">
            <MaterialIcon name="history" size={12} /> Recent Commits
            {loadingCommits && <span className="size-3 rounded-full border-2 border-current border-t-transparent animate-spin ml-1" />}
          </p>

          {!loadingCommits && commits.length === 0 && (
            <p className="text-xs text-muted-foreground/40 py-6 text-center">
              {targetRepo ? "No commits found or access denied." : "Enter a repository above to load recent commits."}
            </p>
          )}

          <div className="space-y-1.5">
            {commits.map((commit) => (
              <button
                key={commit.sha}
                type="button"
                onClick={() => runAnalysis(commit.sha, targetRepo)}
                className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-surface-container/25 border border-outline-variant/8 hover:bg-surface-container/50 hover:border-indigo-500/20 transition-all group text-left"
              >
                <div className="size-8 rounded-xl bg-surface-container-highest flex items-center justify-center shrink-0 group-hover:bg-indigo-500/10 transition-colors">
                  <MaterialIcon name="commit" size={16} className="text-muted-foreground/40 group-hover:text-indigo-400 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground/80 truncate leading-tight">
                    {commit.commit.message.split("\n")[0]}
                  </p>
                  <p className="text-[9px] text-muted-foreground/50 font-mono mt-0.5">
                    {commit.sha.slice(0, 8)} · {commit.commit.author.name} · {timeAgo(commit.commit.author.date)}
                  </p>
                </div>
                <MaterialIcon
                  name="auto_awesome"
                  size={14}
                  className="shrink-0 text-muted-foreground/20 group-hover:text-indigo-400 transition-colors"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
