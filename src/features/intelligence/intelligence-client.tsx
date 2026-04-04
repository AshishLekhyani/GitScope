"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { DependencyRadar } from "@/features/intelligence/dependency-radar";
import { VelocityChart } from "@/features/intelligence/velocity-chart";
import { IntelligenceSearch } from "@/features/intelligence/intelligence-search";
import { RiskPredictor } from "@/features/intelligence/risk-predictor";
import { IntelligenceDemoModal } from "@/components/modals/intelligence-demo-modal";
import { cn } from "@/lib/utils";

interface CapabilitiesResponse {
  plan: "free" | "professional" | "team" | "enterprise";
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

const STORAGE_KEY = "intelligence-page-state";

interface PageState {
  selectedRepos: string[];
  activeTab: "radar" | "velocity" | "risk";
}

export function IntelligenceClient() {
  const [selectedRepos, setSelectedRepos] = useState<string[]>(["facebook/react"]);
  const [activeTab, setActiveTab] = useState<"radar" | "velocity" | "risk">("radar");
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

  // Load saved state on mount
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
  }, []);

  // Save state whenever it changes
  useEffect(() => {
    try {
      const state: PageState = { selectedRepos, activeTab };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors
    }
  }, [selectedRepos, activeTab]);

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
            { id: "radar", icon: "scatter_plot", label: "Radar" },
            { id: "velocity", icon: "speed", label: "Velocity" },
            { id: "risk", icon: "security", label: "AI Risk" }
          ].map((tab) => (
            <button
               key={tab.id}
               type="button"
               onClick={() => setActiveTab(tab.id as "radar" | "velocity" | "risk")}
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

      <div className="space-y-12 min-h-[600px] relative">
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

      <IntelligenceDemoModal />
    </div>
  );
}
