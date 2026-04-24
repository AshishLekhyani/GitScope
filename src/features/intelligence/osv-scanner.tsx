"use client";

import { useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { getCsrfToken } from "@/lib/csrf-client";

interface OsvFinding {
  id: string;
  package: string;
  version: string;
  ecosystem: string;
  summary: string;
  severity: string;
  cvss?: string;
  fixedIn?: string[];
  url?: string;
}

interface OsvResult {
  repo: string;
  total: number;
  findings: OsvFinding[];
  scannedPackages: number;
  ecosystems: string[];
  model?: string;
}

const SEVERITY_META: Record<string, { label: string; bg: string; text: string; dot: string; order: number }> = {
  CRITICAL: { label: "Critical", bg: "bg-red-500/10",    text: "text-red-400",    dot: "bg-red-500",    order: 0 },
  HIGH:     { label: "High",     bg: "bg-orange-500/10", text: "text-orange-400", dot: "bg-orange-500", order: 1 },
  MEDIUM:   { label: "Medium",   bg: "bg-amber-500/10",  text: "text-amber-400",  dot: "bg-amber-500",  order: 2 },
  LOW:      { label: "Low",      bg: "bg-amber-500/10",   text: "text-amber-400",   dot: "bg-amber-500",   order: 3 },
  UNKNOWN:  { label: "Unknown",  bg: "bg-muted",         text: "text-muted-foreground", dot: "bg-muted-foreground", order: 4 },
};

function sev(s: string) {
  return SEVERITY_META[s?.toUpperCase()] ?? SEVERITY_META.UNKNOWN;
}

interface OsvScannerProps {
  selectedRepo: string | null;
}

export function OsvScanner({ selectedRepo }: OsvScannerProps) {
  const [repo, setRepo] = useState(selectedRepo ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OsvResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("ALL");

  const scan = async () => {
    const target = repo.trim();
    if (!target || loading) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const csrf = await getCsrfToken();
      const res = await fetch("/api/ai/osv-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ repo: target }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Scan failed"); return; }
      setResult(data);
    } catch { setError("Network error — please try again"); }
    finally { setLoading(false); }
  };

  const severities = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const filtered = result?.findings.filter(
    (f) => filter === "ALL" || f.severity.toUpperCase() === filter
  ) ?? [];

  const counts = result
    ? Object.fromEntries(
        severities.slice(1).map((s) => [
          s,
          result.findings.filter((f) => f.severity.toUpperCase() === s).length,
        ])
      )
    : {};

  return (
    <div className="space-y-6">
      {/* Input */}
      <div className="flex gap-2 sm:gap-3">
        <div className="relative flex-1">
          <MaterialIcon name="security" size={15} className="absolute left-3 sm:left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 pointer-events-none" />
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && scan()}
            placeholder="owner/repo"
            className="w-full bg-surface-container/40 border border-outline-variant/15 rounded-none pl-9 sm:pl-10 pr-3 sm:pr-4 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500/40 transition-all"
          />
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={loading || !repo.trim()}
          className="flex items-center gap-1.5 px-3 sm:px-5 py-3 rounded-none bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] sm:text-[11px] font-black uppercase tracking-wider transition-colors shrink-0"
        >
          {loading ? <MaterialIcon name="sync" size={14} className="animate-spin" /> : <MaterialIcon name="search" size={14} />}
          <span className="hidden sm:inline">{loading ? "Scanning…" : "Scan CVEs"}</span>
          <span className="sm:hidden">{loading ? "…" : "Scan"}</span>
        </button>
      </div>

      {/* Info strip */}
      {!result && !loading && !error && (
        <div className="flex items-start gap-3 p-4 rounded-none bg-rose-500/5 border border-rose-500/10">
          <MaterialIcon name="info" size={15} className="text-rose-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Scans the repo&apos;s package.json, requirements.txt, and go.mod against the{" "}
            <a href="https://osv.dev" target="_blank" rel="noopener noreferrer" className="text-rose-400 underline underline-offset-2">Google OSV database</a>{" "}
            — the same source used by GitHub&apos;s Dependabot. No AI quota consumed.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-none bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          <MaterialIcon name="error" size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center gap-4 py-16 rounded-none border border-outline-variant/10 bg-surface-container/20">
          <div className="relative size-14">
            <div className="absolute inset-0 rounded-full border-2 border-rose-500/20" />
            <div className="absolute inset-0 rounded-full border-2 border-rose-500 border-t-transparent animate-spin" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-black text-foreground/70">Querying OSV database…</p>
            <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest">Checking dependencies against {repo}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-5 animate-in fade-in duration-400">
          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {[
              { label: "CVEs Found",    value: result.total,            color: result.total > 0 ? "text-red-400" : "text-emerald-400" },
              { label: "Pkgs Scanned",  value: result.scannedPackages,  color: "text-foreground" },
              { label: "Critical/High", value: (counts.CRITICAL ?? 0) + (counts.HIGH ?? 0), color: ((counts.CRITICAL ?? 0) + (counts.HIGH ?? 0)) > 0 ? "text-orange-400" : "text-muted-foreground/40" },
              { label: "Ecosystems",    value: result.ecosystems.join(", ") || "—", color: "text-amber-400" },
            ].map((m) => (
              <div key={m.label} className="px-4 py-3 rounded-none bg-surface-container/30 border border-outline-variant/10 space-y-0.5">
                <p className={cn("text-lg font-black truncate", m.color)}>{m.value}</p>
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">{m.label}</p>
              </div>
            ))}
          </div>

          {result.total === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 rounded-none border border-emerald-500/20 bg-emerald-500/5 text-center">
              <MaterialIcon name="verified_user" size={36} className="text-emerald-400" />
              <p className="font-black text-emerald-400">No known CVEs found</p>
              <p className="text-xs text-muted-foreground/50 max-w-xs">
                {result.scannedPackages} packages scanned against the OSV database — all clean.
              </p>
            </div>
          ) : (
            <>
              {/* Severity filter */}
              <div className="flex gap-1 sm:gap-2 flex-wrap">
                {severities.map((s) => {
                  const meta = s === "ALL" ? null : sev(s);
                  const count = s === "ALL" ? result.total : (counts[s] ?? 0);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setFilter(s)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-none border text-[10px] font-black uppercase tracking-wider transition-all",
                        filter === s
                          ? "bg-foreground text-background border-foreground"
                          : "border-outline-variant/20 text-muted-foreground hover:border-outline-variant/40"
                      )}
                    >
                      {meta && <span className={cn("size-1.5 rounded-full", meta.dot)} />}
                      {s === "ALL" ? "All" : meta?.label} ({count})
                    </button>
                  );
                })}
              </div>

              {/* Findings list */}
              <div className="space-y-3">
                {filtered
                  .sort((a, b) => (sev(a.severity).order) - (sev(b.severity).order))
                  .map((f) => {
                    const meta = sev(f.severity);
                    return (
                      <div key={f.id} className="rounded-none border border-outline-variant/10 bg-surface-container/20 hover:border-outline-variant/20 transition-all overflow-hidden">
                        <div className="flex items-start gap-2 sm:gap-4 p-3 sm:p-4">
                          {/* Severity badge */}
                          <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-none border text-[9px] font-black uppercase tracking-widest shrink-0 mt-0.5", meta.bg, meta.text, "border-current/20")}>
                            <span className={cn("size-1.5 rounded-full", meta.dot)} />
                            {meta.label}
                          </div>

                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-start gap-2 flex-wrap">
                              <span className="font-mono text-xs font-black text-foreground/90">{f.package}</span>
                              <span className="font-mono text-[10px] text-muted-foreground/50">@{f.version}</span>
                              {f.ecosystem && (
                                <span className="text-[9px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-bold">{f.ecosystem}</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{f.summary}</p>
                            <div className="flex items-center gap-3 flex-wrap">
                              {f.cvss && (
                                <span className="text-[9px] font-mono font-bold text-muted-foreground/60">CVSS {f.cvss}</span>
                              )}
                              {f.fixedIn && f.fixedIn.length > 0 && (
                                <span className="text-[9px] font-bold text-emerald-400">
                                  Fixed in {f.fixedIn.join(", ")}
                                </span>
                              )}
                              {f.url && (
                                <a href={f.url} target="_blank" rel="noopener noreferrer"
                                  className="text-[9px] font-black text-amber-400 hover:underline flex items-center gap-1">
                                  <MaterialIcon name="open_in_new" size={10} />
                                  {f.id}
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
