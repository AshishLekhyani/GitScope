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
import { formatNumber } from "@/utils/formatDate";

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

  // Generate PDF content as HTML for printing
  const handleExportPDF = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const date = new Date().toLocaleDateString();
    const overallScore = Math.round(metrics.reduce((acc, r) => acc + (r.docScore + r.activityScore) / 2, 0) / metrics.length);
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>GitScope Intelligence Report</title>
        <style>
          @page { size: A4; margin: 20mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 40px; }
          h1 { color: #6366f1; font-size: 28px; border-bottom: 3px solid #6366f1; padding-bottom: 10px; }
          h2 { color: #4f46e5; font-size: 20px; margin-top: 30px; }
          .header { text-align: center; margin-bottom: 40px; }
          .date { color: #666; font-size: 14px; }
          .score-card { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 30px; border-radius: 16px; text-align: center; margin: 30px 0; }
          .score-number { font-size: 64px; font-weight: bold; }
          .score-label { font-size: 14px; opacity: 0.9; text-transform: uppercase; letter-spacing: 2px; }
          .repo-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 15px 0; }
          .repo-header { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
          .repo-rank { background: #6366f1; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; }
          .repo-name { font-size: 18px; font-weight: bold; color: #1e293b; }
          .repo-owner { color: #64748b; font-size: 14px; }
          .metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 15px; }
          .metric { text-align: center; padding: 15px; background: white; border-radius: 8px; }
          .metric-value { font-size: 24px; font-weight: bold; color: #6366f1; }
          .metric-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-top: 5px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background: #6366f1; color: white; padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
          td { padding: 12px; border-bottom: 1px solid #e2e8f0; }
          tr:nth-child(even) { background: #f8fafc; }
          .footer { text-align: center; margin-top: 50px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🎯 GitScope Intelligence Report</h1>
          <p class="date">Generated on ${date}</p>
        </div>
        
        <div class="score-card">
          <div class="score-number">${overallScore}</div>
          <div class="score-label">Overall Health Score</div>
        </div>

        <h2>📊 Repository Rankings</h2>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Repository</th>
              <th>Stars</th>
              <th>Activity</th>
              <th>Docs</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
    `;

    sortedMetrics.forEach((repo, idx) => {
      const score = Math.round((Number(repo.stars) * 0.4) + (repo.activityScore * 0.4) + (repo.docScore * 0.2));
      html += `
        <tr>
          <td><strong>#${idx + 1}</strong></td>
          <td>${repo.owner}/${repo.repo}</td>
          <td>${Number(repo.stars).toLocaleString()}</td>
          <td>${Math.round(repo.activityScore)}%</td>
          <td>${Math.round(repo.docScore)}%</td>
          <td>${repo.openIssues}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>

        <h2>📈 Detailed Analysis</h2>
    `;

    sortedMetrics.forEach((repo, idx) => {
      const score = Math.round((Number(repo.stars) * 0.4) + (repo.activityScore * 0.4) + (repo.docScore * 0.2));
      html += `
        <div class="repo-card">
          <div class="repo-header">
            <div class="repo-rank">${idx + 1}</div>
            <div>
              <div class="repo-name">${repo.repo}</div>
              <div class="repo-owner">${repo.owner}</div>
            </div>
          </div>
          <div class="metrics-grid">
            <div class="metric">
              <div class="metric-value">${Number(repo.stars).toLocaleString()}</div>
              <div class="metric-label">Stars</div>
            </div>
            <div class="metric">
              <div class="metric-value">${repo.forks.toLocaleString()}</div>
              <div class="metric-label">Forks</div>
            </div>
            <div class="metric">
              <div class="metric-value">${repo.watchers.toLocaleString()}</div>
              <div class="metric-label">Watchers</div>
            </div>
            <div class="metric">
              <div class="metric-value">${Math.round(repo.activityScore)}%</div>
              <div class="metric-label">Activity</div>
            </div>
            <div class="metric">
              <div class="metric-value">${Math.round(repo.docScore)}%</div>
              <div class="metric-label">Documentation</div>
            </div>
            <div class="metric">
              <div class="metric-value">${repo.openIssues}</div>
              <div class="metric-label">Open Issues</div>
            </div>
          </div>
          <p style="margin-top: 15px; color: #64748b; font-size: 14px;">
            <strong>Last updated:</strong> ${formatDistanceToNow(new Date(repo.updatedAt))} ago
          </p>
        </div>
      `;
    });

    html += `
        <div class="footer">
          <p>Generated by GitScope - Repository Intelligence Platform</p>
          <p style="font-size: 11px; margin-top: 5px;">${window.location.origin}/compare</p>
        </div>
        
        <div class="no-print" style="text-align: center; margin-top: 30px;">
          <button onclick="window.print()" style="background: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: bold;">
            🖨️ Print / Save as PDF
          </button>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

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
        <button 
          onClick={handleExportPDF}
          className="relative z-10 px-8 py-3 bg-white text-indigo-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-2xl flex items-center gap-2"
        >
          <MaterialIcon name="download" size={16} />
          Export Intelligence PDF
        </button>
      </div>
    </div>
  );
}
