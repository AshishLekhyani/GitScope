"use client";

import { useState, useEffect } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import type { DoraMetrics, DoraTier } from "@/app/api/user/dora-metrics/route";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DoraRepoResult {
  name: string;
  metrics: DoraMetrics | null;
}

type AIState = "idle" | "loading" | "done" | "error";

interface CoachingResult {
  summary: string;
  bottleneck: string;
  actions: { metric: string; action: string; impact: string; effort: "low" | "medium" | "high" }[];
  doraClass: string;
}

// ── DORA benchmark data ───────────────────────────────────────────────────────

const DORA_TIERS: Record<DoraTier, { label: string; color: string; bg: string; border: string; icon: string }> = {
  elite:  { label: "Elite",  color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25", icon: "rocket_launch" },
  high:   { label: "High",   color: "text-indigo-400",  bg: "bg-indigo-500/10",  border: "border-indigo-500/25",  icon: "trending_up" },
  medium: { label: "Medium", color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/25",   icon: "trending_flat" },
  low:    { label: "Low",    color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/25",     icon: "trending_down" },
};

interface DoraMetricDef {
  key: keyof DoraMetrics;
  tierKey: keyof DoraMetrics;
  label: string;
  icon: string;
  what: string;
  why: string;
  benchmarks: { tier: DoraTier; label: string; value: string }[];
  format: (v: number) => string;
  lowerIsBetter: boolean;
}

const DORA_METRICS: DoraMetricDef[] = [
  {
    key: "leadTime",
    tierKey: "leadTimeTier",
    label: "Lead Time for Changes",
    icon: "timer",
    what: "Time from first commit to production merge — how fast your team ships code.",
    why: "Short lead times reduce risk, speed up learning, and increase release cadence. It's the core measure of delivery pipeline efficiency. Teams with elite lead times can ship fixes in minutes.",
    benchmarks: [
      { tier: "elite",  label: "Elite",  value: "< 1 hour" },
      { tier: "high",   label: "High",   value: "1 hour – 1 day" },
      { tier: "medium", label: "Medium", value: "1 day – 1 week" },
      { tier: "low",    label: "Low",    value: "> 1 week" },
    ],
    format: (v) => v === 0 ? "—" : v < 24 ? `${v.toFixed(1)}h` : `${(v / 24).toFixed(1)}d`,
    lowerIsBetter: true,
  },
  {
    key: "deployFreq",
    tierKey: "deployFreqTier",
    label: "Deployment Frequency",
    icon: "rocket_launch",
    what: "How often the team deploys to production — measured as merged PRs per day.",
    why: "High deployment frequency means smaller batches, lower blast radius, and faster feedback. Teams that deploy more frequently have significantly lower change failure rates and recover faster.",
    benchmarks: [
      { tier: "elite",  label: "Elite",  value: "Multiple per day" },
      { tier: "high",   label: "High",   value: "Once per day – once per week" },
      { tier: "medium", label: "Medium", value: "Once per week – once per month" },
      { tier: "low",    label: "Low",    value: "< once per month" },
    ],
    format: (v) => v === 0 ? "—" : v >= 1 ? `${v.toFixed(1)}/day` : v >= 1/7 ? `${(v * 7).toFixed(1)}/week` : `${(v * 30).toFixed(1)}/month`,
    lowerIsBetter: false,
  },
  {
    key: "cfr",
    tierKey: "cfrTier",
    label: "Change Failure Rate",
    icon: "bug_report",
    what: "Percentage of changes that cause a failure — detected via hotfix/revert PR titles.",
    why: "CFR measures quality of your delivery process. A high rate signals inadequate testing, review, or staging environments. Elite teams target under 5% by investing in automated testing and progressive delivery.",
    benchmarks: [
      { tier: "elite",  label: "Elite",  value: "0 – 5%" },
      { tier: "high",   label: "High",   value: "5 – 10%" },
      { tier: "medium", label: "Medium", value: "10 – 15%" },
      { tier: "low",    label: "Low",    value: "> 15%" },
    ],
    format: (v) => v === 0 ? "0%" : `${(v * 100).toFixed(1)}%`,
    lowerIsBetter: true,
  },
  {
    key: "mttr",
    tierKey: "mttrTier",
    label: "Mean Time to Restore",
    icon: "healing",
    what: "Average time to close a bug/incident issue — how fast the team recovers from failures.",
    why: "MTTR reveals incident response maturity. Short MTTR requires good observability, runbooks, and on-call practices. Even elite teams fail — what differentiates them is recovery speed, not failure avoidance.",
    benchmarks: [
      { tier: "elite",  label: "Elite",  value: "< 1 hour" },
      { tier: "high",   label: "High",   value: "1 hour – 1 day" },
      { tier: "medium", label: "Medium", value: "1 day – 1 week" },
      { tier: "low",    label: "Low",    value: "> 1 week" },
    ],
    format: (v) => v === 0 ? "No data" : v < 1 ? `${Math.round(v * 60)}min` : v < 24 ? `${v.toFixed(1)}h` : `${(v / 24).toFixed(1)}d`,
    lowerIsBetter: true,
  },
];

// ── Mini trend sparkline ──────────────────────────────────────────────────────
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-container-highest overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// ── Tier badge ────────────────────────────────────────────────────────────────
function TierBadge({ tier, size = "sm" }: { tier: DoraTier; size?: "xs" | "sm" | "lg" }) {
  const t = DORA_TIERS[tier];
  return (
    <span className={cn(
      "inline-flex items-center gap-1 font-black uppercase tracking-widest rounded-full border",
      t.bg, t.border, t.color,
      size === "xs" ? "text-[8px] px-1.5 py-0.5" :
      size === "sm" ? "text-[9px] px-2 py-0.5" :
                     "text-[11px] px-3 py-1"
    )}>
      <MaterialIcon name={t.icon} size={size === "lg" ? 14 : 10} />
      {t.label}
    </span>
  );
}

// ── Benchmark row ─────────────────────────────────────────────────────────────
function BenchmarkTable({ benchmarks, current }: {
  benchmarks: DoraMetricDef["benchmarks"];
  current: DoraTier;
}) {
  return (
    <div className="space-y-1">
      {benchmarks.map((b) => {
        const isCurrent = b.tier === current;
        const t = DORA_TIERS[b.tier];
        return (
          <div key={b.tier} className={cn(
            "flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all",
            isCurrent ? `${t.bg} border ${t.border}` : "opacity-40"
          )}>
            <div className="flex items-center gap-2">
              {isCurrent && <span className="size-1.5 rounded-full animate-pulse" style={{ backgroundColor: t.color.replace("text-", "") }} />}
              <span className={cn("text-[9px] font-black uppercase tracking-wider", isCurrent ? t.color : "text-muted-foreground/50")}>
                {b.label}
              </span>
            </div>
            <span className={cn("text-[9px] font-mono", isCurrent ? t.color : "text-muted-foreground/40")}>{b.value}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function VelocityChart({ repos }: { repos: string[] }) {
  const [data, setData] = useState<DoraRepoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const [aiState, setAiState] = useState<AIState>("idle");
  const [coaching, setCoaching] = useState<CoachingResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (repos.length === 0) return;
    setLoading(true);
    fetch(`/api/user/dora-metrics?repos=${encodeURIComponent(repos.join(","))}`)
      .then((r) => r.json())
      .then((payload) => {
        const items: DoraRepoResult[] = Array.isArray(payload) ? payload : (payload.items ?? []);
        setData(items);
        if (items.length > 0) setActiveRepo(items[0].name);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [repos]);

  const fetchAICoaching = async () => {
    const validRepos = data.filter((d) => d.metrics);
    if (validRepos.length === 0 || aiState === "loading") return;
    setAiState("loading");
    setCoaching(null);
    setAiError(null);

    const metricsText = validRepos.map((d) => {
      const m = d.metrics!;
      return [
        `Repo: ${d.name}`,
        `  Lead Time: ${DORA_METRICS[0].format(m.leadTime)} (${m.leadTimeTier} tier)`,
        `  Deploy Frequency: ${DORA_METRICS[1].format(m.deployFreq)} (${m.deployFreqTier} tier)`,
        `  Change Failure Rate: ${DORA_METRICS[2].format(m.cfr)} (${m.cfrTier} tier)`,
        `  MTTR: ${DORA_METRICS[3].format(m.mttr)} (${m.mttrTier} tier)`,
        `  Bus Factor: ${m.busFactor} unique contributors`,
        `  Revert/Hotfix PRs: ${m.revertCount} of ${m.count} total`,
      ].join("\n");
    }).join("\n\n");

    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repos[0],
          question: `You are a DORA metrics engineering coach. Analyze these metrics and return ONLY a JSON object (no markdown, no preamble):

${metricsText}

DORA Benchmarks for reference:
- Lead Time: Elite <1h, High <1 day, Medium <1 week, Low >1 week
- Deploy Frequency: Elite multiple/day, High daily, Medium weekly, Low monthly
- Change Failure Rate: Elite <5%, High <10%, Medium <15%, Low >15%
- MTTR: Elite <1h, High <1 day, Medium <1 week, Low >1 week

Return this exact JSON:
{
  "summary": "<2-3 sentence executive summary of the team's DORA performance and what it means for business velocity>",
  "bottleneck": "<single sentence identifying the #1 constraint limiting their DORA tier upgrade — be specific>",
  "doraClass": "<Elite|High|Medium|Low based on overall performance>",
  "actions": [
    {
      "metric": "<Lead Time|Deploy Frequency|Change Failure Rate|MTTR>",
      "action": "<specific, concrete engineering action — name tools, techniques, or process changes>",
      "impact": "<what measurable improvement this will produce>",
      "effort": "<low|medium|high>"
    }
  ]
}

Return 4 actions, one per DORA metric. Prioritize by impact. Be concrete and technical.`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "AI coaching failed");

      // Parse JSON from response
      const raw: string = json.analysis ?? "";
      const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      const parsed = JSON.parse(cleaned) as CoachingResult;
      setCoaching(parsed);
      setAiState("done");
    } catch (e) {
      // If JSON parse fails, show raw text in a degraded state
      setAiError(e instanceof Error ? e.message : "AI coaching failed");
      setAiState("error");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-48 gap-6 animate-pulse bg-surface-container/10 rounded-3xl border border-dashed border-outline-variant/10">
        <div className="size-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
          <MaterialIcon name="speed" size={32} className="text-indigo-500/30" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">Computing DORA Metrics</p>
          <p className="text-xs text-muted-foreground/20">Analyzing merged PRs, commits, and issue resolution times…</p>
        </div>
      </div>
    );
  }

  if (data.length === 0 || !data.some((d) => d.metrics)) {
    return (
      <div className="flex flex-col items-center justify-center py-48 text-center bg-surface-container/10 rounded-3xl border-2 border-dashed border-outline-variant/10">
        <MaterialIcon name="speed" size={48} className="text-muted-foreground/10 mb-6" />
        <h4 className="text-xl font-bold">DORA Metrics Unavailable</h4>
        <p className="text-sm text-muted-foreground/60 max-w-sm mx-auto mt-2 leading-relaxed">
          Insufficient merged PR data. DORA metrics require at least a few merged pull requests to compute lead time and deployment frequency.
        </p>
      </div>
    );
  }

  const activeData = data.find((d) => d.name === activeRepo) ?? data[0];
  const m = activeData?.metrics;

  // Fleet averages across repos with data
  const valid = data.filter((d) => d.metrics);
  const fleetLeadTime  = valid.reduce((s, d) => s + d.metrics!.leadTime,   0) / valid.length;
  const fleetFreq      = valid.reduce((s, d) => s + d.metrics!.deployFreq, 0) / valid.length;
  const fleetCFR       = valid.reduce((s, d) => s + d.metrics!.cfr,        0) / valid.length;
  const fleetMTTR      = valid.reduce((s, d) => s + d.metrics!.mttr,       0) / valid.length;
  const fleetBusFactor = valid.reduce((s, d) => s + d.metrics!.busFactor,  0) / valid.length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── DORA explainer banner ── */}
      <div className="p-5 rounded-3xl bg-gradient-to-br from-indigo-500/8 to-violet-500/5 border border-indigo-500/15 space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
            <MaterialIcon name="insights" size={16} className="text-indigo-400" />
          </div>
          <div>
            <p className="text-xs font-black text-foreground/85">DORA Four Key Metrics</p>
            <p className="text-[10px] text-muted-foreground/50">
              Developed by the DevOps Research and Assessment team at Google Cloud. The four metrics are proven predictors of software delivery performance and organizational outcomes.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          {DORA_METRICS.map((metric) => (
            <div key={metric.key} className="flex items-center gap-1.5 text-[9px] text-muted-foreground/50">
              <MaterialIcon name={metric.icon} size={11} className="text-indigo-400/60 shrink-0" />
              <span className="font-bold">{metric.label.split(" ").slice(0, 2).join(" ")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Repo selector (if multiple) ── */}
      {data.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {data.map((d) => (
            <button key={d.name} type="button" onClick={() => setActiveRepo(d.name)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-black transition-all",
                activeRepo === d.name
                  ? "bg-indigo-500 text-white border-indigo-500 shadow-md shadow-indigo-500/20"
                  : "bg-surface-container/30 border-outline-variant/10 text-muted-foreground/60 hover:border-indigo-500/25 hover:text-foreground"
              )}>
              <MaterialIcon name="folder" size={11} />
              {d.name.split("/")[1]}
              {d.metrics && <TierBadge tier={d.metrics.overallTier} size="xs" />}
            </button>
          ))}
        </div>
      )}

      {/* ── Overall tier hero ── */}
      {m && (
        <div className={cn(
          "flex items-center gap-5 p-5 rounded-3xl border",
          DORA_TIERS[m.overallTier].bg, DORA_TIERS[m.overallTier].border
        )}>
          <div className={cn("size-14 rounded-2xl border flex items-center justify-center shrink-0", DORA_TIERS[m.overallTier].bg, DORA_TIERS[m.overallTier].border)}>
            <MaterialIcon name={DORA_TIERS[m.overallTier].icon} size={28} className={DORA_TIERS[m.overallTier].color} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Overall DORA Classification</p>
            <p className={cn("text-2xl font-black", DORA_TIERS[m.overallTier].color)}>
              {DORA_TIERS[m.overallTier].label} Performer
            </p>
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">
              {activeData.name} · {m.count} merges analyzed · {m.busFactor} active contributors
            </p>
          </div>
          <div className="shrink-0 text-right space-y-1 hidden sm:block">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">Bus Factor</p>
            <p className={cn("text-2xl font-black", m.busFactor <= 2 ? "text-red-400" : m.busFactor <= 4 ? "text-amber-400" : "text-emerald-400")}>
              {m.busFactor}
            </p>
            {m.busFactor <= 2 && (
              <p className="text-[9px] font-black text-red-400">⚠ Knowledge silo risk</p>
            )}
          </div>
        </div>
      )}

      {/* ── 4 DORA Metric Cards ── */}
      {m && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {DORA_METRICS.map((def) => {
            const value = m[def.key] as number;
            const tier  = m[def.tierKey] as DoraTier;
            const t     = DORA_TIERS[tier];
            const isExpanded = expandedMetric === def.key;

            return (
              <div key={def.key} className={cn(
                "rounded-2xl border overflow-hidden transition-all",
                t.bg, t.border
              )}>
                {/* Card header */}
                <button type="button" className="w-full flex items-center gap-3 px-4 py-4 text-left"
                  onClick={() => setExpandedMetric(isExpanded ? null : String(def.key))}>
                  <div className={cn("size-9 rounded-xl border flex items-center justify-center shrink-0", t.bg, t.border)}>
                    <MaterialIcon name={def.icon} size={18} className={t.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">{def.label}</p>
                    <p className={cn("text-xl font-black", t.color)}>{def.format(value)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <TierBadge tier={tier} size="sm" />
                    <MaterialIcon name={isExpanded ? "expand_less" : "expand_more"} size={14} className="text-muted-foreground/40" />
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4 border-t border-border animate-in fade-in duration-200">
                    {/* What & Why */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                      <div className="space-y-1">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">What it measures</p>
                        <p className="text-[11px] text-foreground/70 leading-relaxed">{def.what}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Why it matters</p>
                        <p className="text-[11px] text-foreground/70 leading-relaxed">{def.why}</p>
                      </div>
                    </div>

                    {/* Benchmark table */}
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mb-2">DORA Benchmarks</p>
                      <BenchmarkTable benchmarks={def.benchmarks} current={tier} />
                    </div>

                    {/* How to improve */}
                    <div className={cn("p-3 rounded-xl border", t.bg, t.border)}>
                      <p className={cn("text-[9px] font-black uppercase tracking-widest mb-1.5", t.color)}>
                        How to reach {tier === "elite" ? "stay at" : "next tier"}
                        {tier !== "elite" ? ` (${DORA_TIERS[tier === "low" ? "medium" : tier === "medium" ? "high" : "elite"].label})` : ""}
                      </p>
                      <p className="text-[11px] text-foreground/65 leading-relaxed">
                        {def.key === "leadTime" && (
                          tier === "elite" ? "Maintain trunk-based development and keep PRs small and focused." :
                          tier === "high"  ? "Invest in CI speed — parallelize test suites, cache build artifacts. Target <30 min pipelines." :
                          tier === "medium"? "Break work into smaller PRs (< 200 lines), implement feature flags to decouple deploy from release." :
                          "Adopt trunk-based development, eliminate long-lived branches, implement automated testing to gain PR confidence."
                        )}
                        {def.key === "deployFreq" && (
                          tier === "elite" ? "Excellent cadence. Invest in progressive delivery (canary, blue/green) to make each deploy safer." :
                          tier === "high"  ? "Move toward continuous delivery. Automate release notes and deployment approval workflows." :
                          tier === "medium"? "Reduce batch size. Aim for daily deployments by splitting features behind flags and automating your staging pipeline." :
                          "Start with weekly planned deployments. Automate your build → test → deploy pipeline end-to-end. Deploy at least to staging on every merge."
                        )}
                        {def.key === "cfr" && (
                          tier === "elite" ? "World-class quality. Continue investing in property-based testing and chaos engineering to stay here." :
                          tier === "high"  ? "Add integration and contract tests. Implement automated rollback triggers on error rate spikes." :
                          tier === "medium"? "Invest in staging parity with production. Add synthetic monitoring and error rate SLOs." :
                          "Emergency: audit your deployment process. Add mandatory integration tests before merge. Implement feature flags for gradual rollout."
                        )}
                        {def.key === "mttr" && (
                          tier === "elite" ? "Excellent recovery speed. Document runbooks and share incident learnings to sustain this." :
                          tier === "high"  ? "Add automated alerts with actionable context. Practice game days to rehearse incident response." :
                          tier === "medium"? "Build runbooks for top 10 failure modes. Add distributed tracing (OpenTelemetry) to cut diagnosis time." :
                          "Invest in observability (metrics, logs, traces). Create an on-call rotation and incident runbooks. Automated rollback is critical."
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Fleet comparison (multi-repo) ── */}
      {valid.length > 1 && (
        <div className="p-5 rounded-2xl bg-surface-container/20 border border-outline-variant/10 space-y-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
            <MaterialIcon name="compare" size={12} /> Fleet Comparison
          </p>
          <div className="space-y-3">
            {valid.map((d) => {
              const dm = d.metrics!;
              const t  = DORA_TIERS[dm.overallTier];
              return (
                <div key={d.name} className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-muted-foreground/40 w-24 truncate shrink-0">{d.name.split("/")[1]}</span>
                  <div className="flex-1 grid grid-cols-4 gap-1">
                    {[
                      { tier: dm.leadTimeTier,   val: DORA_METRICS[0].format(dm.leadTime) },
                      { tier: dm.deployFreqTier, val: DORA_METRICS[1].format(dm.deployFreq) },
                      { tier: dm.cfrTier,        val: DORA_METRICS[2].format(dm.cfr) },
                      { tier: dm.mttrTier,       val: DORA_METRICS[3].format(dm.mttr) },
                    ].map(({ tier, val }, i) => {
                      const ct = DORA_TIERS[tier];
                      return (
                        <div key={i} className={cn("text-center px-1.5 py-1 rounded-lg border text-[9px] font-black", ct.bg, ct.border, ct.color)}>
                          {val}
                        </div>
                      );
                    })}
                  </div>
                  <TierBadge tier={dm.overallTier} size="xs" />
                </div>
              );
            })}
            {/* Column headers */}
            <div className="flex items-center gap-3 pt-1 border-t border-outline-variant/8">
              <span className="w-24 shrink-0" />
              <div className="flex-1 grid grid-cols-4 gap-1 text-center">
                {["Lead Time", "Deploy Freq", "Fail Rate", "MTTR"].map((h) => (
                  <span key={h} className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/30">{h}</span>
                ))}
              </div>
              <span className="w-16 shrink-0" />
            </div>
          </div>
        </div>
      )}

      {/* ── Fleet aggregate stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Avg Lead Time",   value: DORA_METRICS[0].format(fleetLeadTime),  icon: "timer",         color: "text-indigo-400" },
          { label: "Avg Deploy Freq", value: DORA_METRICS[1].format(fleetFreq),      icon: "rocket_launch", color: "text-violet-400" },
          { label: "Avg Failure Rate",value: DORA_METRICS[2].format(fleetCFR),       icon: "bug_report",    color: fleetCFR > 0.10 ? "text-red-400" : "text-emerald-400" },
          { label: "Avg MTTR",        value: DORA_METRICS[3].format(fleetMTTR),      icon: "healing",       color: "text-amber-400" },
          { label: "Mean Bus Factor", value: fleetBusFactor.toFixed(1),               icon: "groups",        color: fleetBusFactor <= 2 ? "text-red-400" : "text-emerald-400" },
        ].map((stat) => (
          <div key={stat.label} className="p-4 rounded-2xl bg-surface-container/30 border border-outline-variant/10 text-center space-y-1">
            <MaterialIcon name={stat.icon} size={18} className={cn("mx-auto", stat.color)} />
            <p className={cn("text-lg font-black", stat.color)}>{stat.value}</p>
            <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── AI DORA Coach ── */}
      <div className="rounded-3xl border border-outline-variant/10 bg-surface-container/20 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/8">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <MaterialIcon name="psychology" size={16} className="text-indigo-400" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400/80">AI DORA Coach</p>
              <p className="text-[9px] text-muted-foreground/40">Bottleneck analysis + concrete improvement actions per metric</p>
            </div>
          </div>
          {aiState !== "done" && (
            <button type="button" onClick={fetchAICoaching}
              disabled={aiState === "loading" || valid.length === 0}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
                aiState === "loading"
                  ? "bg-indigo-500/10 text-indigo-400/50 cursor-not-allowed"
                  : "bg-indigo-500 text-white hover:bg-indigo-600 shadow-lg shadow-indigo-500/20"
              )}>
              <MaterialIcon name={aiState === "loading" ? "hourglass_top" : "auto_awesome"} size={12}
                className={aiState === "loading" ? "animate-spin" : ""} />
              {aiState === "loading" ? "Analyzing…" : "Get AI Coaching"}
            </button>
          )}
        </div>

        <div className="p-5">
          {aiState === "idle" && (
            <p className="text-[11px] text-muted-foreground/40 leading-relaxed">
              Get structured AI analysis of your DORA metrics — executive summary, bottleneck identification, and one concrete action per metric with effort estimates.
            </p>
          )}

          {aiState === "loading" && (
            <div className="flex items-center gap-3 py-4 animate-pulse">
              <div className="size-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin shrink-0" />
              <span className="text-xs text-muted-foreground/50">Benchmarking against DORA standards and generating improvement plan…</span>
            </div>
          )}

          {aiState === "done" && coaching && (
            <div className="space-y-4 animate-in fade-in duration-400">
              {/* Summary + class */}
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10">
                <MaterialIcon name="summarize" size={16} className="text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400/70 mb-1">
                    Assessment · {coaching.doraClass} Performer
                  </p>
                  <p className="text-xs text-foreground/75 leading-relaxed">{coaching.summary}</p>
                </div>
              </div>

              {/* Bottleneck */}
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/15">
                <MaterialIcon name="warning" size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-amber-400/70 mb-1">#1 Bottleneck</p>
                  <p className="text-xs text-foreground/75 leading-relaxed">{coaching.bottleneck}</p>
                </div>
              </div>

              {/* Actions per metric */}
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 px-1">Improvement Actions</p>
                {(coaching.actions ?? []).map((a, i) => {
                  const metricDef = DORA_METRICS.find((d) => d.label.toLowerCase().includes(a.metric.toLowerCase().split(" ")[0]));
                  return (
                    <div key={i} className="p-4 rounded-2xl bg-surface-container/30 border border-outline-variant/8 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {metricDef && <MaterialIcon name={metricDef.icon} size={13} className="text-indigo-400/70" />}
                        <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400/70">{a.metric}</span>
                        <span className={cn(
                          "ml-auto text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded border",
                          a.effort === "low"    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                          a.effort === "medium" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                                                  "bg-red-500/10 border-red-500/20 text-red-400"
                        )}>{a.effort} effort</span>
                      </div>
                      <p className="text-xs font-semibold text-foreground/80">{a.action}</p>
                      <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1.5">
                        <MaterialIcon name="trending_up" size={11} className="text-emerald-400/60" />
                        {a.impact}
                      </p>
                    </div>
                  );
                })}
              </div>

              <button type="button" onClick={fetchAICoaching}
                className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground/40 hover:text-indigo-400 transition-colors">
                <MaterialIcon name="refresh" size={12} /> Refresh coaching
              </button>
            </div>
          )}

          {aiState === "error" && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/5 border border-red-500/10">
              <MaterialIcon name="error" size={14} className="shrink-0 text-red-400" />
              <p className="text-[11px] text-red-400">{aiError ?? "AI coaching unavailable — check your AI provider settings."}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
