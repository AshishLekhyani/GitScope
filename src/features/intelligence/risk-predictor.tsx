"use client";

import { useState, useEffect } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import Image from "next/image";

interface ScoredPR {
  id: number;
  number: number;
  title: string;
  user: string;
  avatar: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  riskScore: number;
  riskLevel: "CRITICAL" | "MODERATE" | "STABLE";
  analysis: string;
}

export function RiskPredictor({ repo }: { repo: string }) {
  const [prs, setPrs] = useState<ScoredPR[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!repo) return;

    const fetchRisk = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/user/pr-risk?repo=${encodeURIComponent(repo)}`);
        if (res.ok) {
          setPrs(await res.json());
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchRisk();
  }, [repo]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 animate-pulse">
        <MaterialIcon name="security" size={48} className="text-amber-500/20" />
        <p className="text-xs font-bold text-muted-foreground/40 uppercase tracking-widest">
          Calculating predictive risk vectors...
        </p>
      </div>
    );
  }

  if (prs.length === 0) {
    return (
      <div className="py-24 text-center bg-surface-container/20 rounded-3xl border border-dashed border-outline-variant/20">
         <MaterialIcon name="verified" size={48} className="text-emerald-500/10 mb-4" />
         <h4 className="text-xl font-bold">No High Risk Scenarios</h4>
         <p className="text-sm text-muted-foreground/60 mt-2">All current PRs appear to follow standard repository patterns.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
         <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 px-2 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
            Predicted Risk Vectors
         </h4>
         <div className="flex items-center gap-2 text-[10px] font-black text-amber-500 uppercase px-3 py-1 rounded-full bg-amber-500/5 border border-amber-500/10">
            Scanning {prs.length} Open Pull Requests
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {prs.map((pr) => (
          <div 
            key={pr.id}
            className={cn(
              "p-6 rounded-3xl border transition-all hover:scale-[1.01] flex flex-col gap-6 group",
              pr.riskLevel === "CRITICAL" 
                ? "bg-red-500/5 border-red-500/20" 
                : pr.riskLevel === "MODERATE"
                  ? "bg-amber-500/5 border-amber-500/20"
                  : "bg-surface-container/30 border-outline-variant/10"
            )}
          >
            <div className="flex items-center justify-between">
               <div className="flex items-center gap-4">
                  <div className="relative">
                     <Image src={pr.avatar} width={48} height={48} className="size-12 rounded-2xl shadow-xl" alt="" />
                     <div className={cn(
                        "absolute -bottom-1 -right-1 size-5 rounded-lg flex items-center justify-center border-2 border-background shadow-lg",
                        pr.riskLevel === "CRITICAL" ? "bg-red-500" : pr.riskLevel === "MODERATE" ? "bg-amber-500" : "bg-emerald-500"
                     )}>
                        <MaterialIcon name={pr.riskLevel === "CRITICAL" ? "error" : pr.riskLevel === "MODERATE" ? "warning" : "check"} size={12} className="text-white" />
                     </div>
                  </div>
                  <div>
                     <div className="text-xs font-black tracking-tight">{pr.title}</div>
                     <div className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">PR #{pr.number} by {pr.user}</div>
                  </div>
               </div>
               <div className="text-right">
                  <div className={cn(
                    "text-2xl font-black italic",
                    pr.riskLevel === "CRITICAL" ? "text-red-500" : pr.riskLevel === "MODERATE" ? "text-amber-500" : "text-emerald-500"
                  )}>{pr.riskScore}</div>
                  <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">Risk Index</div>
               </div>
            </div>

            <div className="grid grid-cols-3 gap-6 py-4 border-y border-outline-variant/10">
               <div className="text-center">
                  <div className="text-xs font-black text-emerald-500">+{pr.additions}</div>
                  <div className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">Added</div>
               </div>
               <div className="text-center">
                  <div className="text-xs font-black text-red-500">-{pr.deletions}</div>
                  <div className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">Removed</div>
               </div>
               <div className="text-center">
                  <div className="text-xs font-black text-indigo-500">{pr.changedFiles}</div>
                  <div className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">Files</div>
               </div>
            </div>

            <div className="space-y-3">
               <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
                  <MaterialIcon name="psychology" size={14} className="text-indigo-400" />
                  AI Reasoning
               </div>
               <p className="text-xs font-medium leading-relaxed italic text-muted-foreground">
                  &quot;{pr.analysis}&quot;
               </p>
            </div>
            
            <button className="w-full py-3 rounded-2xl bg-surface-container-highest text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500 hover:text-white transition-all">
               Run Deep Code Impact Scan
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
