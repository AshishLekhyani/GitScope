"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MaterialIcon } from "@/components/material-icon";
import { DependencyRadar } from "@/features/intelligence/dependency-radar";
import { VelocityChart } from "@/features/intelligence/velocity-chart";
import { IntelligenceSearch } from "@/features/intelligence/intelligence-search";
import { RiskPredictor } from "@/features/intelligence/risk-predictor";
import { CodeReviewHub } from "@/features/intelligence/code-review-hub";
import { CodeOwnership } from "@/features/intelligence/code-ownership";
import { CiStatus } from "@/features/intelligence/ci-status";
import { cn } from "@/lib/utils";

interface CapabilitiesResponse {
  plan: "free" | "professional" | "developer" | "team" | "enterprise";
  capabilities: {
    label: string;
    maxReposInWorkspace: number;
    aiAgentDepth: 0 | 1 | 2 | 3;
    aiRequestsPerHour: number;
  };
  githubAuthSource: "session-oauth" | "user-pat" | "shared-env" | "none";
  usage?: {
    total: number;
    byFeature: Record<string, number>;
    since: string;
  };
}

const STORAGE_KEY = "intelligence-page-state-v2";

interface OrgHealthEntry {
  repo: string;
  lastScore: number | null;
  lastScanned: string | null;
  scanCount: number;
}

interface PageState {
  selectedRepos: string[];
  activeTab: "radar" | "velocity" | "risk" | "codelens" | "orghealth" | "ownership" | "ci";
}

export function IntelligenceClient() {
  const searchParams = useSearchParams();
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"radar" | "velocity" | "risk" | "codelens" | "orghealth" | "ownership" | "ci">("codelens");
  const [orgHealth, setOrgHealth] = useState<OrgHealthEntry[]>([]);
  const [orgHealthLoading, setOrgHealthLoading] = useState(false);
  const [caps, setCaps] = useState<CapabilitiesResponse | null>(null);
  const [capsLoading, setCapsLoading] = useState(true);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadCaps = async () => {
      setCapsLoading(true);
      try {
        const res = await fetch("/api/user/ai-capabilities", { cache: "no-store" });
        if (!res.ok) return;
        const data: CapabilitiesResponse = await res.json();
        if (!mounted) return;
        setCaps(data);
      } catch {
        // Keep defaults if capability endpoint is temporarily unavailable.
      } finally {
        if (mounted) setCapsLoading(false);
      }
    };

    loadCaps();
    return () => {
      mounted = false;
    };
  }, []);

  // Load saved state on mount, then apply ?repo= URL param (URL wins)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const state: PageState = JSON.parse(saved);
        if (state.selectedRepos?.length > 0) {
          setSelectedRepos(state.selectedRepos);
        }
        if (state.activeTab) {
          setActiveTab(state.activeTab);
        }
      }
    } catch {
      // Ignore parse errors
    }

    // ?repo=owner/name → pre-select it (URL param takes priority)
    const repoParam = searchParams.get("repo");
    if (repoParam) {
      setSelectedRepos((prev) =>
        prev.includes(repoParam) ? prev : [repoParam, ...prev.filter((r) => r !== repoParam)]
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save state whenever it changes
  useEffect(() => {
    try {
      const state: PageState = { selectedRepos, activeTab };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors
    }
  }, [selectedRepos, activeTab]);

  // Load org health overview when tab is selected
  useEffect(() => {
    if (activeTab !== "orghealth") return;
    setOrgHealthLoading(true);
    fetch("/api/ai/scan-history?overview=1")
      .then((r) => r.json())
      .then((d) => { if (d.allRepos) setOrgHealth(d.allRepos); })
      .catch(() => {})
      .finally(() => setOrgHealthLoading(false));
  }, [activeTab]);

  const maxRepos = caps?.capabilities.maxReposInWorkspace ?? 3;
  const usedThisHour = caps?.usage?.total ?? 0;

  const tierLabel = useMemo(() => {
    if (!caps) return "Explorer";
    return caps.capabilities.label;
  }, [caps]);

  const handleSelect = (repo: string) => {
    if (selectedRepos.length >= maxRepos) {
      setLimitNotice(`Your ${tierLabel} plan supports up to ${maxRepos} repos in one workspace.`);
      return;
    }
    if (!selectedRepos.includes(repo)) {
      setSelectedRepos([...selectedRepos, repo]);
      setLimitNotice(null);
    }
  };

  const handleRemove = (repo: string) => {
    setSelectedRepos(selectedRepos.filter(r => r !== repo));
  };

  return (
    <div className="flex flex-col gap-10 p-1 md:p-8 animate-in fade-in duration-700 font-sans">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-outline-variant/10 pb-10">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-indigo-500/5 border border-indigo-500/10 mb-2">
            <span className="size-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500/80">
              {capsLoading ? "Loading AI Tier" : `${tierLabel} AI Hub`}
            </span>
          </div>
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-black bg-linear-to-br from-foreground via-foreground/90 to-foreground/40 bg-clip-text text-transparent tracking-tight">
            Recursive <span className="text-primary italic">Intelligence</span>
          </h1>
          <p className="text-sm text-muted-foreground/60 max-w-xl leading-relaxed">
            Uncover hidden patterns, cross-repository dependencies, and engineering velocity metrics. Deep-dive into your organization&apos;s technical fleet with real GitHub data.
          </p>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 p-1.5 bg-surface-container/30 backdrop-blur-md rounded-2xl border border-outline-variant/10 shadow-sm overflow-x-auto">
          {[
            { id: "codelens",  icon: "rate_review",    label: "Code Lens"  },
            { id: "orghealth", icon: "corporate_fare", label: "Org Health" },
            { id: "ownership", icon: "group",          label: "Ownership"  },
            { id: "ci",        icon: "rocket_launch",  label: "CI/CD"      },
            { id: "radar",     icon: "scatter_plot",   label: "Radar"      },
            { id: "velocity",  icon: "speed",          label: "Velocity"   },
            { id: "risk",      icon: "security",       label: "AI Risk"    },
          ].map((tab) => (
            <button
               key={tab.id}
               type="button"
               onClick={() => setActiveTab(tab.id as PageState["activeTab"])}
               className={cn(
                 "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                 activeTab === tab.id
                 ? "bg-indigo-500 text-white shadow-xl scale-105"
                 : "text-muted-foreground hover:bg-surface-container-highest"
               )}
            >
               <MaterialIcon name={tab.icon} size={16} />
               {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container/30 px-4 py-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">AI Tier</p>
          <p className="text-sm font-black mt-1">{tierLabel}</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container/30 px-4 py-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Agent Depth</p>
          <p className="text-sm font-black mt-1">{caps?.capabilities.aiAgentDepth ?? 1} specialist layer{(caps?.capabilities.aiAgentDepth ?? 1) > 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container/30 px-4 py-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Hourly AI Budget</p>
          <p className="text-sm font-black mt-1">{usedThisHour} / {caps?.capabilities.aiRequestsPerHour ?? 20} calls used</p>
        </div>
      </div>

      {limitNotice && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs font-bold text-amber-500">
          {limitNotice}
        </div>
      )}

      <IntelligenceSearch
        selectedRepos={selectedRepos}
        onSelect={handleSelect}
        onRemove={handleRemove}
        maxRepos={maxRepos}
      />

      {/* ── Org Health — shown regardless of selectedRepos ── */}
      {activeTab === "orghealth" && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400/80 flex items-center gap-1.5">
                <MaterialIcon name="corporate_fare" size={12} /> Org Health Dashboard
              </p>
              <p className="text-xs text-muted-foreground/50 mt-0.5">
                Every repo you&apos;ve scanned, ranked by health score.
              </p>
            </div>
            {caps && (caps.plan === "free") && (
              <span className="text-[9px] font-black px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                History requires Pro — scores shown from current session only
              </span>
            )}
          </div>

          {orgHealthLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground/40">
              <MaterialIcon name="sync" size={18} className="animate-spin" />
              <span className="text-sm">Loading org health…</span>
            </div>
          ) : orgHealth.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center rounded-3xl border-2 border-dashed border-outline-variant/15 bg-surface-container/10">
              <div className="size-16 rounded-3xl bg-indigo-500/5 border border-indigo-500/10 flex items-center justify-center">
                <MaterialIcon name="corporate_fare" size={28} className="text-indigo-500/30" />
              </div>
              <div>
                <p className="text-sm font-black text-foreground/70">No repos scanned yet</p>
                <p className="text-xs text-muted-foreground/40 mt-1 max-w-xs mx-auto">
                  Use the Code Lens tab to run your first repo scan. Results will appear here once scans complete.
                </p>
              </div>
            </div>
          ) : (() => {
            const sorted = [...orgHealth].sort((a, b) => (b.lastScore ?? 0) - (a.lastScore ?? 0));
            const avgScore = Math.round(sorted.reduce((s, e) => s + (e.lastScore ?? 0), 0) / sorted.length);
            const healthy  = sorted.filter((e) => (e.lastScore ?? 0) >= 70).length;
            const atRisk   = sorted.filter((e) => (e.lastScore ?? 0) < 50).length;

            return (
              <div className="space-y-4">
                {/* Fleet summary strip */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Avg Score", value: avgScore, color: avgScore >= 70 ? "text-emerald-400" : avgScore >= 50 ? "text-amber-400" : "text-red-400" },
                    { label: "Healthy", value: `${healthy} / ${sorted.length}`, color: "text-emerald-400" },
                    { label: "At Risk", value: atRisk, color: atRisk > 0 ? "text-red-400" : "text-muted-foreground/40" },
                  ].map((m) => (
                    <div key={m.label} className="px-4 py-3 rounded-2xl bg-surface-container/30 border border-outline-variant/10 text-center space-y-0.5">
                      <p className={cn("text-xl font-black", m.color)}>{m.value}</p>
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">{m.label}</p>
                    </div>
                  ))}
                </div>

                {/* Fleet score bar chart */}
                <div className="p-4 rounded-2xl bg-surface-container/20 border border-outline-variant/10 space-y-2.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
                    <MaterialIcon name="bar_chart" size={12} /> Score Distribution
                  </p>
                  {sorted.map((entry) => {
                    const score = entry.lastScore ?? 0;
                    const barColor =
                      score >= 80 ? "#10b981" :
                      score >= 65 ? "#14b8a6" :
                      score >= 50 ? "#f59e0b" :
                      score >= 35 ? "#f97316" : "#ef4444";
                    const shortName = entry.repo.split("/")[1] ?? entry.repo;
                    return (
                      <div key={entry.repo} className="flex items-center gap-2">
                        <span className="text-[9px] font-mono text-muted-foreground/40 w-24 truncate shrink-0">{shortName}</span>
                        <div className="flex-1 h-2 rounded-full bg-surface-container-highest overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${score}%`, backgroundColor: barColor }} />
                        </div>
                        <span className="text-[9px] font-black font-mono w-7 text-right shrink-0" style={{ color: barColor }}>{score}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Repo cards */}
                <div className="space-y-2">
                  {sorted.map((entry, i) => {
                    const score = entry.lastScore ?? 0;
                    const grade = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : score >= 50 ? "D" : "F";
                    const scoreColor =
                      score >= 80 ? "text-emerald-400" :
                      score >= 65 ? "text-teal-400" :
                      score >= 50 ? "text-amber-400" :
                      score >= 35 ? "text-orange-400" : "text-red-400";
                    const gradeBg =
                      score >= 80 ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" :
                      score >= 65 ? "bg-teal-500/10 border-teal-500/25 text-teal-400" :
                      score >= 50 ? "bg-amber-500/10 border-amber-500/25 text-amber-400" :
                      score >= 35 ? "bg-orange-500/10 border-orange-500/25 text-orange-400" :
                      "bg-red-500/10 border-red-500/25 text-red-400";
                    const ringR = 20;
                    const ringCirc = 2 * Math.PI * ringR;
                    const ringFilled = (score / 100) * ringCirc;
                    const ringColor = score >= 80 ? "#10b981" : score >= 65 ? "#14b8a6" : score >= 50 ? "#f59e0b" : score >= 35 ? "#f97316" : "#ef4444";

                    return (
                      <div key={entry.repo}
                        className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-surface-container/20 border border-outline-variant/8 hover:border-indigo-500/20 hover:bg-surface-container/40 transition-all group">
                        {/* Rank */}
                        <span className="text-[10px] font-black text-muted-foreground/25 w-4 text-center shrink-0">{i + 1}</span>

                        {/* Ring gauge */}
                        <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
                          <circle cx="24" cy="24" r={ringR} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="4" />
                          <circle cx="24" cy="24" r={ringR} fill="none" stroke={ringColor} strokeWidth="4"
                            strokeLinecap="round"
                            strokeDasharray={`${ringFilled.toFixed(2)} ${ringCirc.toFixed(2)}`}
                            transform="rotate(-90 24 24)" opacity="0.9" />
                          <text x="24" y="28" textAnchor="middle" fontSize="10" fontWeight="900"
                            fill={ringColor} fontFamily="monospace">{score || "—"}</text>
                        </svg>

                        {/* Repo name + bar */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <p className="text-xs font-black text-foreground/85 truncate">{entry.repo}</p>
                          <div className="flex items-center gap-2">
                            <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded border", gradeBg)}>{grade}</span>
                            <span className="text-[9px] font-mono text-muted-foreground/30">
                              {entry.scanCount} scan{entry.scanCount !== 1 ? "s" : ""}
                              {entry.lastScanned ? ` · ${new Date(entry.lastScanned).toLocaleDateString("en", { month: "short", day: "numeric" })}` : ""}
                            </span>
                          </div>
                        </div>

                        {/* Open in Code Lens */}
                        <button type="button" aria-label={`Open ${entry.repo} in Code Lens`}
                          onClick={() => {
                            if (!selectedRepos.includes(entry.repo)) handleSelect(entry.repo);
                            setActiveTab("codelens");
                          }}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/8 border border-indigo-500/15 text-indigo-400/50 hover:bg-indigo-500/20 hover:text-indigo-400 hover:border-indigo-500/30 transition-all text-[9px] font-black opacity-0 group-hover:opacity-100">
                          <MaterialIcon name="open_in_new" size={11} /> Inspect
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="space-y-12 min-h-150 relative">
        {selectedRepos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-48 text-center bg-surface-container/20 rounded-3xl border-2 border-dashed border-outline-variant/20">
             <div className="size-20 rounded-3xl bg-indigo-500/5 flex items-center justify-center border border-indigo-500/10 mb-8">
                <MaterialIcon name="explore" size={32} className="text-indigo-500/20" />
             </div>
             <h3 className="text-2xl font-black mb-3">No Active Targets</h3>
             <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed mb-8">
                Your workspace is empty. Search for repositories above to start a recursive engineering health scan.
             </p>
             <div className="flex items-center gap-4 text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                <div className="flex items-center gap-2">
                   <MaterialIcon name="api" size={14} />
                   Live GitHub Sync
                </div>
                <div className="flex items-center gap-2">
                   <MaterialIcon name="auto_awesome" size={14} />
                   Predictive Scoring
                </div>
             </div>
          </div>
        ) : (
          <>
            {activeTab === "codelens" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <CodeReviewHub
                  selectedRepos={selectedRepos}
                  plan={caps?.plan ?? "free"}
                  aiAgentDepth={caps?.capabilities.aiAgentDepth ?? 1}
                  aiRequestsPerHour={caps?.capabilities.aiRequestsPerHour ?? 20}
                  githubConnected={caps?.githubAuthSource === "session-oauth" || caps?.githubAuthSource === "user-pat"}
                />
              </div>
            )}
            {activeTab === "ownership" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <CodeOwnership repos={selectedRepos} />
              </div>
            )}
            {activeTab === "ci" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <CiStatus repos={selectedRepos} />
              </div>
            )}
            {activeTab === "radar" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                 <DependencyRadar repos={selectedRepos} />
              </div>
            )}
            {activeTab === "velocity" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                 <VelocityChart repos={selectedRepos} />
              </div>
            )}
            {activeTab === "risk" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10">
                 <div className="grid grid-cols-1 gap-12">
                   {selectedRepos.map(repo => (
                      <div key={repo} className="space-y-6">
                        <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-surface-container/50 border border-outline-variant/10 w-fit">
                           <MaterialIcon name="folder" size={18} className="text-indigo-500" />
                           <span className="text-xs font-black tracking-tight">{repo}</span>
                        </div>
                        <RiskPredictor repo={repo} />
                      </div>
                   ))}
                 </div>
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
}
