"use client";

import { useState, useEffect } from "react";
import { 
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts/es6";
import { SearchRepoResult } from "@/features/layout/top-nav";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import Image from "next/image";

interface CompareRadarProps {
  repositories: SearchRepoResult[];
}

interface RepoMetrics extends SearchRepoResult {
  watchers: number;
  forks: number;
  openIssues: number;
  size: number;
  updatedAt: string;
  docScore: number; // Simulated documentation quality
  activityScore: number; // Simulated activity score
}

export function CompareRadar({ repositories }: CompareRadarProps) {
  const [metrics, setMetrics] = useState<RepoMetrics[]>([]);

  useEffect(() => {
    if (repositories.length === 0) {
      setMetrics([]);
      return;
    }

    const fetchAllMetrics = async () => {
      try {
        const results = await Promise.all(
          repositories.map(async (repo) => {
            const res = await fetch(`/api/github/proxy?path=repos/${repo.owner}/${repo.repo}`);
            if (res.ok) {
              const data = await res.json();
              
              const docScore = Math.min(100, Math.max(20, (data.description?.length || 0) * 0.5 + 40));
              const lastPush = new Date(data.pushed_at).getTime();
              const now = Date.now();
              const daysSincePush = (now - lastPush) / (1000 * 60 * 60 * 24);
              const activityScore = Math.max(0, 100 - (daysSincePush * 2));

              return {
                ...repo,
                stars: data.stargazers_count,
                forks: data.forks_count,
                watchers: data.subscribers_count,
                openIssues: data.open_issues_count,
                size: data.size,
                updatedAt: data.pushed_at,
                docScore,
                activityScore
              };
            }
            return null;
          })
        );
        setMetrics(results.filter((r): r is RepoMetrics => r !== null));
      } catch (e) {
        console.error("Failed to fetch repo data", e);
      }
    };

    fetchAllMetrics();
  }, [repositories]);

  if (repositories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="size-16 rounded-3xl bg-indigo-500/5 flex items-center justify-center border border-indigo-500/10 mb-6">
          <MaterialIcon name="monitoring" size={32} className="text-indigo-500/20" />
        </div>
        <h3 className="text-xl font-bold bg-gradient-to-br from-foreground to-foreground/40 bg-clip-text text-transparent mb-2">
          Select Repositories to Start Comparison
        </h3>
        <p className="text-sm text-muted-foreground/60 max-w-sm leading-relaxed">
          Search for GitHub repositories above to visualize their engineering health, activity velocity, and community engagement metrics.
        </p>
      </div>
    );
  }

  // Clear metric comparison using BarChart
  // Dynamic comparison scaling
  const maxStars = Math.max(...metrics.map(r => Number(r.stars)), 1000);
  const maxForks = Math.max(...metrics.map(r => r.forks), 1000);
  const maxWatchers = Math.max(...metrics.map(r => r.watchers), 500);

  const chartData = [
    { subject: "Stars", full: 100 },
    { subject: "Forks", full: 100 },
    { subject: "Watchers", full: 100 },
    { subject: "Stability", full: 100 },
    { subject: "Docs", full: 100 },
    { subject: "Activity", full: 100 },
  ].map(item => {
    const dataPoint: Record<string, string | number> = { subject: item.subject };
    metrics.forEach(repo => {
      let val = 0;
      let raw = 0;
      if (item.subject === "Stars") {
        raw = Number(repo.stars);
        val = (raw / maxStars) * 100;
      }
      if (item.subject === "Forks") {
        raw = repo.forks;
        val = (raw / maxForks) * 100;
      }
      if (item.subject === "Watchers") {
        raw = repo.watchers;
        val = (raw / maxWatchers) * 100;
      }
      if (item.subject === "Stability") {
        raw = repo.openIssues;
        val = Math.max(0, 100 - (raw / 20));
      }
      if (item.subject === "Docs") {
        raw = repo.docScore;
        val = raw;
      }
      if (item.subject === "Activity") {
        raw = repo.activityScore;
        val = raw;
      }
      dataPoint[repo.repo] = Math.round(val);
      dataPoint[`${repo.repo}_raw`] = raw;
    });
    return dataPoint;
  });

  const colors = ["#818cf8", "#f472b6", "#fbbf24"];

  // Sort metrics by a weighted Engineering Quality Score
  const sortedMetrics = [...metrics].sort((a, b) => {
    const scoreA = (Number(a.stars) * 0.4) + (a.activityScore * 0.4) + (a.docScore * 0.2);
    const scoreB = (Number(b.stars) * 0.4) + (b.activityScore * 0.4) + (b.docScore * 0.2);
    return scoreB - scoreA;
  });

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        {/* Clearer Comparison Chart */}
        <div className="relative h-[450px] w-full bg-surface-container border border-outline-variant/20 rounded-3xl p-8 shadow-2xl overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
          <div className="flex items-center justify-between mb-8">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-indigo-500 animate-pulse" />
              Comparative Metric Performance
            </h4>
            <div className="flex items-center gap-4">
              {sortedMetrics.map((repo, idx) => (
                <div key={repo.repo} className="flex items-center gap-1.5">
                   <div className="size-2 rounded-full" style={{ backgroundColor: colors[idx % colors.length] }} />
                   <span className="text-[9px] font-bold text-muted-foreground uppercase">{repo.repo}</span>
                </div>
              ))}
            </div>
          </div>
          
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.05} />
              <XAxis 
                dataKey="subject" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: "currentColor", fontSize: 10, fontWeight: "black", opacity: 0.4 }} 
              />
              <YAxis axisLine={false} tickLine={false} tick={false} />
              <Tooltip 
                 cursor={{ fill: "currentColor", opacity: 0.05 }}
                 contentStyle={{ 
                   backgroundColor: "var(--surface-container-highest)", 
                   border: "1px solid var(--outline-variant)",
                   borderRadius: "16px",
                   fontSize: "12px",
                   fontWeight: "black",
                   boxShadow: "0 25px 50px -12px rgb(0 0 0 / 0.25)"
                 }}
                 formatter={(value, name, item) => {
                   const rawValue = (item?.payload as Record<string, number> | undefined)?.[`${String(name)}_raw`];
                   const displayValue = Number(rawValue || 0).toLocaleString();
                   return [`${value}% (${displayValue})`, String(name).toUpperCase()];
                 }}
              />
              {sortedMetrics.map((repo, idx) => (
                <Bar 
                  key={repo.repo} 
                  dataKey={repo.repo} 
                  fill={colors[idx % colors.length]} 
                  radius={[4, 4, 0, 0]} 
                  barSize={16}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Comparison Details Grid */}
        <div className="grid grid-cols-1 gap-4">
          {sortedMetrics.map((repo, idx) => (
            <div 
              key={`${repo.owner}/${repo.repo}`}
              className="flex items-center gap-6 p-6 rounded-3xl border border-outline-variant/10 bg-surface-container/40 backdrop-blur-sm transition-all hover:bg-surface-container-highest/60 group border-l-4 shadow-sm hover:shadow-xl"
              style={{ borderLeftColor: colors[idx % colors.length] }}
            >
              <Image src={repo.avatar} width={64} height={64} className="size-16 rounded-2xl shadow-xl group-hover:scale-105 transition-transform" alt="" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h5 className="font-heading font-black text-sm truncate uppercase tracking-tight text-foreground">
                    <span className="opacity-40">{repo.owner}/</span>{repo.repo}
                  </h5>
                  <div className="text-[10px] font-black text-indigo-500 bg-indigo-500/5 px-3 py-1 rounded-full border border-indigo-500/10 shadow-sm">
                    Ranked #{idx + 1}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground/80 font-medium line-clamp-1 mb-4 leading-relaxed">{repo.desc}</p>
                
                <div className="grid grid-cols-3 gap-8">
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-muted-foreground/50 block tracking-widest">Momentum</span>
                    <div className="flex items-center gap-1.5 font-black text-xs text-foreground">
                      <MaterialIcon name="trending_up" size={14} className="text-indigo-500" />
                      {Number(repo.stars).toLocaleString()}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-muted-foreground/50 block tracking-widest">Freshness</span>
                    <div className="flex items-center gap-1.5 font-black text-xs truncate text-foreground">
                      <MaterialIcon name="schedule" size={14} className="text-amber-500" />
                      {formatDistanceToNow(new Date(repo.updatedAt))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] font-black uppercase text-muted-foreground/50 block tracking-widest">Stability</span>
                    <div className={cn(
                      "flex items-center gap-1.5 font-black text-xs",
                      repo.openIssues < 50 ? "text-emerald-500" : "text-amber-500"
                    )}>
                      <MaterialIcon name="info" size={14} />
                      {repo.openIssues} Issues
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-indigo-500 shadow-[0_0_40px_rgba(99,102,241,0.2)] rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-8 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,white,transparent)] opacity-10" />
        <div className="relative z-10">
          <h4 className="text-2xl font-black mb-2 flex items-center gap-3">
             <MaterialIcon name="auto_awesome" size={24} />
             GitScope Analysis Complete
          </h4>
          <p className="text-indigo-100 text-sm max-w-xl leading-relaxed">
            Overall Health Score: **{Math.round(metrics.reduce((acc, r) => acc + (r.docScore + r.activityScore) / 2, 0) / metrics.length)} / 100**. 
            Our intelligence suggests {metrics.length > 1 ? `that ${metrics.sort((a, b) => b.activityScore - a.activityScore)[0].repo} is currently leading in development velocity.` : "you should compare against similar libraries to see relative engineering quality."}
          </p>
        </div>
        <button className="relative z-10 px-8 py-3 bg-white text-indigo-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-2xl">
          Export Intelligence PDF
        </button>
      </div>
    </div>
  );
}
