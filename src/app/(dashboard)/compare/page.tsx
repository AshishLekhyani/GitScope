"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/card";
import { CompareSearch, CompareRadar, CompareMetrics, CompareBattle, CommitVelocity, ShareComparison, SuggestedComparisons } from "@/features/compare";
import { SearchRepoResult } from "@/features/layout/top-nav";
import { MaterialIcon } from "@/components/material-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ViewMode = "overview" | "battle" | "velocity" | "metrics";

export default function ComparePage() {
  const [selectedRepos, setSelectedRepos] = useState<SearchRepoResult[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");

  const handleSelect = (repo: SearchRepoResult) => {
    if (selectedRepos.length < 3) {
      setSelectedRepos([...selectedRepos, repo]);
    }
  };

  const handleRemove = (id: string) => {
    setSelectedRepos(selectedRepos.filter(r => `${r.owner}/${r.repo}` !== id));
  };

  const clearAll = () => {
    setSelectedRepos([]);
    setViewMode("overview");
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6"
    >
      {/* Hero Section */}
      <Card className="p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-r from-indigo-500/5 via-transparent to-purple-500/5" />
        <div className="absolute top-0 right-0 w-64 h-64 bg-linear-to-br from-indigo-500/10 to-transparent rounded-full blur-3xl" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
              <span className="size-2 rounded-full bg-indigo-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Pro Dashboard</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight">
              Repository <span className="bg-linear-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent italic">Battle Mode</span>
            </h1>
            <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
              Uncover deep engineering health metrics, velocity analysis, and competitive insights. 
              Compare up to three repositories with comprehensive analytics.
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {selectedRepos.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearAll}
                className="rounded-full border-destructive/20 text-destructive hover:bg-destructive/10"
              >
                <MaterialIcon name="clear_all" size={16} className="mr-2" />
                Clear All
              </Button>
            )}
            <ShareComparison repositories={selectedRepos} />
            
            <div className="flex items-center gap-4 bg-surface-container/50 p-4 rounded-2xl border border-outline-variant/20">
              <div className="size-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                <MaterialIcon name="show_chart" size={24} className="text-indigo-500" />
              </div>
              <div>
                <div className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest">Repos Selected</div>
                <div className="text-sm font-black flex items-center gap-2">
                  {selectedRepos.length} <span className="text-[8px] text-emerald-400">/ 3 max</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* View Mode Tabs */}
        {selectedRepos.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 mt-8 flex flex-wrap gap-2"
          >
            {[
              { id: "overview", label: "Overview", icon: "dashboard" },
              { id: "battle", label: "Battle Mode", icon: "sports_martial_arts" },
              { id: "velocity", label: "Velocity", icon: "speed" },
              { id: "metrics", label: "Deep Metrics", icon: "analytics" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setViewMode(tab.id as ViewMode)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300",
                  viewMode === tab.id
                    ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/25"
                    : "bg-surface-container/50 text-muted-foreground hover:text-foreground border border-outline-variant/10"
                )}
              >
                <MaterialIcon name={tab.icon} size={16} />
                {tab.label}
              </button>
            ))}
          </motion.div>
        )}
      </Card>

      {/* Search Section */}
      <div className="space-y-6">
        <CompareSearch 
          selectedRepos={selectedRepos} 
          onSelect={handleSelect} 
          onRemove={handleRemove} 
        />

        {/* Suggested Comparisons - Show when no repos selected */}
        {selectedRepos.length === 0 && (
          <SuggestedComparisons onSelect={handleSelect} />
        )}

        {/* Content Based on View Mode */}
        <AnimatePresence mode="wait">
          {selectedRepos.length > 0 && (
            <motion.div
              key={viewMode}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {viewMode === "overview" && (
                <CompareRadar repositories={selectedRepos} />
              )}
              
              {viewMode === "battle" && (
                <CompareBattle repositories={selectedRepos} />
              )}
              
              {viewMode === "velocity" && (
                <CommitVelocity repositories={selectedRepos} />
              )}
              
              {viewMode === "metrics" && (
                <CompareMetrics repositories={selectedRepos} />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty State */}
        {selectedRepos.length === 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-24 text-center"
          >
            <div className="relative">
              <div className="size-24 rounded-3xl bg-linear-to-br from-indigo-500/10 to-purple-500/10 flex items-center justify-center border border-indigo-500/10 mb-6">
                <MaterialIcon name="compare_arrows" size={48} className="text-indigo-500/40" />
              </div>
              <motion.div
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 1, 0.5]
                }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute -top-2 -right-2 size-6 rounded-full bg-indigo-500"
              />
            </div>
            <h3 className="text-xl font-bold bg-linear-to-br from-foreground to-foreground/40 bg-clip-text text-transparent mb-2">
              Ready to Compare
            </h3>
            <p className="text-sm text-muted-foreground/60 max-w-sm leading-relaxed">
              Search for GitHub repositories above to visualize their engineering health, 
              activity velocity, and community engagement metrics side by side.
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
