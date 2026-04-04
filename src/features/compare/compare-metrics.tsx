"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { SearchRepoResult } from "@/features/layout/top-nav";
import { MaterialIcon } from "@/components/material-icon";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/utils/formatDate";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import Image from "next/image";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend
} from "recharts/es6";
import {
  performAdvancedComparison,
  type RepositoryMetrics,
  type AdvancedComparisonResult,
  formatScoreWithIndicator,
} from "./comparison-algorithms";

interface CompareMetricsProps {
  repositories: SearchRepoResult[];
}

interface EnrichedRepoMetrics extends AdvancedComparisonResult {
  repoMeta: SearchRepoResult;
}

export function CompareMetrics({ repositories }: CompareMetricsProps) {
  const [comparisonResults, setComparisonResults] = useState<EnrichedRepoMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<"overview" | "languages" | "contributors" | "issues" | "prs" | "health" | "timeline">("overview");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const repoMetrics = await Promise.all(
          repositories.map(async (repo) => {
            const [repoRes, langRes, contribRes, pullsRes, commitRes] = await Promise.all([
              fetch(`/api/github/proxy?path=repos/${repo.owner}/${repo.repo}`),
              fetch(`/api/github/repos/${repo.owner}/${repo.repo}/languages`),
              fetch(`/api/github/repos/${repo.owner}/${repo.repo}/contributors`),
              fetch(`/api/github/repos/${repo.owner}/${repo.repo}/pulls?state=all&per_page=100`),
              fetch(`/api/github/repos/${repo.owner}/${repo.repo}/stats/commit_activity`),
            ]);

            if (!repoRes.ok) return null;

            const [repoData, langData, contribData, pullsData, commitData] = await Promise.all([
              repoRes.json(),
              langRes.ok ? langRes.json() : { data: {} },
              contribRes.ok ? contribRes.json() : { data: [] },
              pullsRes.ok ? pullsRes.json() : { data: [] },
              commitRes.ok ? commitRes.json() : { data: [] },
            ]);

            const contributors = contribData.data || [];
            const pulls = pullsData.data || [];
            const commitActivity = commitData.data || [];

            const openPRs = pulls.filter((p: any) => p.state === "open").length;
            const closedPRs = pulls.filter((p: any) => p.state === "closed" && !p.merged_at).length;
            const mergedPRs = pulls.filter((p: any) => p.merged_at).length;
            const totalPRs = pulls.length;
            const prMergeRate = totalPRs > 0 ? (mergedPRs / totalPRs) * 100 : 0;

            const mergedPRsWithTime = pulls.filter((p: any) => p.merged_at && p.created_at);
            let avgPRMergeTime: number | null = null;
            if (mergedPRsWithTime.length > 0) {
              const totalHours = mergedPRsWithTime.reduce((sum: number, p: any) => {
                const created = new Date(p.created_at).getTime();
                const merged = new Date(p.merged_at).getTime();
                return sum + (merged - created) / (1000 * 60 * 60);
              }, 0);
              avgPRMergeTime = totalHours / mergedPRsWithTime.length;
            }

            const metrics: RepositoryMetrics = {
              stars: repoData.stargazers_count,
              forks: repoData.forks_count,
              watchers: repoData.subscribers_count || 0,
              openIssues: repoData.open_issues_count,
              closedIssues: repoData.closed_issues_count || 0,
              contributors: contributors.length,
              commits: contributors.reduce((sum: number, c: any) => sum + c.contributions, 0),
              size: repoData.size,
              createdAt: repoData.created_at,
              updatedAt: repoData.pushed_at,
              language: repoData.language || "Unknown",
              languages: langData.data || {},
              prMergeRate,
              issueResolutionRate: (repoData.open_issues_count || 0) + (repoData.closed_issues_count || 0) > 0
                ? ((repoData.closed_issues_count || 0) / ((repoData.open_issues_count || 0) + (repoData.closed_issues_count || 0))) * 100
                : 0,
              avgPRMergeTime,
              hasWiki: repoData.has_wiki,
              hasPages: repoData.has_pages,
              hasDiscussions: repoData.has_discussions,
              hasProjects: repoData.has_projects,
              license: repoData.license?.spdx_id || null,
              codeOfConduct: !!repoData.code_of_conduct,
              networkCount: repoData.network_count || 0,
              subscribersCount: repoData.subscribers_count || 0,
              defaultBranch: repoData.default_branch,
              pullRequests: pulls,
              commitActivity,
              topContributors: contributors.slice(0, 10).map((c: any) => ({
                login: c.login,
                contributions: c.contributions,
                avatar: c.avatar_url,
              })),
            };

            return { metrics, repoMeta: repo };
          })
        );

        const validData = repoMetrics.filter((d): d is { metrics: RepositoryMetrics; repoMeta: SearchRepoResult } => d !== null);
        const metricsOnly = validData.map(d => d.metrics);
        const results = performAdvancedComparison(metricsOnly);
        
        // Enrich with repo metadata
        const enrichedResults = results.map((result, idx) => ({
          ...result,
          repoMeta: validData[idx].repoMeta,
        }));
        
        setComparisonResults(enrichedResults);
      } catch (e) {
        console.error("Failed to fetch metrics", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [repositories]);

  const getLanguageChartData = (languages: Record<string, number>) => {
    const total = Object.values(languages).reduce((sum, val) => sum + val, 0);
    return Object.entries(languages)
      .map(([name, value]) => ({
        name,
        value,
        percentage: total > 0 ? ((value / total) * 100).toFixed(1) : "0",
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  };

  const colors = ["#818cf8", "#f472b6", "#fbbf24", "#34d399", "#f87171", "#a78bfa"];
  const metricColors = ["#6366f1", "#ec4899", "#f59e0b"];

  const metricTabs = [
    { id: "overview", label: "Overview", icon: "dashboard" },
    { id: "languages", label: "Languages", icon: "code" },
    { id: "contributors", label: "Contributors", icon: "groups" },
    { id: "issues", label: "Issues", icon: "bug_report" },
    { id: "prs", label: "Pull Requests", icon: "merge_type" },
    { id: "health", label: "Health Score", icon: "favorite" },
    { id: "timeline", label: "Timeline", icon: "schedule" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center animate-pulse">
            <MaterialIcon name="analytics" size={24} className="text-indigo-500" />
          </div>
          <p className="text-sm text-muted-foreground">Gathering comprehensive metrics...</p>
        </div>
      </div>
    );
  }

  if (comparisonResults.length === 0) {
    return (
      <Card className="p-8 text-center">
        <MaterialIcon name="analytics" size={48} className="mx-auto text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-bold mb-2">No Metrics Available</h3>
        <p className="text-sm text-muted-foreground">Unable to fetch detailed repository metrics</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Tabs */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <MaterialIcon name="analytics" size={24} className="text-indigo-500" />
          <div>
            <h3 className="text-lg font-bold">Deep Metrics Analysis</h3>
            <p className="text-xs text-muted-foreground">Comprehensive repository intelligence</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-1 bg-surface-container/50 p-1 rounded-xl">
          {metricTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedMetric(tab.id as any)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all",
                selectedMetric === tab.id
                  ? "bg-indigo-500 text-white shadow-lg"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <MaterialIcon name={tab.icon} size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overview - Summary Cards with Advanced Scores */}
      {selectedMetric === "overview" && (
        <div className="space-y-4">
          {/* Overall Score Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {comparisonResults.map((result, idx) => (
              <motion.div key={result.repoMeta.repo} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}>
                <Card className={cn("p-5 relative overflow-hidden", idx === 0 && "border-amber-500/30")}>
                  <div className="flex items-center gap-3 mb-4">
                    <Image src={result.repoMeta.avatar} width={40} height={40} className="size-10 rounded-xl" alt="" />
                    <div>
                      <div className="font-bold">{result.repoMeta.repo}</div>
                      <div className="text-xs text-muted-foreground">{result.repoMeta.owner}</div>
                    </div>
                    <div className={cn("ml-auto px-2 py-1 rounded text-xs font-black", 
                      result.tier === "S" && "bg-yellow-500/20 text-yellow-600",
                      result.tier === "A" && "bg-emerald-500/20 text-emerald-600",
                      result.tier === "B" && "bg-blue-500/20 text-blue-600",
                      result.tier === "C" && "bg-slate-500/20 text-slate-600",
                      result.tier === "D" && "bg-rose-500/20 text-rose-600"
                    )}>
                      {result.tier}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-4xl font-black text-indigo-500">{Math.round(result.composite.overall)}</div>
                    <div className="text-xs text-muted-foreground">Overall Score<br/>Percentile: {Math.round(result.percentiles.overall)}%</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {result.badges.slice(0, 3).map((badge, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 text-[10px] font-bold">{badge}</span>
                    ))}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Composite Scores Grid */}
          <Card className="p-4 sm:p-6">
            <h4 className="text-sm font-bold mb-4">Composite Score Breakdown (Real Data)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {comparisonResults.map((result, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Image src={result.repoMeta.avatar} width={24} height={24} className="size-6 rounded" alt="" />
                    <span className="text-sm font-bold">{result.repoMeta.repo}</span>
                  </div>
                  {[
                    { label: "Influence", value: result.composite.influence, color: "text-amber-500" },
                    { label: "Velocity", value: result.composite.velocity, color: "text-blue-500" },
                    { label: "Quality", value: result.composite.quality, color: "text-emerald-500" },
                    { label: "Community", value: result.composite.communityHealth, color: "text-purple-500" },
                    { label: "Sustainability", value: result.composite.sustainability, color: "text-green-500" },
                    { label: "Momentum", value: result.composite.momentum, color: "text-rose-500" },
                  ].map((item) => (
                    <div key={item.label} className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className={cn("font-bold", item.color)}>{Math.round(item.value)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Languages View - Real GitHub Language Data */}
      {selectedMetric === "languages" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {comparisonResults.map((result, idx) => {
            const langData = getLanguageChartData(result.repo.languages);
            return (
              <motion.div key={result.repoMeta.repo} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}>
                <Card className="p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <Image src={result.repoMeta.avatar} width={40} height={40} className="size-10 rounded-xl" alt="" />
                    <div>
                      <div className="font-bold">{result.repoMeta.repo}</div>
                      <div className="text-xs text-muted-foreground">{result.repo.language} · {Object.keys(result.repo.languages).length} languages detected</div>
                    </div>
                  </div>
                  {langData.length > 0 ? (
                    <>
                      <div className="h-[200px] mb-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={langData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                              {langData.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
                            </Pie>
                            <Tooltip formatter={(_, name, props: any) => [`${props?.payload?.percentage || 0}%`, name]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-2">
                        {langData.map((lang, i) => (
                          <div key={lang.name} className="flex items-center gap-3">
                            <div className="size-3 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                            <span className="text-xs font-medium flex-1">{lang.name}</span>
                            <span className="text-xs text-muted-foreground">{lang.percentage}%</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">No language data</div>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Contributors View */}
      {selectedMetric === "contributors" && (
        <div className="grid gap-6">
          <Card className="p-6">
            <h4 className="text-sm font-bold mb-6">Contributor Comparison</h4>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonResults.map(r => ({ name: r.repoMeta.repo, contributors: r.repo.contributors }))} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" strokeOpacity={0.05} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11, fontWeight: 700 }} />
                  <Tooltip contentStyle={{ backgroundColor: "var(--surface-container-highest)", border: "1px solid var(--outline-variant)", borderRadius: "12px", fontSize: "12px" }} />
                  <Bar dataKey="contributors" fill="#818cf8" radius={[0, 4, 4, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {comparisonResults.map((result, idx) => (
              <Card key={result.repoMeta.repo} className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <Image src={result.repoMeta.avatar} width={32} height={32} className="size-8 rounded-lg" alt="" />
                  <div>
                    <div className="font-bold text-sm">{result.repoMeta.repo}</div>
                    <div className="text-[10px] text-muted-foreground">{result.repo.contributors} contributors (real)</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {result.repo.topContributors.slice(0, 3).map((contrib) => (
                    <div key={contrib.login} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container-highest/50">
                      <img src={contrib.avatar} alt="" className="size-6 rounded-full" />
                      <span className="text-xs font-medium flex-1">{contrib.login}</span>
                      <span className="text-xs font-bold text-indigo-500">{formatNumber(contrib.contributions)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Issues View */}
      {selectedMetric === "issues" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {comparisonResults.map((result, idx) => (
              <motion.div key={result.repoMeta.repo} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.1 }}>
                <Card className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <Image src={result.repoMeta.avatar} width={32} height={32} className="size-8 rounded-lg" alt="" />
                    <div>
                      <div className="font-bold text-sm">{result.repoMeta.repo}</div>
                      <div className="text-[10px] text-muted-foreground">Issues (Real Data)</div>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Open</span>
                      <span className="font-bold text-rose-500">{result.repo.openIssues}</span>
                    </div>
                    <Progress value={(result.repo.openIssues / ((result.repo.openIssues + result.repo.closedIssues) || 1)) * 100} className="h-2 bg-surface-container-highest" />
                    
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Closed</span>
                      <span className="font-bold text-emerald-500">{result.repo.closedIssues}</span>
                    </div>
                    <Progress value={(result.repo.closedIssues / ((result.repo.openIssues + result.repo.closedIssues) || 1)) * 100} className="h-2 bg-surface-container-highest" />
                    
                    <div className="pt-3 border-t border-outline-variant/10">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Resolution Rate</span>
                        <span className={cn("font-bold", result.repo.issueResolutionRate > 70 ? "text-emerald-500" : result.repo.issueResolutionRate > 40 ? "text-amber-500" : "text-rose-500")}>
                          {result.repo.issueResolutionRate.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>

          <Card className="p-6">
            <h4 className="text-sm font-bold mb-6">Issues Breakdown</h4>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonResults.map(r => ({ name: r.repoMeta.repo, open: r.repo.openIssues, closed: r.repo.closedIssues }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.05} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: "var(--surface-container-highest)", border: "1px solid var(--outline-variant)", borderRadius: "12px", fontSize: "12px" }} />
                  <Legend />
                  <Bar dataKey="open" fill="#f87171" name="Open" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="closed" fill="#34d399" name="Closed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* PRs View */}
      {selectedMetric === "prs" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {comparisonResults.map((result, idx) => (
              <motion.div key={result.repoMeta.repo} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.1 }}>
                <Card className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <Image src={result.repoMeta.avatar} width={32} height={32} className="size-8 rounded-lg" alt="" />
                    <div>
                      <div className="font-bold text-sm">{result.repoMeta.repo}</div>
                      <div className="text-[10px] text-muted-foreground">Pull Requests (Real Data)</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 text-center mb-4">
                    <div className="bg-blue-500/10 rounded-lg p-2">
                      <div className="text-lg font-bold text-blue-500">{result.repo.pullRequests.filter((p: any) => p.state === "open").length}</div>
                      <div className="text-[8px] uppercase text-muted-foreground">Open</div>
                    </div>
                    <div className="bg-purple-500/10 rounded-lg p-2">
                      <div className="text-lg font-bold text-purple-500">{result.repo.pullRequests.filter((p: any) => p.merged_at).length}</div>
                      <div className="text-[8px] uppercase text-muted-foreground">Merged</div>
                    </div>
                    <div className="bg-rose-500/10 rounded-lg p-2">
                      <div className="text-lg font-bold text-rose-500">{result.repo.pullRequests.filter((p: any) => p.state === "closed" && !p.merged_at).length}</div>
                      <div className="text-[8px] uppercase text-muted-foreground">Closed</div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Merge Rate</span>
                      <span className="font-bold">{result.repo.prMergeRate.toFixed(1)}%</span>
                    </div>
                    <Progress value={result.repo.prMergeRate} className="h-2 bg-surface-container-highest" />
                    
                    {result.repo.avgPRMergeTime && (
                      <div className="flex justify-between text-xs pt-2 border-t border-outline-variant/10">
                        <span className="text-muted-foreground">Avg Merge Time</span>
                        <span className="font-bold">{result.repo.avgPRMergeTime < 24 ? `${result.repo.avgPRMergeTime.toFixed(1)}h` : `${(result.repo.avgPRMergeTime / 24).toFixed(1)}d`}</span>
                      </div>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>

          <Card className="p-6">
            <h4 className="text-sm font-bold mb-6">Pull Request Status</h4>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonResults.map(r => ({ name: r.repoMeta.repo, open: r.repo.pullRequests.filter((p: any) => p.state === "open").length, merged: r.repo.pullRequests.filter((p: any) => p.merged_at).length, closed: r.repo.pullRequests.filter((p: any) => p.state === "closed" && !p.merged_at).length }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.05} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: "var(--surface-container-highest)", border: "1px solid var(--outline-variant)", borderRadius: "12px", fontSize: "12px" }} />
                  <Legend />
                  <Bar dataKey="open" fill="#3b82f6" name="Open" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="merged" fill="#a855f7" name="Merged" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="closed" fill="#f43f5e" name="Closed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* Health Score View - Using Real Algorithm Data */}
      {selectedMetric === "health" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {comparisonResults.map((result, idx) => (
              <motion.div key={result.repoMeta.repo} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.1 }}>
                <Card className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <Image src={result.repoMeta.avatar} width={40} height={40} className="size-10 rounded-xl" alt="" />
                    <div className="flex-1">
                      <div className="font-bold">{result.repoMeta.repo}</div>
                      <div className="flex items-center gap-2">
                        <span className={cn("text-2xl font-black", result.composite.quality > 70 ? "text-emerald-500" : result.composite.quality > 40 ? "text-amber-500" : "text-rose-500")}>
                          {Math.round(result.composite.quality)}
                        </span>
                        <span className="text-xs text-muted-foreground">/ 100 Quality</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {[
                      { label: "Bug Score", value: result.breakdowns.quality.bugScore, color: "bg-rose-500", icon: "bug_report" },
                      { label: "PR Quality", value: result.breakdowns.quality.prQuality, color: "bg-blue-500", icon: "merge_type" },
                      { label: "Maintenance", value: result.breakdowns.quality.maintenanceScore, color: "bg-emerald-500", icon: "build" },
                      { label: "Language Diversity", value: result.breakdowns.quality.langDiversity, color: "bg-purple-500", icon: "code" },
                      { label: "License", value: result.breakdowns.quality.licenseScore, color: "bg-amber-500", icon: "verified" },
                    ].map((item) => (
                      <div key={item.label} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <MaterialIcon name={item.icon} size={14} className="text-muted-foreground" />
                            <span className="text-muted-foreground">{item.label}</span>
                          </div>
                          <span className="font-bold">{Math.round(item.value)}</span>
                        </div>
                        <Progress value={item.value} className={cn("h-1.5 bg-surface-container-highest", item.color)} />
                      </div>
                    ))}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>

          <Card className="p-6">
            <h4 className="text-sm font-bold mb-6">Health Dimensions Comparison</h4>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={[
                  { subject: "Quality", ...Object.fromEntries(comparisonResults.map((r) => [r.repoMeta.repo, r.composite.quality])) },
                  { subject: "Sustainability", ...Object.fromEntries(comparisonResults.map((r) => [r.repoMeta.repo, r.composite.sustainability])) },
                  { subject: "Community", ...Object.fromEntries(comparisonResults.map((r) => [r.repoMeta.repo, r.composite.communityHealth])) },
                  { subject: "Velocity", ...Object.fromEntries(comparisonResults.map((r) => [r.repoMeta.repo, r.composite.velocity])) },
                  { subject: "Influence", ...Object.fromEntries(comparisonResults.map((r) => [r.repoMeta.repo, r.composite.influence])) },
                ]}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
                  {comparisonResults.map((result, idx) => (
                    <Radar
                      key={result.repoMeta.repo}
                      name={result.repoMeta.repo}
                      dataKey={result.repoMeta.repo}
                      stroke={metricColors[idx % metricColors.length]}
                      fill={metricColors[idx % metricColors.length]}
                      fillOpacity={0.3}
                    />
                  ))}
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* Timeline View - Real Data */}
      {selectedMetric === "timeline" && (
        <Card className="p-6">
          <h4 className="text-sm font-bold mb-6">Repository Timeline (Real Data)</h4>
          <div className="space-y-6">
            {comparisonResults.map((result, idx) => (
              <motion.div
                key={result.repoMeta.repo}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="relative pl-8 pb-6 last:pb-0 border-l-2 border-outline-variant/20 last:border-l-0"
              >
                <div className="absolute left-0 top-0 -translate-x-[5px] size-3 rounded-full bg-indigo-500" />
                <div className="flex items-start gap-4">
                  <Image src={result.repoMeta.avatar} width={48} height={48} className="size-12 rounded-xl" alt="" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-bold">{result.repoMeta.repo}</span>
                      <span className="text-xs text-muted-foreground">{result.repoMeta.owner}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <TimelineItem icon="add_circle" label="Created" value={formatDistanceToNow(new Date(result.repo.createdAt))} color="text-emerald-500" />
                      <TimelineItem icon="update" label="Last Push" value={formatDistanceToNow(new Date(result.repo.updatedAt))} color="text-blue-500" />
                      <TimelineItem icon="schedule" label="Age" value={`${Math.floor((Date.now() - new Date(result.repo.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365))} years`} color="text-amber-500" />
                      <TimelineItem icon="folder" label="Size" value={`${(result.repo.size / 1024).toFixed(1)} MB`} color="text-purple-500" />
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mt-3">
                      {result.repo.hasWiki && <FeatureTag icon="description" label="Wiki" />}
                      {result.repo.hasPages && <FeatureTag icon="web" label="Pages" />}
                      {result.repo.hasDiscussions && <FeatureTag icon="forum" label="Discussions" />}
                      {result.repo.hasProjects && <FeatureTag icon="task" label="Projects" />}
                      {result.repo.license && <FeatureTag icon="verified" label={result.repo.license} />}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function TimelineItem({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <MaterialIcon name={icon} size={16} className={color} />
      <div>
        <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xs font-bold">{value}</div>
      </div>
    </div>
  );
}

function FeatureTag({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-500 text-[10px] font-bold">
      <MaterialIcon name={icon} size={12} />
      {label}
    </div>
  );
}
