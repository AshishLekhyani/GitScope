"use client";

import { useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { DependencyRadar } from "@/features/intelligence/dependency-radar";
import { VelocityChart } from "@/features/intelligence/velocity-chart";
import { IntelligenceSearch } from "@/features/intelligence/intelligence-search";
import { RiskPredictor } from "@/features/intelligence/risk-predictor";
import { cn } from "@/lib/utils";

export function IntelligenceClient() {
  const [selectedRepos, setSelectedRepos] = useState<string[]>(["facebook/react"]);
  const [activeTab, setActiveTab] = useState<"radar" | "velocity" | "risk">("radar");

  const handleSelect = (repo: string) => {
    if (selectedRepos.length >= 10) return;
    if (!selectedRepos.includes(repo)) {
      setSelectedRepos([...selectedRepos, repo]);
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
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500/80">GitHub Pro Hub</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-br from-foreground via-foreground/90 to-foreground/40 bg-clip-text text-transparent tracking-tight">
            Recursive <span className="text-primary italic">Intelligence</span>
          </h1>
          <p className="text-sm text-muted-foreground/60 max-w-xl leading-relaxed">
            Uncover hidden patterns, cross-repository dependencies, and engineering velocity metrics. Deep-dive into your organization&apos;s technical fleet with real GitHub data.
          </p>
        </div>

        <div className="flex items-center gap-2 p-1.5 bg-surface-container/30 backdrop-blur-md rounded-2xl border border-outline-variant/10 shadow-sm">
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

      <IntelligenceSearch
        selectedRepos={selectedRepos}
        onSelect={handleSelect}
        onRemove={handleRemove}
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
    </div>
  );
}
