"use client";

import { useState, useEffect } from "react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell
} from "recharts/es6";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

interface VelocityMetrics {
  name: string;
  metrics: {
    leadTime: number;
    cycleTime: number;
    freq: number;
    count: number;
    busFactor: number;
  } | null;
}

export function VelocityChart({ repos }: { repos: string[] }) {
  const [data, setData] = useState<VelocityMetrics[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (repos.length === 0) return;

    const fetchMetrics = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/user/dora-metrics?repos=${encodeURIComponent(repos.join(","))}`);
        if (res.ok) {
          const payload = await res.json();
          setData(Array.isArray(payload) ? payload : (payload.items ?? []));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [repos]);

  const chartData = data.filter(d => d.metrics).map(d => ({
    name: d.name.split("/")[1],
    "Cycle Time (hrs)": d.metrics?.cycleTime,
    "Lead Time (hrs)": d.metrics?.leadTime,
    "Frequency": d.metrics?.freq,
    score: d.metrics?.cycleTime ? (d.metrics.cycleTime < 24 ? "Elite" : d.metrics.cycleTime < 72 ? "High" : "Medium") : "N/A"
  }));

  if (loading) {
     return (
        <div className="flex flex-col items-center justify-center py-48 gap-6 animate-pulse bg-surface-container/10 rounded-3xl border border-dashed border-outline-variant/10">
           <div className="size-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <MaterialIcon name="speed" size={32} className="text-indigo-500/30" />
           </div>
           <div className="text-center space-y-2">
              <p className="text-[10px] font-black font-sans uppercase tracking-[0.2em] text-muted-foreground/40">
                 Syncing Engineering Pulse
              </p>
              <div className="text-xs font-bold text-muted-foreground/20">Analyzing commit velocity & cycle time...</div>
           </div>
        </div>
     );
  }

  if (data.length > 0 && !data.some(d => d.metrics)) {
    return (
      <div className="flex flex-col items-center justify-center py-48 text-center bg-surface-container/10 rounded-3xl border-2 border-dashed border-outline-variant/10 group">
         <MaterialIcon name="api" size={48} className="text-muted-foreground/10 mb-6 group-hover:scale-110 transition-transform" />
         <h4 className="text-xl font-bold">Velocity Metrics Unavailable</h4>
         <p className="text-sm text-muted-foreground/60 max-w-sm mx-auto mt-2 italic leading-relaxed">
           Insufficient merged Pull Request data to calculate cycle time for the current selection. This usually happens with very new repositories or inactive branches.
         </p>
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Velocity Chart */}
        <div className="lg:col-span-2 bg-surface-container/30 border border-outline-variant/10 rounded-3xl p-8 relative overflow-hidden group">
           <div className="flex items-center justify-between mb-8 relative z-10">
              <div>
                 <h4 className="text-sm font-bold flex items-center gap-2">
                    <MaterialIcon name="query_stats" size={20} className="text-indigo-500" />
                    Lead Time vs Cycle Time
                 </h4>
                 <p className="text-[10px] text-muted-foreground mt-1 font-medium italic">
                    Lower is better. Reflects the speed from PR creation to merge.
                 </p>
              </div>
           </div>

           <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                 <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.1} vertical={false} />
                    <XAxis 
                       dataKey="name" 
                       axisLine={false} 
                       tickLine={false} 
                       tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} 
                    />
                    <YAxis 
                       axisLine={false} 
                       tickLine={false} 
                       tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} 
                    />
                    <Tooltip 
                       cursor={{ fill: "rgba(99, 102, 241, 0.05)" }}
                       contentStyle={{ 
                          backgroundColor: "rgba(15, 23, 42, 0.95)", 
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "bold"
                       }}
                    />
                    <Bar dataKey="Cycle Time (hrs)" fill="#818cf8" radius={[4, 4, 0, 0]} barSize={24}>
                       {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.score === "Elite" ? "#10b981" : "#818cf8"} />
                       ))}
                    </Bar>
                    <Bar dataKey="Lead Time (hrs)" fill="#f472b6" radius={[4, 4, 0, 0]} barSize={8} />
                 </BarChart>
              </ResponsiveContainer>
           </div>
        </div>

        {/* Health Summary List */}
        <div className="space-y-4">
           {data.map((repo) => {
              const score = repo.metrics?.cycleTime ? (repo.metrics.cycleTime < 24 ? "Elite" : repo.metrics.cycleTime < 72 ? "High" : "Medium") : "N/A";
              return (
                 <div key={repo.name} className="p-5 rounded-2xl bg-surface-container/30 border border-outline-variant/10 hover:bg-surface-container-highest/50 transition-all flex items-center justify-between group">
                    <div className="flex items-center gap-4 min-w-0">
                       <div className={cn(
                          "size-10 rounded-xl flex items-center justify-center shrink-0 border",
                          score === "Elite" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" :
                          score === "High" ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-500" :
                          "bg-amber-500/10 border-amber-500/20 text-amber-500"
                       )}>
                          <MaterialIcon name={score === "Elite" ? "rocket_launch" : "trending_up"} size={20} />
                       </div>
                       <div className="min-w-0">
                          <div className="text-xs font-black truncate uppercase tracking-tight">{repo.name.split("/")[1]}</div>
                          <div className="text-[10px] text-muted-foreground font-bold">
                             {repo.metrics?.count} Merges / Month 
                             {repo.metrics?.busFactor && repo.metrics.busFactor < 3 && (
                                <span className="ml-2 text-red-500 font-black tracking-tighter">! SILO RISK</span>
                             )}
                          </div>
                       </div>
                    </div>
                    <div className="text-right">
                       <div className={cn(
                          "text-[10px] font-black uppercase tracking-widest",
                          score === "Elite" ? "text-emerald-500" : score === "High" ? "text-indigo-500" : "text-amber-500"
                       )}>
                          {score}
                       </div>
                       <div className="text-xs font-black opacity-100 mt-0.5">{repo.metrics?.cycleTime}h cycle</div>
                    </div>
                 </div>
              );
           })}
        </div>
      </div>

      {(() => {
        const validRepos = data.filter(d => d.metrics);
        const avgCycleHrs = validRepos.length > 0
          ? validRepos.reduce((s, d) => s + (d.metrics!.cycleTime), 0) / validRepos.length
          : 0;
        const fleetCycleAvg = validRepos.length === 0 ? "—"
          : avgCycleHrs < 24 ? `${avgCycleHrs.toFixed(0)}h`
          : `${(avgCycleHrs / 24).toFixed(1)}d`;
        const doraRating = avgCycleHrs === 0 ? "—"
          : avgCycleHrs < 24 ? "Elite"
          : avgCycleHrs < 168 ? "High"
          : avgCycleHrs < 720 ? "Medium" : "Low";
        const doraColor = doraRating === "Elite" ? "text-emerald-500/50" : doraRating === "High" ? "text-indigo-500/50" : "text-amber-500/50";
        const avgBusFactor = validRepos.length === 0 ? "—"
          : (validRepos.reduce((s, d) => s + (d.metrics!.busFactor || 0), 0) / validRepos.length).toFixed(1);
        const avgFreq = validRepos.length === 0 ? "—"
          : (validRepos.reduce((s, d) => s + (d.metrics!.freq || 0), 0) / validRepos.length).toFixed(2) + "/day";
        return (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="p-8 rounded-3xl bg-surface-container/50 border border-outline-variant/10 flex flex-col items-center text-center">
              <MaterialIcon name="history" size={32} className="text-indigo-500/50 mb-4" />
              <div className="text-2xl font-black mb-1">{fleetCycleAvg}</div>
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Fleet Cycle Avg</div>
            </div>
            <div className="p-8 rounded-3xl bg-surface-container/50 border border-outline-variant/10 flex flex-col items-center text-center">
              <MaterialIcon name="speed" size={32} className={`${doraColor} mb-4`} />
              <div className="text-2xl font-black mb-1">{doraRating}</div>
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">DORA Performance</div>
            </div>
            <div className="p-8 rounded-3xl bg-surface-container/50 border border-outline-variant/10 flex flex-col items-center text-center">
              <MaterialIcon name="groups" size={32} className="text-amber-500/50 mb-4" />
              <div className="text-2xl font-black mb-1">{avgBusFactor}</div>
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Mean Bus Factor</div>
            </div>
            <div className="p-8 rounded-3xl bg-surface-container/50 border border-outline-variant/10 flex flex-col items-center text-center">
              <MaterialIcon name="bolt" size={32} className="text-purple-500/50 mb-4" />
              <div className="text-2xl font-black mb-1">{avgFreq}</div>
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">PR Merge Rate</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
