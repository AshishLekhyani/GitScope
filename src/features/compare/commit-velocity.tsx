"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { SearchRepoResult } from "@/features/layout/top-nav";
import { MaterialIcon } from "@/components/material-icon";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/utils/formatDate";
import Image from "next/image";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts/es6";

interface CommitVelocityProps {
  repositories: SearchRepoResult[];
}

interface VelocityData {
  owner: string;
  repo: string;
  avatar: string;
  weeklyData: { week: number; total: number }[];
  totalCommits: number;
  avgWeekly: number;
  trend: "up" | "down" | "stable";
}

export function CommitVelocity({ repositories }: CommitVelocityProps) {
  const [velocityData, setVelocityData] = useState<VelocityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<4 | 12 | 26>(12); // weeks

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const results = await Promise.all(
          repositories.map(async (repo) => {
            const res = await fetch(
              `/api/github/repos/${repo.owner}/${repo.repo}/stats/commit_activity`
            );
            if (res.ok) {
              const data = await res.json();
              const weeklyData = data.data || [];
              const totalCommits = weeklyData.reduce((sum: number, w: any) => sum + w.total, 0);
              const avgWeekly = weeklyData.length > 0 ? totalCommits / weeklyData.length : 0;
              
              // Calculate trend
              const recent = weeklyData.slice(-4).reduce((sum: number, w: any) => sum + w.total, 0);
              const previous = weeklyData.slice(-8, -4).reduce((sum: number, w: any) => sum + w.total, 0);
              const trend = recent > previous * 1.1 ? "up" : recent < previous * 0.9 ? "down" : "stable";

              return {
                owner: repo.owner,
                repo: repo.repo,
                avatar: repo.avatar,
                weeklyData: weeklyData.map((w: any, i: number) => ({ week: i, total: w.total })),
                totalCommits,
                avgWeekly: Math.round(avgWeekly),
                trend,
              };
            }
            return null;
          })
        );
        setVelocityData(results.filter((r): r is VelocityData => r !== null));
      } catch (e) {
        console.error("Failed to fetch velocity data", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [repositories]);

  const getChartData = () => {
    const weeks = timeRange;
    const chartData = [];
    
    for (let i = 0; i < weeks; i++) {
      const point: Record<string, number | string> = { 
        week: `W${i + 1}`,
        index: i 
      };
      
      velocityData.forEach((repo) => {
        const weekData = repo.weeklyData[repo.weeklyData.length - weeks + i];
        point[repo.repo] = weekData?.total || 0;
      });
      
      chartData.push(point);
    }
    
    return chartData;
  };

  const colors = ["#818cf8", "#f472b6", "#fbbf24"];
  const gradients = [
    { from: "#818cf8", to: "#6366f1" },
    { from: "#f472b6", to: "#ec4899" },
    { from: "#fbbf24", to: "#f59e0b" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center animate-pulse">
            <MaterialIcon name="speed" size={24} className="text-indigo-500" />
          </div>
          <p className="text-sm text-muted-foreground">Analyzing commit velocity...</p>
        </div>
      </div>
    );
  }

  if (velocityData.length === 0) {
    return (
      <Card className="p-8 text-center">
        <MaterialIcon name="speed" size={48} className="mx-auto text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-bold mb-2">No Velocity Data</h3>
        <p className="text-sm text-muted-foreground">Unable to fetch commit activity data</p>
      </Card>
    );
  }

  const chartData = getChartData();

  return (
    <div className="space-y-6">
      {/* Header with Time Range Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <MaterialIcon name="speed" size={24} className="text-indigo-500" />
          <div>
            <h3 className="text-lg font-bold">Commit Velocity Analysis</h3>
            <p className="text-xs text-muted-foreground">Weekly development activity trends</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 bg-surface-container/50 p-1 rounded-xl">
          {[
            { value: 4, label: "1M" },
            { value: 12, label: "3M" },
            { value: 26, label: "6M" },
          ].map((range) => (
            <button
              key={range.value}
              onClick={() => setTimeRange(range.value as 4 | 12 | 26)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                timeRange === range.value
                  ? "bg-indigo-500 text-white shadow-lg"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {velocityData.map((repo, idx) => (
          <motion.div
            key={repo.repo}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <Image src={repo.avatar} width={40} height={40} className="size-10 rounded-xl" alt="" />
                <div>
                  <div className="font-bold text-sm">{repo.repo}</div>
                  <div className="text-[10px] text-muted-foreground">{repo.owner}</div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-black text-foreground">{formatNumber(repo.totalCommits)}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Total</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-indigo-500">{repo.avgWeekly}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Avg/Week</div>
                </div>
                <div className="text-center">
                  <div className={`flex items-center justify-center gap-1 text-2xl font-black ${
                    repo.trend === "up" ? "text-emerald-500" : 
                    repo.trend === "down" ? "text-rose-500" : "text-amber-500"
                  }`}>
                    <MaterialIcon 
                      name={repo.trend === "up" ? "trending_up" : repo.trend === "down" ? "trending_down" : "trending_flat"} 
                      size={20} 
                    />
                  </div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Trend</div>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Main Chart */}
      <Card className="p-6">
        <div className="h-[350px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                {gradients.map((grad, idx) => (
                  <linearGradient key={idx} id={`gradient-${idx}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={grad.from} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={grad.to} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.05} />
              <XAxis 
                dataKey="week" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: "currentColor", fontSize: 10, opacity: 0.4 }} 
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: "currentColor", fontSize: 10, opacity: 0.4 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--surface-container-highest)",
                  border: "1px solid var(--outline-variant)",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
                formatter={(value, name) => [formatNumber(Number(value || 0)), String(name)]}
              />
              {velocityData.map((repo, idx) => (
                <Area
                  key={repo.repo}
                  type="monotone"
                  dataKey={repo.repo}
                  stroke={colors[idx % colors.length]}
                  strokeWidth={2}
                  fill={`url(#gradient-${idx})`}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        
        {/* Legend */}
        <div className="flex flex-wrap items-center justify-center gap-6 mt-4 pt-4 border-t border-outline-variant/10">
          {velocityData.map((repo, idx) => (
            <div key={repo.repo} className="flex items-center gap-2">
              <div 
                className="size-3 rounded-full" 
                style={{ backgroundColor: colors[idx % colors.length] }}
              />
              <span className="text-xs font-bold">{repo.repo}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Weekly Breakdown Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {velocityData.map((repo, idx) => {
          const recentWeeks = repo.weeklyData.slice(-timeRange);
          const maxCommits = Math.max(...recentWeeks.map(w => w.total), 1);
          
          return (
            <motion.div
              key={repo.repo}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.1 }}
            >
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Image src={repo.avatar} width={24} height={24} className="size-6 rounded-lg" alt="" />
                  <span className="font-bold text-sm">{repo.repo}</span>
                </div>
                
                <div className="flex items-end gap-1 h-24">
                  {recentWeeks.map((week, weekIdx) => (
                    <motion.div
                      key={weekIdx}
                      initial={{ height: 0 }}
                      animate={{ height: `${(week.total / maxCommits) * 100}%` }}
                      transition={{ delay: weekIdx * 0.02, duration: 0.3 }}
                      className="flex-1 rounded-t-sm min-h-[2px]"
                      style={{ backgroundColor: colors[idx % colors.length] }}
                      title={`Week ${weekIdx + 1}: ${week.total} commits`}
                    />
                  ))}
                </div>
                
                <div className="flex justify-between mt-2 text-[9px] text-muted-foreground font-bold uppercase tracking-wider">
                  <span>{timeRange} weeks ago</span>
                  <span>This week</span>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
