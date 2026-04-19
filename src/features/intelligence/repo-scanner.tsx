"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { getCsrfToken } from "@/lib/csrf-client";
import type { RepoScanResult, RepoScanFinding } from "@/app/api/ai/repo-scan/route";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";

// ── Radial ring gauge ─────────────────────────────────────────────────────────
function RingGauge({ score, size = 56 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color =
    score >= 80 ? "#10b981" :
    score >= 65 ? "#14b8a6" :
    score >= 50 ? "#f59e0b" :
    score >= 35 ? "#f97316" : "#ef4444";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${filled.toFixed(2)} ${circ.toFixed(2)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        opacity="0.9"
      />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle"
        fontSize="11" fontWeight="900" fill={color} fontFamily="monospace">{score}</text>
    </svg>
  );
}

// ── Horizontal bar chart (multi-category) ─────────────────────────────────────
function BarChart({ bars }: { bars: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="space-y-2">
      {bars.map((b) => (
        <div key={b.label} className="space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/50">{b.label}</span>
            <span className="text-[9px] font-black font-mono" style={{ color: b.color }}>{b.value}</span>
          </div>
          <div className="h-1 w-full rounded-full bg-surface-container-highest overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${(b.value / max) * 100}%`, backgroundColor: b.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Full trend chart: area fill, grid lines, axis labels ─────────────────────
function TrendChart({
  data,
  dates,
}: {
  data: number[];
  dates?: string[];
}) {
  if (data.length < 2) return null;

  const W = 400, H = 90;
  const PAD = { t: 10, r: 12, b: 22, l: 26 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  const rawMin = Math.min(...data);
  const rawMax = Math.max(...data);
  const lo = Math.max(0,   rawMin - 8);
  const hi = Math.min(100, rawMax + 8);
  const range = hi - lo || 1;

  const toX = (i: number) => PAD.l + (i / (data.length - 1)) * cW;
  const toY = (v: number) => PAD.t + cH - ((v - lo) / range) * cH;

  const latest = data[data.length - 1];
  const prev   = data[data.length - 2];
  const color  = latest >= prev ? "#10b981" : "#ef4444";

  const linePts = data.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const areaPts = [
    `${PAD.l},${(PAD.t + cH).toFixed(1)}`,
    linePts,
    `${(PAD.l + cW).toFixed(1)},${(PAD.t + cH).toFixed(1)}`,
  ].join(" ");

  // Date labels for first and last points
  const fmt = (d?: string) => d ? new Date(d).toLocaleDateString("en", { month: "short", day: "numeric" }) : "";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Horizontal grid at 25 / 50 / 75 */}
      {[25, 50, 75].map((y) => {
        if (y < lo || y > hi) return null;
        const cy = toY(y);
        return (
          <g key={y}>
            <line x1={PAD.l} y1={cy} x2={W - PAD.r} y2={cy}
              stroke="currentColor" strokeOpacity="0.07" strokeWidth="1" strokeDasharray="3 3" />
            <text x={PAD.l - 4} y={cy + 3} fontSize="6.5" fill="currentColor"
              fillOpacity="0.35" textAnchor="end" fontFamily="monospace">{y}</text>
          </g>
        );
      })}

      {/* Area fill */}
      <polygon points={areaPts} fill="url(#trendFill)" />

      {/* Line */}
      <polyline points={linePts} fill="none" stroke={color}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />

      {/* All dots */}
      {data.map((v, i) => {
        const isLast = i === data.length - 1;
        return (
          <circle key={i}
            cx={toX(i).toFixed(1)} cy={toY(v).toFixed(1)}
            r={isLast ? 4 : 2.5}
            fill={color}
            opacity={isLast ? 1 : 0.45}
          />
        );
      })}

      {/* Score callout on last point */}
      <text
        x={(toX(data.length - 1) + 6).toFixed(1)}
        y={(toY(latest) + 4).toFixed(1)}
        fontSize="8" fill={color} fontWeight="900" fontFamily="monospace"
      >{latest}</text>

      {/* X-axis date labels */}
      {dates && dates.length > 0 && (
        <>
          <text x={PAD.l} y={H - 2} fontSize="7" fill="currentColor"
            fillOpacity="0.3" textAnchor="middle" fontFamily="monospace">
            {fmt(dates[0])}
          </text>
          <text x={W - PAD.r} y={H - 2} fontSize="7" fill="currentColor"
            fillOpacity="0.3" textAnchor="end" fontFamily="monospace">
            {fmt(dates[dates.length - 1])}
          </text>
        </>
      )}
    </svg>
  );
}

// ── Multi-metric Recharts area chart ─────────────────────────────────────────

interface HistoryPoint {
  healthScore: number;
  securityScore: number;
  qualityScore: number;
  criticalCount: number;
  createdAt: string;
}

function MultiMetricChart({ history }: { history: HistoryPoint[] }) {
  const data = history.map((h) => ({
    date: new Date(h.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    Health:    h.healthScore,
    Security:  h.securityScore,
    Quality:   h.qualityScore,
    "Critical Issues": h.criticalCount,
  }));

  return (
    <div className="w-full h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gHealth"   x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gSecurity" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gQuality"  x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.08} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "currentColor", opacity: 0.4 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "currentColor", opacity: 0.4 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 11 }}
            labelStyle={{ fontWeight: 700, marginBottom: 4 }}
          />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
          <Area type="monotone" dataKey="Health"   stroke="#6366f1" strokeWidth={2} fill="url(#gHealth)"   dot={false} />
          <Area type="monotone" dataKey="Security" stroke="#10b981" strokeWidth={2} fill="url(#gSecurity)" dot={false} />
          <Area type="monotone" dataKey="Quality"  stroke="#3b82f6" strokeWidth={2} fill="url(#gQuality)"  dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function CveChart({ history }: { history: HistoryPoint[] }) {
  const data = history.map((h) => ({
    date: new Date(h.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    Critical: h.criticalCount,
  }));

  return (
    <div className="w-full h-32">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gCritical" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.08} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "currentColor", opacity: 0.4 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "currentColor", opacity: 0.4 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 11 }}
          />
          <Area type="monotone" dataKey="Critical" stroke="#ef4444" strokeWidth={2} fill="url(#gCritical)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

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

function FindingItem({ finding, fixDiffsAllowed = true, repo = "" }: { finding: RepoScanFinding; fixDiffsAllowed?: boolean; repo?: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveActionItem = async () => {
    if (saved || saving) return;
    setSaving(true);
    try {
      await fetch("/api/user/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo,
          title: finding.description.slice(0, 200),
          description: finding.description,
          suggestion: finding.suggestion,
          severity: finding.severity,
          category: finding.category,
          file: finding.file,
        }),
      });
      setSaved(true);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };
  const sev = (finding.severity in SEVERITY_STYLES ? finding.severity : "low") as keyof typeof SEVERITY_STYLES;
  const s = SEVERITY_STYLES[sev];
  const fileName = finding.file ? finding.file.split("/").slice(-1)[0] : null;
  const hasFix = !!finding.fix;
  const lang = finding.fix?.language ?? "typescript";

  return (
    <div className={cn("rounded-2xl border overflow-hidden bg-surface-container/25 dark:bg-surface-container/15", s.border)}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container/40 transition-colors">
        <span className={cn("size-2 rounded-full shrink-0 mt-px", s.dot)} />
        <span className={cn("text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0", s.badge)}>
          {finding.severity}
        </span>
        <p className="flex-1 text-[11px] font-semibold text-foreground/85 leading-snug line-clamp-2">{finding.description}</p>
        {hasFix && (
          <span className={cn(
            "text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded border shrink-0 hidden sm:flex items-center gap-1",
            fixDiffsAllowed
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
          )}>
            <MaterialIcon name={fixDiffsAllowed ? "code" : "lock"} size={9} />
            {fixDiffsAllowed ? "Fix" : "Pro"}
          </span>
        )}
        {fileName && (
          <span className="text-[9px] font-mono font-bold text-foreground/50 bg-surface-container-highest px-2 py-0.5 rounded border border-outline-variant/20 shrink-0 hidden sm:block max-w-[140px] truncate">
            {fileName}
          </span>
        )}
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

          {/* Suggestion text */}
          <div className={cn("flex items-start gap-2.5 p-3 rounded-xl border", s.expand)}>
            <MaterialIcon name="lightbulb" size={13} className={cn("shrink-0 mt-0.5", s.accent)} />
            <div>
              <p className={cn("text-[10px] font-black uppercase tracking-wider mb-1", s.accent)}>Suggested fix</p>
              <p className="text-xs text-foreground/75 leading-relaxed">{finding.suggestion}</p>
            </div>
          </div>

          {/* Actions row */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={saveActionItem}
              disabled={saved || saving}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all",
                saved
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                  : "border-outline-variant/20 text-muted-foreground/60 hover:border-indigo-500/30 hover:text-indigo-400 hover:bg-indigo-500/8"
              )}
            >
              <MaterialIcon name={saved ? "check_circle" : "add_task"} size={11} />
              {saved ? "Saved to Action Items" : saving ? "Saving…" : "Save as Action Item"}
            </button>

            {repo && (
              <a
                href={`https://github.com/${repo}/issues/new?${new URLSearchParams({
                  title: `[GitScope] ${finding.description.slice(0, 120)}`,
                  body: [
                    `**Category:** ${finding.category}`,
                    finding.file ? `**File:** \`${finding.file}\`` : "",
                    `**Severity:** ${finding.severity}`,
                    "",
                    "**Description:**",
                    finding.description,
                    "",
                    "**Suggested fix:**",
                    finding.suggestion,
                    "",
                    "_Found by [GitScope](https://git-scope-pi.vercel.app) static analysis_",
                  ].filter(Boolean).join("\n"),
                  labels: `bug,${finding.category}`,
                }).toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant/20 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 hover:border-rose-500/30 hover:text-rose-400 hover:bg-rose-500/8 transition-all"
              >
                <MaterialIcon name="bug_report" size={11} />
                Create Issue
              </a>
            )}
          </div>

          {/* Code diff — gated by plan */}
          {hasFix && (
            fixDiffsAllowed ? (
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 px-1 flex items-center gap-1.5">
                  <MaterialIcon name="code" size={11} /> Code Fix
                </p>
                {/* Before */}
                <div className="rounded-xl overflow-hidden border border-red-500/20">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/8 border-b border-red-500/15">
                    <span className="size-2 rounded-full bg-red-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-red-400">Before</span>
                    <span className="ml-auto text-[9px] font-mono text-red-400/50">{lang}</span>
                  </div>
                  <pre className="text-[10px] font-mono text-red-300/80 bg-red-500/5 px-4 py-3 overflow-x-auto leading-relaxed whitespace-pre-wrap">{finding.fix!.before}</pre>
                </div>
                {/* After */}
                <div className="rounded-xl overflow-hidden border border-emerald-500/20">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/8 border-b border-emerald-500/15">
                    <span className="size-2 rounded-full bg-emerald-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">After</span>
                    <span className="ml-auto text-[9px] font-mono text-emerald-400/50">{lang}</span>
                  </div>
                  <pre className="text-[10px] font-mono text-emerald-300/80 bg-emerald-500/5 px-4 py-3 overflow-x-auto leading-relaxed whitespace-pre-wrap">{finding.fix!.after}</pre>
                </div>
              </div>
            ) : (
              <div className="relative rounded-xl overflow-hidden border border-indigo-500/20">
                {/* Blurred preview of code */}
                <div className="select-none pointer-events-none blur-sm opacity-40 px-4 py-3 bg-surface-container/30 text-[10px] font-mono text-foreground/60 leading-relaxed">
                  <div className="text-red-400">- const result = eval(userInput);</div>
                  <div className="text-emerald-400">+ const result = safeEval(sanitize(userInput));</div>
                </div>
                {/* Upgrade overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-container/60 backdrop-blur-[2px]">
                  <MaterialIcon name="lock" size={16} className="text-indigo-400" />
                  <p className="text-[10px] font-black text-foreground/70">Code fixes require Professional plan</p>
                  <span className="text-[9px] font-black px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
                    Upgrade to unlock
                  </span>
                </div>
              </div>
            )
          )}
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
  fixDiffsAllowed?: boolean;
  scanHistoryDays?: number;
  scheduledScansAllowed?: boolean;
  customRulesAllowed?: boolean;
  multiBranchAllowed?: boolean;
  plan?: string;
}

type ScanState = "idle" | "scanning" | "done" | "error";

interface ScanHistoryEntry {
  id: string;
  healthScore: number;
  securityScore: number;
  qualityScore: number;
  performanceScore: number;
  criticalCount: number;
  highCount: number;
  scanMode: string;
  createdAt: string;
}

interface ScheduledScanRecord {
  id: string;
  repo: string;
  schedule: string;
  scanMode: string;
  alertOnDrop: number | null;
  alertEmail: string | null;
  lastRunAt: string | null;
  lastScore: number | null;
  nextRunAt: string;
  enabled: boolean;
}

interface CustomRule {
  id: string;
  name: string;
  description: string | null;
  pattern: string;
  fileGlob: string | null;
  severity: string;
  category: string;
  suggestion: string;
  enabled: boolean;
  hitCount: number;
}

function scanCacheKey(repo: string, mode: string, branch = "") {
  return `gitscope-scan-v1:${repo}:${mode}${branch ? `:${branch}` : ""}`;
}

export function RepoScanner({
  selectedRepo,
  canDeepScan,
  allowsPrivateRepo,
  fixDiffsAllowed = false,
  scanHistoryDays = 0,
  scheduledScansAllowed = false,
  customRulesAllowed = false,
  multiBranchAllowed = false,
  plan = "free",
}: RepoScannerProps) {
  const [repoInput, setRepoInput] = useState(selectedRepo ?? "");
  const [scanMode, setScanMode] = useState<"quick" | "deep">("quick");
  const [branch, setBranch] = useState("");
  const [state, setState] = useState<ScanState>("idle");
  const [progress, setProgress] = useState({ step: "", percent: 0 });
  const [result, setResult] = useState<RepoScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>("overview");
  const [secFilter, setSecFilter] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
  const [recsPage, setRecsPage] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // History state
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Benchmark state
  const [benchmark, setBenchmark] = useState<{
    p25: number; p50: number; p75: number; p90: number; sampleCount: number;
  } | null>(null);

  // Schedule state
  const [schedule, setSchedule] = useState<ScheduledScanRecord | null>(null);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [scheduleFreq, setScheduleFreq] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [scheduleAlertDrop, setScheduleAlertDrop] = useState<string>("10");
  const [scheduleAlertEmail, setScheduleAlertEmail] = useState<string>("");
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // Custom rules state
  const [rules, setRules] = useState<CustomRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [newRule, setNewRule] = useState({ name: "", pattern: "", suggestion: "", severity: "medium", category: "quality", fileGlob: "" });
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [scheduleSaved, setScheduleSaved] = useState(false);

  // Badge copy state
  const [badgeCopied, setBadgeCopied] = useState(false);

  // OSV CVE scanner state
  const [osvVulns, setOsvVulns] = useState<{
    id: string; package: string; version: string; ecosystem: string;
    summary: string; severity: "critical" | "high" | "medium" | "low";
    cvss?: string; fixedIn?: string[]; url?: string;
  }[] | null>(null);
  const [osvScanning, setOsvScanning] = useState(false);
  const [osvScanned, setOsvScanned] = useState(0);
  const [osvError, setOsvError] = useState<string | null>(null);
  const [osvSavedItems, setOsvSavedItems] = useState<Set<string>>(new Set());

  const targetRepo = selectedRepo ?? repoInput;

  // Load history when a repo is selected and user has access
  useEffect(() => {
    if (!targetRepo || scanHistoryDays === 0) return;
    setHistoryLoading(true);
    fetch(`/api/ai/scan-history?repo=${encodeURIComponent(targetRepo)}`)
      .then((r) => r.json())
      .then((d) => { if (d.history) setHistory(d.history); })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [targetRepo, scanHistoryDays]);

  // Load benchmark after a scan result arrives
  useEffect(() => {
    if (!result) return;
    fetch("/api/ai/benchmarks?metric=healthScore")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.benchmark) setBenchmark(d.benchmark); })
      .catch(() => {});
  }, [result?.healthScore]);

  // Load schedule when panel opens
  useEffect(() => {
    if (!showSchedulePanel || !targetRepo || !scheduledScansAllowed) return;
    fetch(`/api/ai/scheduled-scan?repo=${encodeURIComponent(targetRepo)}`)
      .then((r) => r.json())
      .then((d) => {
        const found = d.scheduled?.find((s: ScheduledScanRecord) => s.repo === targetRepo) ?? null;
        setSchedule(found);
        if (found) {
          setScheduleFreq(found.schedule as "daily" | "weekly" | "monthly");
          setScheduleAlertDrop(String(found.alertOnDrop ?? 10));
          setScheduleAlertEmail(found.alertEmail ?? "");
        }
      })
      .catch(() => {});
  }, [showSchedulePanel, targetRepo, scheduledScansAllowed]);

  // Load custom rules when tab is opened
  const loadRules = useCallback(() => {
    if (!customRulesAllowed) return;
    setRulesLoading(true);
    fetch("/api/ai/custom-rules")
      .then((r) => r.json())
      .then((d) => { if (d.rules) setRules(d.rules); })
      .catch(() => {})
      .finally(() => setRulesLoading(false));
  }, [customRulesAllowed]);

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
        body: JSON.stringify({ repo: targetRepo, scanMode, ...(branch.trim() ? { branch: branch.trim() } : {}) }),
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
                  sessionStorage.setItem(scanCacheKey(targetRepo, scanMode, branch.trim()), JSON.stringify(data.result));
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

  const saveSchedule = async () => {
    if (!targetRepo) return;
    setScheduleSaving(true);
    try {
      const csrfToken = await getCsrfToken();
      const res = await fetch("/api/ai/scheduled-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          repo: targetRepo,
          schedule: scheduleFreq,
          scanMode,
          alertOnDrop: scheduleAlertDrop ? parseInt(scheduleAlertDrop, 10) : null,
          alertEmail: scheduleAlertEmail || null,
        }),
      });
      const data = await res.json();
      if (data.scheduled) {
        setSchedule(data.scheduled);
        setScheduleSaved(true);
        setTimeout(() => { setShowSchedulePanel(false); setScheduleSaved(false); }, 1400);
      }
    } catch { /* ignore */ }
    setScheduleSaving(false);
  };

  const deleteSchedule = async () => {
    if (!targetRepo || !schedule) return;
    const csrfToken = await getCsrfToken();
    await fetch(`/api/ai/scheduled-scan?repo=${encodeURIComponent(targetRepo)}`, {
      method: "DELETE", headers: { "X-CSRF-Token": csrfToken },
    });
    setSchedule(null);
    setShowSchedulePanel(false);
  };

  const validatePattern = (p: string) => {
    if (!p) { setRuleError(null); return; }
    try { new RegExp(p); setRuleError(null); }
    catch (e) { setRuleError((e as Error).message.replace(/^Invalid regular expression: /, "")); }
  };

  const saveRule = async () => {
    if (ruleError) return;
    const csrfToken = await getCsrfToken();
    const res = await fetch("/api/ai/custom-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(newRule),
    });
    const data = await res.json();
    if (data.rule) {
      setRules((prev) => [data.rule, ...prev]);
      setNewRule({ name: "", pattern: "", suggestion: "", severity: "medium", category: "quality", fileGlob: "" });
      setRuleError(null);
      setShowRuleForm(false);
    } else if (data.error) {
      setRuleError(data.error);
    }
  };

  const deleteRule = async (id: string) => {
    const csrfToken = await getCsrfToken();
    await fetch(`/api/ai/custom-rules?id=${id}`, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken } });
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    const csrfToken = await getCsrfToken();
    const res = await fetch(`/api/ai/custom-rules?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();
    if (data.rule) setRules((prev) => prev.map((r) => r.id === id ? data.rule : r));
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
            <div className="h-full rounded-full bg-linear-to-r from-indigo-500 to-violet-500 transition-all duration-500"
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
      { id: "overview",  label: "Overview",     icon: "dashboard" },
      { id: "security",  label: "Security",     icon: "security" },
      { id: "quality",   label: "Quality",      icon: "code_blocks" },
      { id: "deps",      label: "Dependencies", icon: "account_tree" },
      { id: "osv",       label: "CVE Scan",     icon: "gpp_bad" },
      { id: "recs",      label: "Roadmap",      icon: "map" },
      { id: "history",   label: scanHistoryDays > 0 ? "History" : "History ✦", icon: "timeline" },
      ...(customRulesAllowed ? [{ id: "rules", label: "Custom Rules", icon: "rule" }] : []),
    ];

    return (
      <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">

        {/* Health score hero */}
        <div className="relative overflow-hidden rounded-3xl border border-indigo-500/20 bg-linear-to-br from-indigo-500/5 via-violet-500/5 to-transparent p-6">
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
            <div className="shrink-0 space-y-2.5 text-right">
              <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/30 truncate max-w-[160px]">{targetRepo}</div>
              {/* SBOM export */}
              {multiBranchAllowed && (
                <a
                  href={`/api/ai/sbom?repo=${encodeURIComponent(targetRepo)}${branch.trim() ? `&branch=${encodeURIComponent(branch.trim())}` : ""}`}
                  download
                  className="ml-auto flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-500/25 bg-emerald-500/8 text-emerald-400 text-[10px] font-black tracking-wide hover:bg-emerald-500/15 transition-all duration-200"
                >
                  <MaterialIcon name="download" size={14} />
                  <span>SBOM</span>
                </a>
              )}
              {/* Schedule button — prominent, clearly interactive */}
              {scheduledScansAllowed && (
                <button
                  type="button"
                  onClick={() => setShowSchedulePanel((v) => !v)}
                  className={cn(
                    "ml-auto flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-black tracking-wide transition-all duration-200",
                    showSchedulePanel
                      ? "bg-indigo-500 text-white border-indigo-500 shadow-lg shadow-indigo-500/30"
                      : schedule
                      ? "bg-linear-to-r from-indigo-500/20 to-violet-500/20 border-indigo-500/30 text-indigo-400 hover:from-indigo-500/30 hover:to-violet-500/30"
                      : "bg-surface-container border-outline-variant/20 text-foreground/60 hover:bg-indigo-500/10 hover:border-indigo-500/25 hover:text-indigo-400"
                  )}
                >
                  <MaterialIcon name={schedule ? "alarm_on" : "schedule"} size={14} className={schedule ? "text-indigo-400" : ""} />
                  <span>{schedule ? `Auto · ${schedule.schedule}` : "Schedule"}</span>
                  {schedule && (
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                </button>
              )}
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

        {/* Schedule panel */}
        {showSchedulePanel && scheduledScansAllowed && (
          <div className="rounded-3xl border border-indigo-500/25 bg-linear-to-br from-indigo-500/8 via-violet-500/5 to-transparent overflow-hidden animate-in fade-in slide-in-from-top-2 duration-250">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-indigo-500/15">
              <div className="flex items-center gap-2.5">
                <div className="size-7 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center">
                  <MaterialIcon name="schedule" size={14} className="text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs font-black text-foreground/85">Automated Scan Schedule</p>
                  {schedule
                    ? <p className="text-[9px] text-emerald-400/80 font-bold flex items-center gap-1">
                        <span className="size-1.5 rounded-full bg-emerald-400 inline-block" />
                        Active · next run {new Date(schedule.nextRunAt).toLocaleDateString()}
                      </p>
                    : <p className="text-[9px] text-muted-foreground/40">Not scheduled yet</p>
                  }
                </div>
              </div>
              <button type="button" aria-label="Close schedule panel"
                onClick={() => { setShowSchedulePanel(false); setScheduleSaved(false); }}
                className="size-7 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-surface-container-highest transition-colors flex items-center justify-center">
                <MaterialIcon name="close" size={15} />
              </button>
            </div>

            {/* Success state */}
            {scheduleSaved ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <div className="size-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                  <MaterialIcon name="check_circle" size={24} className="text-emerald-400" />
                </div>
                <p className="text-sm font-black text-emerald-400">Schedule saved!</p>
                <p className="text-[10px] text-muted-foreground/50">Closing…</p>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                {/* Frequency selector — visual cards */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mb-2">Scan frequency</p>
                  <div className="grid grid-cols-3 gap-1 sm:gap-2">
                    {(["daily", "weekly", "monthly"] as const).map((f) => (
                      <button key={f} type="button" onClick={() => setScheduleFreq(f)}
                        className={cn(
                          "py-2 sm:py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all",
                          scheduleFreq === f
                            ? "bg-indigo-500 text-white border-indigo-500 shadow-md shadow-indigo-500/20"
                            : "bg-surface-container/50 border-outline-variant/15 text-muted-foreground/60 hover:border-indigo-500/25 hover:text-foreground"
                        )}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Alert settings */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                      <MaterialIcon name="notifications_active" size={11} className="text-amber-400/70" />
                      Email me if score drops by
                    </label>
                    <div className="relative">
                      <input type="number" min="1" max="50" value={scheduleAlertDrop}
                        onChange={(e) => setScheduleAlertDrop(e.target.value)}
                        placeholder="10"
                        className="w-full bg-surface-container/60 border border-outline-variant/20 rounded-xl px-3 py-2.5 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground/40">pts</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                      <MaterialIcon name="mail" size={11} className="text-indigo-400/70" />
                      Alert email
                    </label>
                    <input type="email" value={scheduleAlertEmail}
                      onChange={(e) => setScheduleAlertEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full bg-surface-container/60 border border-outline-variant/20 rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all" />
                  </div>
                </div>

                {schedule?.lastScore !== null && schedule?.lastScore !== undefined && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container/40 border border-outline-variant/10">
                    <MaterialIcon name="history" size={13} className="text-muted-foreground/40 shrink-0" />
                    <span className="text-[10px] text-muted-foreground/50">
                      Last scan score: <span className="font-black text-foreground/70">{schedule.lastScore}</span>
                      {" · "}last run: <span className="font-bold text-foreground/60">{schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleDateString() : "never"}</span>
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={saveSchedule} disabled={scheduleSaving}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-linear-to-r from-indigo-500 to-violet-500 text-white text-[10px] font-black uppercase tracking-widest hover:from-indigo-600 hover:to-violet-600 transition-all shadow-md shadow-indigo-500/20 disabled:opacity-50">
                    <MaterialIcon name={scheduleSaving ? "sync" : "check"} size={13} className={scheduleSaving ? "animate-spin" : ""} />
                    {scheduleSaving ? "Saving…" : schedule ? "Update Schedule" : "Enable Schedule"}
                  </button>
                  {schedule && (
                    <button type="button" onClick={deleteSchedule}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-surface-container/60 border border-outline-variant/15 text-muted-foreground/60 text-[10px] font-black uppercase tracking-widest hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-all">
                      <MaterialIcon name="delete_outline" size={13} /> Remove
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Section tabs */}
        <div className="flex gap-1 p-1 bg-surface-container/30 rounded-2xl border border-outline-variant/10 overflow-x-auto scrollbar-none">
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
            {/* Score ring gauges */}
            <div className="p-5 rounded-2xl bg-surface-container/20 border border-outline-variant/10 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "Security",     score: result.security.score,     grade: result.security.grade },
                  { label: "Quality",      score: result.codeQuality.score,  grade: result.codeQuality.grade },
                  { label: "Testability",  score: result.testability.score,  grade: result.testability.grade },
                  { label: "Deps",         score: result.dependencies.score, grade: result.dependencies.score >= 80 ? "A" : result.dependencies.score >= 65 ? "B" : result.dependencies.score >= 50 ? "C" : "D" },
                ].map((d) => (
                  <div key={d.label} className="flex flex-col items-center gap-1.5">
                    <RingGauge score={d.score} size={60} />
                    <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/50">{d.label}</span>
                    <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded border", GRADE_STYLE[d.grade] ?? GRADE_STYLE.C)}>{d.grade}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-2 pt-1 border-t border-outline-variant/8">
                <ScoreBar label="Security" score={result.security.score} grade={result.security.grade} />
                <ScoreBar label="Code Quality" score={result.codeQuality.score} grade={result.codeQuality.grade} />
                <ScoreBar label="Testability" score={result.testability.score} grade={result.testability.grade} />
                <ScoreBar label="Dependencies" score={result.dependencies.score} grade={
                  result.dependencies.score >= 80 ? "A" : result.dependencies.score >= 65 ? "B" : result.dependencies.score >= 50 ? "C" : "D"
                } />
              </div>
            </div>

            {/* ── Benchmark comparison ── */}
            {benchmark && (() => {
              const score = result.healthScore;
              const pct = score >= benchmark.p90 ? 90 :
                          score >= benchmark.p75 ? 75 :
                          score >= benchmark.p50 ? 50 :
                          score >= benchmark.p25 ? 25 : 0;
              const label = pct >= 90 ? "Top 10%" : pct >= 75 ? "Top 25%" : pct >= 50 ? "Above Median" : pct >= 25 ? "Below Median" : "Bottom 25%";
              const labelColor = pct >= 75 ? "#10b981" : pct >= 50 ? "#14b8a6" : pct >= 25 ? "#f59e0b" : "#ef4444";
              const markers: { label: string; value: number }[] = [
                { label: "P25", value: benchmark.p25 },
                { label: "P50", value: benchmark.p50 },
                { label: "P75", value: benchmark.p75 },
                { label: "P90", value: benchmark.p90 },
              ];
              const min = Math.max(0, benchmark.p25 - 10);
              const max = Math.min(100, benchmark.p90 + 10);
              const range = max - min;
              const toX = (v: number) => `${((v - min) / range) * 100}%`;
              return (
                <div className="p-4 rounded-2xl bg-surface-container/20 border border-outline-variant/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                      <MaterialIcon name="leaderboard" size={12} /> vs Community
                    </p>
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full border" style={{ color: labelColor, borderColor: `${labelColor}40`, backgroundColor: `${labelColor}10` }}>
                      {label}
                    </span>
                  </div>
                  <div className="relative h-6">
                    {/* track */}
                    <div className="absolute inset-y-2 left-0 right-0 rounded-full bg-surface-container-highest overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: toX(benchmark.p75), background: "linear-gradient(90deg,#ef444430,#10b98130)" }} />
                    </div>
                    {/* markers */}
                    {markers.map((m) => (
                      <div key={m.label} className="absolute bottom-0 flex flex-col items-center" style={{ left: toX(m.value), transform: "translateX(-50%)" }}>
                        <div className="w-px h-2 bg-muted-foreground/30" />
                      </div>
                    ))}
                    {/* your score */}
                    <div className="absolute bottom-0 flex flex-col items-center z-10" style={{ left: toX(Math.min(max, Math.max(min, score))), transform: "translateX(-50%)" }}>
                      <div className="w-3 h-3 rounded-full border-2 border-background shadow-lg" style={{ backgroundColor: labelColor }} />
                    </div>
                  </div>
                  <div className="flex justify-between text-[8px] font-mono text-muted-foreground/40">
                    {markers.map((m) => (
                      <span key={m.label}>{m.label}·{m.value}</span>
                    ))}
                  </div>
                  <p className="text-[9px] text-muted-foreground/50">
                    Your score <span className="font-black text-foreground/70">{score}</span> vs community median <span className="font-black text-foreground/70">{benchmark.p50}</span> — based on {benchmark.sampleCount.toLocaleString()} scans
                  </p>
                </div>
              );
            })()}

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
                  filteredSecIssues.map((f, i) => <FindingItem key={i} finding={f} fixDiffsAllowed={fixDiffsAllowed} repo={targetRepo} />)
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
                {result.codeQuality.issues.map((f, i) => <FindingItem key={i} finding={f} fixDiffsAllowed={fixDiffsAllowed} repo={targetRepo} />)}
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
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

        {/* ── History tab ── */}
        {activeSection === "history" && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {scanHistoryDays === 0 ? (
              /* Free tier gate */
              <div className="flex flex-col items-center gap-4 py-12 text-center">
                <div className="size-16 rounded-3xl bg-indigo-500/8 border border-indigo-500/15 flex items-center justify-center">
                  <MaterialIcon name="timeline" size={28} className="text-indigo-500/50" />
                </div>
                <div>
                  <p className="text-sm font-black text-foreground/80">Health trend tracking</p>
                  <p className="text-xs text-muted-foreground/50 mt-1 max-w-xs mx-auto leading-relaxed">
                    Track your repo's health score over time. See exactly when and why it changed. Available on Professional plan and above.
                  </p>
                </div>
                <span className="text-[10px] font-black px-4 py-2 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                  Upgrade to Professional
                </span>
              </div>
            ) : historyLoading ? (
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground/40">
                <MaterialIcon name="sync" size={16} className="animate-spin" />
                <span className="text-xs">Loading history…</span>
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <MaterialIcon name="timeline" size={32} className="text-muted-foreground/20" />
                <p className="text-xs text-muted-foreground/40">No history yet — this is your first scan of this repo.</p>
              </div>
            ) : (
              <>
                {/* Multi-metric trend chart */}
                <div className="p-4 rounded-2xl bg-surface-container/20 border border-outline-variant/10 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                      <MaterialIcon name="show_chart" size={12} /> Score Trends
                    </p>
                    <span className="text-[9px] font-mono text-muted-foreground/40">{history.length} scans · {scanHistoryDays}d retention</span>
                  </div>
                  <MultiMetricChart history={history} />
                  {history.length >= 2 && (() => {
                    const first = history[0].healthScore;
                    const last  = history[history.length - 1].healthScore;
                    const delta = last - first;
                    const best  = Math.max(...history.map((h) => h.healthScore));
                    const worst = Math.min(...history.map((h) => h.healthScore));
                    return (
                      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-outline-variant/8">
                        <div className={cn("flex items-center gap-1.5 text-[10px] font-black",
                          delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-muted-foreground/50"
                        )}>
                          <MaterialIcon name={delta > 0 ? "trending_up" : delta < 0 ? "trending_down" : "trending_flat"} size={14} />
                          {delta > 0 ? `+${delta}` : delta} pts overall
                        </div>
                        <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/40">
                          <span className="text-emerald-400 font-black">{best}</span> peak
                        </div>
                        <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/40">
                          <span className="text-red-400 font-black">{worst}</span> low
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* CVE count trend */}
                {history.some((h) => h.criticalCount > 0) && (
                  <div className="p-4 rounded-2xl bg-surface-container/20 border border-outline-variant/10 space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                      <MaterialIcon name="bug_report" size={12} className="text-red-400" /> Critical Issues Over Time
                    </p>
                    <CveChart history={history} />
                  </div>
                )}

                {/* Latest scan sub-score breakdown */}
                {history.length > 0 && (() => {
                  const latest = history[history.length - 1];
                  return (
                    <div className="p-4 rounded-2xl bg-surface-container/20 border border-outline-variant/10 space-y-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                        <MaterialIcon name="bar_chart" size={12} /> Latest Scan Breakdown
                      </p>
                      <BarChart bars={[
                        { label: "Security",     value: latest.securityScore,    color: latest.securityScore    >= 70 ? "#10b981" : latest.securityScore    >= 50 ? "#f59e0b" : "#ef4444" },
                        { label: "Quality",      value: latest.qualityScore,     color: latest.qualityScore     >= 70 ? "#10b981" : latest.qualityScore     >= 50 ? "#f59e0b" : "#ef4444" },
                        { label: "Performance",  value: latest.performanceScore, color: latest.performanceScore >= 70 ? "#10b981" : latest.performanceScore >= 50 ? "#f59e0b" : "#ef4444" },
                        { label: "Health",       value: latest.healthScore,      color: latest.healthScore      >= 70 ? "#6366f1" : latest.healthScore      >= 50 ? "#8b5cf6" : "#ef4444" },
                      ]} />
                    </div>
                  );
                })()}

                {/* Scan log — enriched */}
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 px-1">Scan Log</p>
                  {[...history].reverse().map((h, idx, arr) => {
                    const scoreColor =
                      h.healthScore >= 80 ? "text-emerald-400" :
                      h.healthScore >= 65 ? "text-teal-400" :
                      h.healthScore >= 50 ? "text-amber-400" : "text-red-400";
                    const barColor =
                      h.healthScore >= 80 ? "bg-emerald-400" :
                      h.healthScore >= 65 ? "bg-teal-400" :
                      h.healthScore >= 50 ? "bg-amber-400" : "bg-red-400";
                    // Previous entry in the reversed list = next entry in chronological order
                    const prev = arr[idx + 1];
                    const delta = prev ? h.healthScore - prev.healthScore : null;
                    return (
                      <div key={h.id} className="rounded-2xl bg-surface-container/20 border border-outline-variant/8 overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-3">
                          {/* Score + delta */}
                          <div className="flex flex-col items-end shrink-0 w-12">
                            <span className={cn("text-xl font-black leading-none", scoreColor)}>{h.healthScore}</span>
                            {delta !== null && (
                              <span className={cn("text-[9px] font-black mt-0.5",
                                delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-muted-foreground/30"
                              )}>
                                {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : "─"}
                              </span>
                            )}
                          </div>

                          {/* Mini score bar + sub-scores */}
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="h-1 w-full rounded-full bg-surface-container-highest overflow-hidden">
                              <div className={cn("h-full rounded-full", barColor)} style={{ width: `${h.healthScore}%` }} />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-surface-container-highest text-muted-foreground/60 uppercase tracking-wider">{h.scanMode}</span>
                              {h.criticalCount > 0 && (
                                <span className="text-[9px] font-black text-red-400 flex items-center gap-0.5">
                                  <span className="size-1 rounded-full bg-red-400 inline-block" />
                                  {h.criticalCount}c
                                </span>
                              )}
                              {h.highCount > 0 && (
                                <span className="text-[9px] font-black text-orange-400 flex items-center gap-0.5">
                                  <span className="size-1 rounded-full bg-orange-400 inline-block" />
                                  {h.highCount}h
                                </span>
                              )}
                              <span className="text-[9px] font-mono text-muted-foreground/35 hidden sm:inline">
                                sec&nbsp;{h.securityScore} · qual&nbsp;{h.qualityScore} · perf&nbsp;{h.performanceScore}
                              </span>
                            </div>
                          </div>

                          {/* Date */}
                          <span className="text-[9px] font-mono text-muted-foreground/30 shrink-0">
                            {new Date(h.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── CVE / OSV Scan tab (Professional+) ── */}
        {activeSection === "osv" && (() => {
          const SEV_COLORS = {
            critical: { badge: "bg-red-500/15 border-red-500/30 text-red-400", dot: "bg-red-500" },
            high:     { badge: "bg-orange-500/15 border-orange-500/30 text-orange-400", dot: "bg-orange-500" },
            medium:   { badge: "bg-amber-500/15 border-amber-500/30 text-amber-400", dot: "bg-amber-500" },
            low:      { badge: "bg-blue-500/15 border-blue-500/30 text-blue-400", dot: "bg-blue-500" },
          } as const;

          const runOsv = async () => {
            if (!targetRepo || osvScanning) return;
            setOsvScanning(true);
            setOsvVulns(null);
            setOsvError(null);
            setOsvScanned(0);
            try {
              const res = await fetch("/api/ai/osv-scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repo: targetRepo }),
              });
              const data = await res.json();
              if (!res.ok) { setOsvError(data.error ?? "Scan failed"); return; }
              setOsvVulns(data.findings ?? []);
              setOsvScanned(data.scannedPackages ?? 0);
            } catch { setOsvError("Network error"); } finally { setOsvScanning(false); }
          };

          const critical = osvVulns?.filter((v) => v.severity === "critical").length ?? 0;
          const high      = osvVulns?.filter((v) => v.severity === "high").length ?? 0;
          const prodOnly  = osvVulns ?? [];

          return (
            <div className="space-y-4 animate-in fade-in duration-300">
              {!fixDiffsAllowed ? (
                <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-6 text-center space-y-3">
                  <MaterialIcon name="gpp_bad" size={28} className="text-indigo-400 mx-auto" />
                  <p className="font-black text-sm text-foreground">CVE Scanning requires Professional+</p>
                  <p className="text-xs text-muted-foreground">Check your dependencies against the Google OSV database for known vulnerabilities.</p>
                  <a href="/pricing-settings" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-xs font-black hover:bg-indigo-600 transition-colors">
                    <MaterialIcon name="upgrade" size={13} className="text-white" /> Upgrade Plan
                  </a>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Google OSV Database</p>
                      {osvScanned > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">{osvScanned} packages checked</p>
                      )}
                    </div>
                    <button type="button" onClick={runOsv} disabled={osvScanning}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-black uppercase tracking-widest text-indigo-400 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 transition-all disabled:opacity-50">
                      <MaterialIcon name={osvScanning ? "hourglass_top" : "radar"} size={13} />
                      {osvScanning ? "Scanning…" : osvVulns ? "Re-scan" : "Scan Dependencies"}
                    </button>
                  </div>

                  {osvError && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-400">{osvError}</div>
                  )}

                  {osvVulns && osvVulns.length === 0 && (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center space-y-2">
                      <MaterialIcon name="verified_user" size={28} className="text-emerald-400 mx-auto" />
                      <p className="font-black text-sm text-emerald-400">No known CVEs found</p>
                      <p className="text-xs text-muted-foreground">{osvScanned} packages checked — all clear against the OSV database.</p>
                    </div>
                  )}

                  {osvVulns && osvVulns.length > 0 && (
                    <>
                      {/* Stats strip */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                        {[
                          { label: "Total CVEs", count: osvVulns.length, color: "text-foreground" },
                          { label: "Critical / High", count: critical + high, color: critical + high > 0 ? "text-red-400" : "text-emerald-400" },
                          { label: "Production", count: prodOnly.length, color: prodOnly.length > 0 ? "text-orange-400" : "text-emerald-400" },
                        ].map((s) => (
                          <div key={s.label} className="rounded-2xl border border-outline-variant/15 bg-surface-container/30 p-3 text-center">
                            <p className={cn("text-2xl font-black", s.color)}>{s.count}</p>
                            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mt-0.5">{s.label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Findings list */}
                      <div className="space-y-2">
                        {osvVulns.map((v, i) => {
                          const sc = SEV_COLORS[v.severity];
                          const osvSavedKey = `${v.package}-${v.id}`;
                          const isSaved = osvSavedItems.has(osvSavedKey);
                          return (
                            <div key={i} className="rounded-xl border border-outline-variant/15 bg-surface-container/20 px-4 py-3 space-y-2">
                              <div className="flex items-start gap-3">
                                <span className={cn("size-2 rounded-full shrink-0 mt-1.5", sc.dot)} />
                                <div className="flex-1 min-w-0 space-y-0.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border", sc.badge)}>
                                      {v.severity}
                                    </span>
                                    <span className="text-[9px] font-mono font-bold text-foreground/70">{v.package}@{v.version}</span>
                                    {v.ecosystem && (
                                      <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40 border border-outline-variant/20 px-1.5 py-0.5 rounded">{v.ecosystem}</span>
                                    )}
                                    <a href={v.url} target="_blank" rel="noopener noreferrer"
                                      className="text-[8px] font-mono text-indigo-400/60 hover:text-indigo-400 transition-colors ml-auto shrink-0">
                                      {v.id} →
                                    </a>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground/70 leading-snug line-clamp-2">{v.summary}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 pl-5">
                                <button type="button"
                                  disabled={isSaved}
                                  onClick={async () => {
                                    if (isSaved) return;
                                    await fetch("/api/user/action-items", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        repo: targetRepo,
                                        title: `CVE: ${v.package}@${v.version} — ${v.id}`,
                                        description: v.summary,
                                        suggestion: `Upgrade ${v.package} to a patched version. See advisory: ${v.url}`,
                                        severity: v.severity,
                                        category: "security",
                                      }),
                                    });
                                    setOsvSavedItems((prev) => new Set([...prev, osvSavedKey]));
                                  }}
                                  className={cn(
                                    "flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all",
                                    isSaved
                                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                                      : "border-outline-variant/20 text-muted-foreground/50 hover:border-indigo-500/30 hover:text-indigo-400 hover:bg-indigo-500/8"
                                  )}
                                >
                                  <MaterialIcon name={isSaved ? "check_circle" : "add_task"} size={10} />
                                  {isSaved ? "Saved" : "Save as Action Item"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* ── Custom Rules tab (Team+) ── */}
        {activeSection === "rules" && customRulesAllowed && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
                {rules.length} custom rules
              </p>
              <button type="button" onClick={() => { setShowRuleForm((v) => !v); if (rules.length === 0) loadRules(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[9px] font-black uppercase tracking-widest hover:bg-indigo-500/20 transition-colors">
                <MaterialIcon name="add" size={12} /> New Rule
              </button>
            </div>

            {showRuleForm && (
              <div className="p-4 rounded-2xl bg-surface-container/30 border border-indigo-500/15 space-y-3 animate-in fade-in duration-150">
                <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400">New Custom Rule</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input value={newRule.name} onChange={(e) => setNewRule((r) => ({ ...r, name: e.target.value }))}
                    placeholder="Rule name" aria-label="Rule name"
                    className="bg-surface-container/60 border border-outline-variant/20 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                  <div className="space-y-1">
                    <input value={newRule.pattern}
                      onChange={(e) => { setNewRule((r) => ({ ...r, pattern: e.target.value })); validatePattern(e.target.value); }}
                      placeholder="Regex pattern (e.g. console\.log)" aria-label="Regex pattern"
                      className={cn(
                        "w-full font-mono bg-surface-container/60 border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 transition-all",
                        ruleError
                          ? "border-red-500/40 focus:ring-red-500/20 focus:border-red-500/50"
                          : "border-outline-variant/20 focus:ring-indigo-500/30"
                      )} />
                    {ruleError && (
                      <p className="text-[9px] text-red-400 font-mono px-1 flex items-center gap-1">
                        <MaterialIcon name="error_outline" size={10} /> {ruleError}
                      </p>
                    )}
                  </div>
                  <input value={newRule.fileGlob} onChange={(e) => setNewRule((r) => ({ ...r, fileGlob: e.target.value }))}
                    placeholder="File filter (optional: **/*.ts)" aria-label="File glob filter"
                    className="font-mono bg-surface-container/60 border border-outline-variant/20 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                  <div className="flex gap-2">
                    <select value={newRule.severity} onChange={(e) => setNewRule((r) => ({ ...r, severity: e.target.value }))}
                      title="Severity level" aria-label="Severity level"
                      className="flex-1 bg-surface-container/60 border border-outline-variant/20 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                    <select value={newRule.category} onChange={(e) => setNewRule((r) => ({ ...r, category: e.target.value }))}
                      title="Rule category" aria-label="Rule category"
                      className="flex-1 bg-surface-container/60 border border-outline-variant/20 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                      <option value="security">Security</option>
                      <option value="quality">Quality</option>
                      <option value="performance">Performance</option>
                      <option value="config">Config</option>
                    </select>
                  </div>
                </div>
                <textarea value={newRule.suggestion} onChange={(e) => setNewRule((r) => ({ ...r, suggestion: e.target.value }))}
                  placeholder="Suggested fix (shown to users when this rule fires)" aria-label="Suggested fix"
                  rows={2}
                  className="w-full bg-surface-container/60 border border-outline-variant/20 rounded-xl px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                <div className="flex gap-2">
                  <button type="button" onClick={saveRule}
                    disabled={!newRule.name || !newRule.pattern || !newRule.suggestion}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 transition-colors disabled:opacity-40">
                    <MaterialIcon name="save" size={12} /> Save Rule
                  </button>
                  <button type="button" onClick={() => setShowRuleForm(false)}
                    className="px-4 py-2 rounded-xl bg-surface-container/50 text-muted-foreground/60 text-[10px] font-black uppercase tracking-widest hover:text-foreground transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {rulesLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground/40">
                <MaterialIcon name="sync" size={16} className="animate-spin" /> Loading…
              </div>
            ) : rules.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <MaterialIcon name="rule" size={32} className="text-muted-foreground/20" />
                <p className="text-xs text-muted-foreground/40">No custom rules yet. Add your first one above.</p>
                <button type="button" onClick={loadRules}
                  className="text-[10px] font-black text-indigo-400 hover:underline">Load rules</button>
              </div>
            ) : (
              <div className="space-y-2">
                {rules.map((rule) => (
                  <div key={rule.id} className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-surface-container/20 border border-outline-variant/8">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-foreground/85">{rule.name}</span>
                        <span className={cn("text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border",
                          rule.severity === "critical" ? "bg-red-500/10 border-red-500/20 text-red-400" :
                          rule.severity === "high" ? "bg-orange-500/10 border-orange-500/20 text-orange-400" :
                          rule.severity === "medium" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                          "bg-surface-container border-outline-variant/20 text-muted-foreground/50"
                        )}>{rule.severity}</span>
                        {rule.hitCount > 0 && (
                          <span className="text-[8px] font-mono text-muted-foreground/40">{rule.hitCount} hits</span>
                        )}
                      </div>
                      <code className="text-[9px] font-mono text-indigo-400/70 block truncate">{rule.pattern}</code>
                      {rule.fileGlob && (
                        <code className="text-[9px] font-mono text-muted-foreground/40 block">{rule.fileGlob}</code>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
                        onClick={() => toggleRule(rule.id, !rule.enabled)}
                        className={cn("size-5 rounded-md border transition-colors flex items-center justify-center",
                          rule.enabled
                            ? "bg-emerald-500/15 border-emerald-500/25 text-emerald-400"
                            : "bg-surface-container border-outline-variant/20 text-muted-foreground/30"
                        )}>
                        <MaterialIcon name={rule.enabled ? "check" : "close"} size={10} />
                      </button>
                      <button type="button" aria-label="Delete rule" onClick={() => deleteRule(rule.id)}
                        className="size-5 rounded-md border border-outline-variant/15 text-muted-foreground/30 hover:text-red-400 hover:border-red-500/20 transition-colors flex items-center justify-center">
                        <MaterialIcon name="delete" size={10} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Badge snippet */}
        {!result.isDemo && (
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container/20 px-4 py-3 flex flex-wrap items-center gap-3">
            <MaterialIcon name="verified" size={14} className="text-indigo-400 shrink-0" />
            <code className="flex-1 min-w-0 text-[9px] font-mono text-muted-foreground/60 truncate">
              {`[![GitScope Health](https://git-scope-pi.vercel.app/api/badge?repo=${encodeURIComponent(targetRepo)})](https://git-scope-pi.vercel.app)`}
            </code>
            <button type="button"
              onClick={() => {
                const md = `[![GitScope Health](https://git-scope-pi.vercel.app/api/badge?repo=${encodeURIComponent(targetRepo)})](https://git-scope-pi.vercel.app)`;
                navigator.clipboard.writeText(md).then(() => {
                  setBadgeCopied(true);
                  setTimeout(() => setBadgeCopied(false), 2000);
                });
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant/20 text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 hover:text-indigo-400 hover:border-indigo-500/30 transition-colors shrink-0">
              <MaterialIcon name={badgeCopied ? "check" : "content_copy"} size={10} />
              {badgeCopied ? "Copied" : "Copy Badge"}
            </button>
          </div>
        )}

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

      {/* Branch selector — Developer+ only */}
      {multiBranchAllowed && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <MaterialIcon name="account_tree" size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-500/60 pointer-events-none" />
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="Branch (leave blank for default)"
              className="w-full pl-9 pr-4 py-2.5 bg-surface-container/40 border border-emerald-500/20 rounded-xl text-xs placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/40 transition-all"
            />
          </div>
          {branch.trim() && (
            <span className="shrink-0 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-black text-emerald-500 uppercase tracking-widest">
              {branch.trim()}
            </span>
          )}
        </div>
      )}

      {/* Active schedule strip */}
      {schedule && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-linear-to-r from-indigo-500/8 to-violet-500/8 border border-indigo-500/20 animate-in fade-in duration-300">
          <div className="size-7 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
            <MaterialIcon name="alarm_on" size={14} className="text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black text-indigo-400 flex items-center gap-1.5">
              Auto-scan active
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            </p>
            <p className="text-[9px] text-muted-foreground/50">
              {schedule.schedule} · next run {new Date(schedule.nextRunAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
              {schedule.lastScore !== null && ` · last score ${schedule.lastScore}`}
            </p>
          </div>
          <button type="button" onClick={() => setShowSchedulePanel(true)}
            className="text-[9px] font-black text-indigo-400/60 hover:text-indigo-400 transition-colors shrink-0">
            Edit
          </button>
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
        {!canDeepScan && (
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/40">
            <MaterialIcon name="lock" size={11} className="text-indigo-400/40" />
            <span>Full scan requires <span className="text-indigo-400/60 font-black">Professional</span></span>
          </div>
        )}
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
