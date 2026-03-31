"use client";

import { useState } from "react";
import { CompareSearch } from "@/features/compare/compare-search";
import { CompareRadar } from "@/features/compare/compare-radar";
import { SearchRepoResult } from "@/features/layout/top-nav";
import { MaterialIcon } from "@/components/material-icon";

export default function ComparePage() {
  const [selectedRepos, setSelectedRepos] = useState<SearchRepoResult[]>([]);

  const handleSelect = (repo: SearchRepoResult) => {
    if (selectedRepos.length < 3) {
      setSelectedRepos([...selectedRepos, repo]);
    }
  };

  const handleRemove = (id: string) => {
    setSelectedRepos(selectedRepos.filter(r => `${r.owner}/${r.repo}` !== id));
  };

  return (
    <div className="flex flex-col gap-10 p-1 md:p-8 animate-in fade-in duration-700 font-sans">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-indigo-500/5 border border-indigo-500/10 mb-2">
            <span className="size-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500/80">Pro Dashboard</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">
            Repository <span className="bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent italic">Battle Mode</span>
          </h1>
          <p className="text-sm text-muted-foreground/60 max-w-xl leading-relaxed">
            Uncover the deep engineering health and velocity metrics of competing projects. Select up to three repositories to generate a comprehensive comparison radar and stability analysis.
          </p>
        </div>
        
        <div className="flex items-center gap-4 bg-surface-container/30 backdrop-blur-md p-4 rounded-3xl border border-outline-variant/10 shadow-sm">
           <div className="size-10 rounded-2xl bg-indigo-500/10 flex items-center justify-center">
              <MaterialIcon name="show_chart" size={24} className="text-indigo-500" />
           </div>
           <div>
              <div className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-widest">Global Ranking</div>
              <div className="text-sm font-black flex items-center gap-2">
                 TOP 1% <span className="text-[8px] text-emerald-400 opacity-100">+4.2%</span>
              </div>
           </div>
        </div>
      </div>

      <div className="space-y-12">
        <div className="flex flex-col items-center">
           <CompareSearch 
             selectedRepos={selectedRepos} 
             onSelect={handleSelect} 
             onRemove={handleRemove} 
           />
        </div>

        <CompareRadar repositories={selectedRepos} />
      </div>
    </div>
  );
}
