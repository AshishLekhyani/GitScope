"use client";

import { useState, useRef, useCallback } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { getCsrfToken } from "@/lib/csrf-client";
import type { CodeReviewResult, CodeReviewFinding } from "@/app/api/ai/code-review/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VERDICT_CONFIG = {
  APPROVE: {
    icon: "check_circle",
    label: "Safe to Merge",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    text: "text-emerald-400",
    glow: "shadow-emerald-500/20",
    dot: "bg-emerald-400",
  },
  REQUEST_CHANGES: {
    icon: "cancel",
    label: "Changes Required",
    bg: "bg-red-500/10 border-red-500/30",
    text: "text-red-400",
    glow: "shadow-red-500/20",
    dot: "bg-red-400",
  },
  COMMENT: {
    icon: "comment",
    label: "Needs Discussion",
    bg: "bg-amber-500/10 border-amber-500/30",
    text: "text-amber-400",
    glow: "shadow-amber-500/20",
    dot: "bg-amber-400",
  },
} as const;

const SEVERITY_STYLE = {
  critical: { bg: "bg-red-500/8 border-red-500/25", text: "text-red-400", icon: "emergency_home", badge: "bg-red-500/15 text-red-400" },
  high: { bg: "bg-orange-500/8 border-orange-500/25", text: "text-orange-400", icon: "error", badge: "bg-orange-500/15 text-orange-400" },
  medium: { bg: "bg-amber-500/8 border-amber-500/25", text: "text-amber-400", icon: "warning", badge: "bg-amber-500/15 text-amber-400" },
  low: { bg: "bg-surface-container/50 border-outline-variant/15", text: "text-muted-foreground", icon: "info", badge: "bg-surface-container-highest text-muted-foreground" },
} as const;

const CATEGORY_ICON: Record<string, string> = {
  security: "lock", performance: "speed", logic: "psychology",
  quality: "code_blocks", breaking: "warning_amber", testing: "science", style: "format_paint",
};

const FLAG_COLOR: Record<string, string> = {
  security: "bg-red-500/10 text-red-400 border-red-500/20",
  "security-fix": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "breaking-change": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  performance: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  deps: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  auth: "bg-red-500/10 text-red-400 border-red-500/20",
  database: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "api-contract": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "large-diff": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "test-coverage": "bg-teal-500/10 text-teal-400 border-teal-500/20",
  tests: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  middleware: "bg-stone-500/10 text-stone-400 border-stone-500/20",
  dependencies: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  config: "bg-stone-500/10 text-stone-400 border-stone-500/20",
  "logic-error": "bg-amber-500/10 text-amber-400 border-pink-500/20",
  style: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

function ScoreGauge({ label, score, colorClass }: { label: string; score: number; colorClass: string }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative size-16">
        <svg className="size-16 -rotate-90" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r={r} fill="none" strokeWidth="4"
            className="stroke-surface-container-highest" />
          <circle cx="28" cy="28" r={r} fill="none" strokeWidth="4"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            className={cn("transition-all duration-1000", colorClass)} />
        </svg>
        <span className={cn("absolute inset-0 flex items-center justify-center text-sm font-black", colorClass.replace("stroke-", "text-"))}>
          {score}
        </span>
      </div>
      <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 text-center leading-tight">{label}</span>
    </div>
  );
}

function FindingCard({ finding, defaultOpen = false }: { finding: CodeReviewFinding; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const sty = SEVERITY_STYLE[finding.severity];

  return (
    <div className={cn("rounded-none border transition-all", sty.bg)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-3 p-4 text-left"
      >
        <MaterialIcon name={sty.icon} size={16} className={cn("shrink-0 mt-0.5", sty.text)} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={cn("text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full", sty.badge)}>
              {finding.severity}
            </span>
            <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
              <MaterialIcon name={CATEGORY_ICON[finding.category] ?? "code"} size={10} />
              {finding.category}
            </span>
            {finding.file && (
              <span className="text-[9px] font-mono text-muted-foreground/40 ml-auto truncate max-w-[140px]">
                {finding.file.split("/").slice(-2).join("/")}
                {finding.line ? `:${finding.line}` : ""}
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-foreground/80 leading-snug line-clamp-2">
            {finding.description}
          </p>
        </div>
        <MaterialIcon
          name={open ? "expand_less" : "expand_more"}
          size={16}
          className="shrink-0 mt-0.5 text-muted-foreground/40"
        />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
          {finding.codeSnippet && (
            <pre className="text-[10px] font-mono bg-background/60 rounded-none p-3 overflow-x-auto text-muted-foreground border border-outline-variant/10">
              {finding.codeSnippet}
            </pre>
          )}
          <div className="flex items-start gap-2 p-3 rounded-none bg-amber-500/5 border border-amber-500/10">
            <MaterialIcon name="lightbulb" size={14} className="shrink-0 mt-0.5 text-amber-400" />
            <p className="text-[11px] text-foreground/75 leading-relaxed font-medium">{finding.suggestion}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface PRReviewerProps {
  selectedRepo: string | null;
  canDeepScan: boolean;
  allowsPrivateRepo: boolean;
}

type ScanState = "idle" | "scanning" | "done" | "error";

interface ProgressState {
  step: string;
  percent: number;
}

export function PRReviewer({ selectedRepo, canDeepScan, allowsPrivateRepo }: PRReviewerProps) {
  const [prInput, setPrInput] = useState("");
  const [repoInput, setRepoInput] = useState(selectedRepo ?? "");
  const [scanMode, setScanMode] = useState<"quick" | "deep">("quick");
  const [state, setState] = useState<ScanState>("idle");
  const [progress, setProgress] = useState<ProgressState>({ step: "", percent: 0 });
  const [result, setResult] = useState<CodeReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>("findings");
  const [severityFilter, setSeverityFilter] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
  const [findingsPage, setFindingsPage] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const parsePRInput = (input: string): { repo: string; prNumber: number } | null => {
    // github.com/owner/repo/pull/123
    const urlMatch = input.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
    if (urlMatch) return { repo: urlMatch[1], prNumber: parseInt(urlMatch[2], 10) };
    // owner/repo#123
    const shortMatch = input.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
    if (shortMatch) return { repo: shortMatch[1], prNumber: parseInt(shortMatch[2], 10) };
    // just a number (use repoInput)
    const numMatch = input.match(/^#?(\d+)$/);
    if (numMatch && repoInput) return { repo: repoInput, prNumber: parseInt(numMatch[1], 10) };
    return null;
  };

  const runReview = useCallback(async () => {
    const parsed = parsePRInput(prInput);
    if (!parsed) {
      setError("Enter a PR URL (github.com/owner/repo/pull/123), owner/repo#123, or just a number with a repo selected.");
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setState("scanning");
    setProgress({ step: "Initializing…", percent: 2 });
    setResult(null);
    setError(null);

    try {
      const csrfToken = await getCsrfToken();
      const res = await fetch("/api/ai/code-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          repo: parsed.repo,
          prNumber: parsed.prNumber,
          scanMode,
          analysisType: "pr",
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Review failed" }));
        throw new Error(err.error ?? "Review failed");
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
          } catch { /* skip malformed line */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState("error");
      setError(err instanceof Error ? err.message : "Review failed");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prInput, repoInput, scanMode]);

  const reset = () => {
    abortRef.current?.abort();
    setState("idle");
    setResult(null);
    setError(null);
    setProgress({ step: "", percent: 0 });
  };

  // ── Idle / Input state ──────────────────────────────────────────────────────
  if (state === "idle" || state === "error") {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="space-y-2">
          <div className="relative">
            <input
              value={prInput}
              onChange={(e) => setPrInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runReview()}
              placeholder="PR URL, owner/repo#123, or just a PR number…"
              className="w-full bg-surface-container/40 border border-outline-variant/15 rounded-none px-5 py-4 pr-14 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/40 transition-all"
            />
            {prInput && (
              <button
                type="button"
                onClick={() => setPrInput("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              >
                <MaterialIcon name="close" size={16} />
              </button>
            )}
          </div>

          {!selectedRepo && (
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="Repository (owner/repo) — optional if PR URL is pasted"
              className="w-full bg-surface-container/40 border border-outline-variant/15 rounded-none px-5 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/40 transition-all"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-surface-container/30 rounded-none border border-outline-variant/10">
            {(["quick", "deep"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setScanMode(mode)}
                disabled={mode === "deep" && !canDeepScan}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 rounded-none text-[10px] font-black uppercase tracking-wider transition-all",
                  scanMode === mode
                    ? "bg-amber-500 text-white shadow-md"
                    : "text-muted-foreground hover:text-foreground",
                  mode === "deep" && !canDeepScan && "opacity-40 cursor-not-allowed"
                )}
              >
                <MaterialIcon name={mode === "quick" ? "bolt" : "manage_search"} size={12} />
                {mode === "deep" && !canDeepScan ? `${mode} (Pro+)` : mode}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={runReview}
            disabled={!prInput.trim()}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-none text-[11px] font-black uppercase tracking-wider transition-all",
              prInput.trim()
                ? "bg-amber-500 text-white hover:bg-amber-600 shadow-xl shadow-amber-500/20"
                : "bg-surface-container-highest text-muted-foreground/40 cursor-not-allowed"
            )}
          >
            <MaterialIcon name="auto_awesome" size={14} />
            Analyze PR
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-3 p-4 rounded-none bg-red-500/5 border border-red-500/15">
            <MaterialIcon name="error" size={16} className="shrink-0 mt-0.5 text-red-400" />
            <p className="text-xs text-red-400 font-medium">{error}</p>
          </div>
        )}

        {!allowsPrivateRepo && (
          <div className="flex items-start gap-3 p-4 rounded-none bg-amber-500/5 border border-amber-500/10">
            <MaterialIcon name="lock" size={15} className="shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="text-xs font-black text-amber-400 mb-0.5">Private Repos</p>
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                Private repositories are available on Professional plan and above. Connect your GitHub account in Settings to enable access.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: "security", label: "Security Scan", desc: "OWASP Top 10 + secrets detection" },
            { icon: "valuables", label: "Value Assessment", desc: "Is this change worth merging?" },
            { icon: "warning_amber", label: "Breaking Changes", desc: "API, DB, and contract analysis" },
            { icon: "checklist", label: "Review Checklist", desc: "Personalized review guide" },
          ].map((f) => (
            <div key={f.label} className="p-3 rounded-none bg-surface-container/20 border border-outline-variant/8 space-y-1.5">
              <MaterialIcon name={f.icon} size={18} className="text-amber-500/60" />
              <p className="text-[10px] font-black text-foreground/80">{f.label}</p>
              <p className="text-[9px] text-muted-foreground/50 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Scanning state ──────────────────────────────────────────────────────────
  if (state === "scanning") {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-8 animate-in fade-in duration-500">
        <div className="relative">
          <div className="size-24 rounded-none bg-amber-500/5 border border-amber-500/15 flex items-center justify-center">
            <MaterialIcon name="auto_awesome" size={40} className="text-amber-500/60 animate-pulse" />
          </div>
          <div className="absolute inset-0 rounded-none border-2 border-amber-500/20 animate-ping" />
        </div>

        <div className="w-full max-w-sm space-y-3 text-center">
          <p className="text-sm font-black text-foreground/80">{progress.step}</p>
          <div className="h-1.5 w-full rounded-full bg-surface-container-highest overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-500 ease-out"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">
            {progress.percent}% complete
          </p>
        </div>

        <button
          type="button"
          onClick={reset}
          className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 hover:text-muted-foreground transition-colors flex items-center gap-1.5"
        >
          <MaterialIcon name="stop" size={12} />
          Cancel
        </button>
      </div>
    );
  }

  // ── Results state ───────────────────────────────────────────────────────────
  if (state === "done" && result) {
    const vcfg = VERDICT_CONFIG[result.verdict];
    const criticalCount = result.findings.filter((f) => f.severity === "critical").length;
    const highCount = result.findings.filter((f) => f.severity === "high").length;

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">

        {/* ── Verdict banner ── */}
        <div className={cn(
          "relative overflow-hidden rounded-none border p-6 shadow-2xl",
          vcfg.bg, vcfg.glow
        )}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <div className={cn("size-16 rounded-none flex items-center justify-center border shrink-0", vcfg.bg)}>
              <MaterialIcon name={vcfg.icon} size={32} className={vcfg.text} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h3 className={cn("text-2xl font-black uppercase tracking-tight", vcfg.text)}>
                  {vcfg.label}
                </h3>
                <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full bg-background/40 text-muted-foreground border border-outline-variant/20">
                  {result.confidence}% confidence
                </span>
                {result.isDemo && (
                  <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                    Preview
                  </span>
                )}
              </div>
              <p className="text-xs text-foreground/70 leading-relaxed max-w-xl">{result.summary}</p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className={cn("text-4xl font-black", vcfg.text)}>
                {Math.round((result.scores.security + result.scores.value + result.scores.quality) / 3)}
              </div>
              <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Overall Score</div>
            </div>
          </div>

          {/* Merge risk badge */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={cn(
              "text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border",
              result.mergeRisk === "critical" ? "bg-red-500/15 text-red-400 border-red-500/20" :
              result.mergeRisk === "high" ? "bg-orange-500/15 text-orange-400 border-orange-500/20" :
              result.mergeRisk === "medium" ? "bg-amber-500/15 text-amber-400 border-amber-500/20" :
              "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
            )}>
              Merge Risk: {result.mergeRisk}
            </span>
            {result.flags.map((f) => (
              <span key={f} className={cn("text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border",
                FLAG_COLOR[f] ?? "bg-muted text-muted-foreground border-outline-variant/20"
              )}>
                {f.replace(/-/g, " ")}
              </span>
            ))}
          </div>
        </div>

        {/* ── Score gauges ── */}
        <div className="rounded-none border border-outline-variant/10 bg-surface-container/20 p-5">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mb-5 flex items-center gap-1.5">
            <MaterialIcon name="bar_chart" size={12} /> Analysis Dimensions
          </p>
          <div className="flex flex-wrap justify-around gap-4">
            <ScoreGauge label="Security" score={result.scores.security} colorClass={result.scores.security >= 70 ? "stroke-emerald-400 text-emerald-400" : result.scores.security >= 40 ? "stroke-amber-400 text-amber-400" : "stroke-red-400 text-red-400"} />
            <ScoreGauge label="Value" score={result.scores.value} colorClass="stroke-amber-400 text-amber-400" />
            <ScoreGauge label="Quality" score={result.scores.quality} colorClass={result.scores.quality >= 70 ? "stroke-emerald-400 text-emerald-400" : result.scores.quality >= 50 ? "stroke-amber-400 text-amber-400" : "stroke-red-400 text-red-400"} />
            <ScoreGauge label="Test Coverage" score={result.scores.testCoverage} colorClass={result.scores.testCoverage >= 70 ? "stroke-teal-400 text-teal-400" : result.scores.testCoverage >= 40 ? "stroke-amber-400 text-amber-400" : "stroke-orange-400 text-orange-400"} />
            <ScoreGauge label="Breaking Risk" score={result.scores.breakingRisk} colorClass={result.scores.breakingRisk <= 30 ? "stroke-emerald-400 text-emerald-400" : result.scores.breakingRisk <= 60 ? "stroke-amber-400 text-amber-400" : "stroke-red-400 text-red-400"} />
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Files Changed", value: result.diffStats.fileCount, icon: "folder", color: "text-amber-400" },
            { label: "Lines Added", value: `+${result.diffStats.additions}`, icon: "add", color: "text-emerald-400" },
            { label: "Lines Removed", value: `-${result.diffStats.deletions}`, icon: "remove", color: "text-red-400" },
            { label: "Est. Review", value: result.estimatedReviewTime, icon: "schedule", color: "text-amber-400" },
          ].map((s) => (
            <div key={s.label} className="rounded-none border border-outline-variant/10 bg-surface-container/20 p-4 text-center">
              <MaterialIcon name={s.icon} size={16} className={cn("mx-auto mb-2", s.color)} />
              <div className={cn("text-lg font-black", s.color)}>{s.value}</div>
              <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/50 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Collapsible sections ── */}
        {/* Findings */}
        {result.findings.length > 0 && (() => {
          const SEVERITIES = ["all", "critical", "high", "medium", "low"] as const;
          const SEV_STYLE: Record<string, string> = {
            all:      "bg-amber-500/20 text-amber-400 border-amber-500/30",
            critical: "bg-red-500/20 text-red-400 border-red-500/30",
            high:     "bg-orange-500/20 text-orange-400 border-orange-500/30",
            medium:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
            low:      "bg-surface-container text-muted-foreground border-outline-variant/30",
          };
          const filtered = severityFilter === "all"
            ? result.findings
            : result.findings.filter((f) => f.severity === severityFilter);
          const PAGE_SIZE = 5;
          const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
          const page = Math.min(findingsPage, pageCount - 1);
          const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

          return (
            <Section
              id="findings"
              title={`Findings (${result.findings.length})`}
              subtitle={`${criticalCount} critical · ${highCount} high`}
              icon="bug_report"
              badgeColor={criticalCount > 0 ? "text-red-400 bg-red-500/10 border-red-500/15" : "text-amber-400 bg-amber-500/10 border-amber-500/15"}
              expanded={expandedSection === "findings"}
              onToggle={() => setExpandedSection((s) => s === "findings" ? null : "findings")}
            >
              {/* Severity filter chips */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {SEVERITIES.map((sev) => {
                  const count = sev === "all"
                    ? result.findings.length
                    : result.findings.filter((f) => f.severity === sev).length;
                  if (count === 0 && sev !== "all") return null;
                  return (
                    <button
                      key={sev}
                      type="button"
                      aria-label={`Filter by ${sev}`}
                      onClick={() => { setSeverityFilter(sev); setFindingsPage(0); }}
                      className={cn(
                        "flex items-center gap-1 px-3 py-1 rounded-none text-[9px] font-black uppercase tracking-wider border transition-all",
                        severityFilter === sev
                          ? SEV_STYLE[sev]
                          : "bg-surface-container/40 text-muted-foreground/50 border-outline-variant/10 hover:border-outline-variant/25"
                      )}
                    >
                      {sev === "all" ? "All" : sev}
                      <span className="opacity-60">({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Findings list */}
              {filtered.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground/40 py-6">
                  No {severityFilter} findings
                </p>
              ) : (
                <div className="space-y-2">
                  {visible.map((f, i) => (
                    <FindingCard key={`${page}-${i}`} finding={f} defaultOpen={f.severity === "critical"} />
                  ))}
                </div>
              )}

              {/* Pagination */}
              {pageCount > 1 && (
                <div className="flex items-center justify-between pt-3 mt-1 border-t border-outline-variant/10">
                  <span className="text-[9px] font-mono text-muted-foreground/40">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Previous page"
                      onClick={() => setFindingsPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="p-1.5 rounded-none hover:bg-surface-container transition-colors disabled:opacity-30"
                    >
                      <MaterialIcon name="chevron_left" size={14} className="text-muted-foreground" />
                    </button>
                    {Array.from({ length: pageCount }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={`Page ${i + 1}`}
                        onClick={() => setFindingsPage(i)}
                        className={cn(
                          "size-6 rounded-none text-[9px] font-black transition-all",
                          page === i ? "bg-amber-500 text-white" : "text-muted-foreground hover:bg-surface-container"
                        )}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label="Next page"
                      onClick={() => setFindingsPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={page === pageCount - 1}
                      className="p-1.5 rounded-none hover:bg-surface-container transition-colors disabled:opacity-30"
                    >
                      <MaterialIcon name="chevron_right" size={14} className="text-muted-foreground" />
                    </button>
                  </div>
                </div>
              )}
            </Section>
          );
        })()}

        {/* Security issues */}
        {result.securityIssues.length > 0 && (
          <Section
            id="security"
            title="Security Issues"
            subtitle={`${result.securityIssues.length} concern${result.securityIssues.length > 1 ? "s" : ""}`}
            icon="security"
            badgeColor="text-red-400 bg-red-500/10 border-red-500/15"
            expanded={expandedSection === "security"}
            onToggle={() => setExpandedSection((s) => s === "security" ? null : "security")}
          >
            <ul className="space-y-2">
              {result.securityIssues.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-red-400/80 font-medium leading-relaxed">
                  <MaterialIcon name="shield" size={14} className="shrink-0 mt-0.5" />
                  {s}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Breaking changes */}
        {result.breakingChanges.length > 0 && (
          <Section
            id="breaking"
            title="Breaking Changes"
            subtitle={`${result.breakingChanges.length} detected`}
            icon="warning_amber"
            badgeColor="text-orange-400 bg-orange-500/10 border-orange-500/15"
            expanded={expandedSection === "breaking"}
            onToggle={() => setExpandedSection((s) => s === "breaking" ? null : "breaking")}
          >
            <ul className="space-y-2">
              {result.breakingChanges.map((bc, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-orange-400/80 font-medium leading-relaxed">
                  <MaterialIcon name="arrow_right" size={14} className="shrink-0 mt-0.5" />
                  {bc}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Positives */}
        {result.positives.length > 0 && (
          <Section
            id="positives"
            title="What's Good"
            subtitle={`${result.positives.length} strength${result.positives.length > 1 ? "s" : ""}`}
            icon="thumb_up"
            badgeColor="text-emerald-400 bg-emerald-500/10 border-emerald-500/15"
            expanded={expandedSection === "positives"}
            onToggle={() => setExpandedSection((s) => s === "positives" ? null : "positives")}
          >
            <ul className="space-y-2">
              {result.positives.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-emerald-400/80 font-medium leading-relaxed">
                  <MaterialIcon name="check_circle" size={14} className="shrink-0 mt-0.5" />
                  {p}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Recommendation */}
        <div className="p-5 rounded-none bg-amber-500/5 border border-amber-500/15 space-y-2">
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-amber-400">
            <MaterialIcon name="recommend" size={13} />
            AI Recommendation
          </div>
          <p className="text-sm font-medium text-foreground/85 leading-relaxed">{result.recommendation}</p>
        </div>

        {/* Review checklist */}
        {result.reviewChecklist.length > 0 && (
          <Section
            id="checklist"
            title="Review Checklist"
            subtitle={`${result.reviewChecklist.length} items`}
            icon="checklist"
            badgeColor="text-amber-400 bg-amber-500/10 border-amber-500/15"
            expanded={expandedSection === "checklist"}
            onToggle={() => setExpandedSection((s) => s === "checklist" ? null : "checklist")}
          >
            <ul className="space-y-2">
              {result.reviewChecklist.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-xs text-foreground/70 leading-relaxed">
                  <span className="size-5 shrink-0 mt-0.5 rounded-none border border-outline-variant/20 flex items-center justify-center text-[8px] font-black text-muted-foreground/40">
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Hot files + impact */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {result.diffStats.hotFiles.length > 0 && (
            <div className="p-4 rounded-none bg-surface-container/20 border border-outline-variant/10 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                <MaterialIcon name="local_fire_department" size={12} className="text-orange-400" /> Hot Files
              </p>
              <div className="space-y-1.5">
                {result.diffStats.hotFiles.map((f) => (
                  <div key={f} className="text-[10px] font-mono text-muted-foreground/70 bg-surface-container-highest px-3 py-1.5 rounded-none border border-outline-variant/10 truncate">
                    {f}
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.affectedSystems.length > 0 && (
            <div className="p-4 rounded-none bg-surface-container/20 border border-outline-variant/10 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                <MaterialIcon name="hub" size={12} className="text-amber-400" /> Affected Systems
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.affectedSystems.map((s) => (
                  <span key={s} className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500/8 border border-amber-500/15 text-amber-400">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Model / reset */}
        <div className="flex items-center justify-between pt-2 border-t border-outline-variant/10">
          <span className="text-[9px] font-mono text-muted-foreground/30">
            {result.isDemo ? "preview mode — connect Anthropic API key for live analysis" : `analyzed with ${result.model}`}
          </span>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 rounded-none bg-amber-500/10 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest text-amber-400 hover:bg-amber-500 hover:text-white hover:border-amber-500 transition-all"
          >
            <MaterialIcon name="rate_review" size={13} />
            New Review
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ── Section helper ────────────────────────────────────────────────────────────

function Section({
  id, title, subtitle, icon, badgeColor, expanded, onToggle, children,
}: {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  badgeColor: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  void id;
  return (
    <div className="rounded-none border border-outline-variant/10 bg-surface-container/15 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-surface-container/30 transition-colors"
      >
        <MaterialIcon name={icon} size={16} className="text-muted-foreground/50 shrink-0" />
        <span className="flex-1 text-xs font-black">{title}</span>
        <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-full border", badgeColor)}>{subtitle}</span>
        <MaterialIcon name={expanded ? "expand_less" : "expand_more"} size={16} className="text-muted-foreground/40 shrink-0" />
      </button>
      {expanded && (
        <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {children}
        </div>
      )}
    </div>
  );
}
