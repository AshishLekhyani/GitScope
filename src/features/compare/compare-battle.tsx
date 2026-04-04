"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SearchRepoResult } from "@/features/layout/top-nav";
import { MaterialIcon } from "@/components/material-icon";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/utils/formatDate";
import { cn } from "@/lib/utils";
import Image from "next/image";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts/es6";
import {
  performAdvancedComparison,
  BATTLE_ROUNDS,
  type RepositoryMetrics,
  type AdvancedComparisonResult,
  formatScoreWithIndicator,
  getTrendIcon,
} from "./comparison-algorithms";

interface CompareBattleProps {
  repositories: SearchRepoResult[];
}

export function CompareBattle({ repositories }: CompareBattleProps) {
  const [comparisonResults, setComparisonResults] = useState<AdvancedComparisonResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRound, setActiveRound] = useState(0);

  const activeBattleRound = BATTLE_ROUNDS[activeRound];

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const repoMetrics = await Promise.all(
          repositories.map(async (repo) => {
            const [
              repoRes, pullsRes, contribRes, commitRes, langRes
            ] = await Promise.all([
              fetch(`/api/github/proxy?path=repos/${repo.owner}/${repo.repo}`),
              fetch(`/api/github/repos/${repo.owner}/${repo.repo}/pulls?state=all&per_page=100`),
              fetch(`/api/github/repos/${repo.owner}/${repo.repo}/contributors`),
              fetch(`/api/github/repos/${repo.owner}/${repo.repo}/stats/commit_activity`),
              fetch(`/api/github/repos/${repo.owner}/${repo.repo}/languages`),
            ]);

            if (!repoRes.ok) return null;

            const repoData = await repoRes.json();
            const pulls = pullsRes.ok ? await pullsRes.json() : { data: [] };
            const contribs = contribRes.ok ? await contribRes.json() : { data: [] };
            const commits = commitRes.ok ? await commitRes.json() : { data: [] };
            const langs = langRes.ok ? await langRes.json() : { data: {} };

            const pullRequests = pulls.data || [];
            const contributors = contribs.data || [];
            const commitActivity = commits.data || [];

            const mergedPRs = pullRequests.filter((p: any) => p.merged_at).length;
            const prMergeRate = pullRequests.length > 0 ? (mergedPRs / pullRequests.length) * 100 : 0;

            const mergedPRsWithTime = pullRequests.filter((p: any) => p.merged_at && p.created_at);
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
              languages: langs.data || {},
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
              pullRequests,
              commitActivity,
              topContributors: contributors.slice(0, 10).map((c: any) => ({
                login: c.login,
                contributions: c.contributions,
                avatar: c.avatar_url,
              })),
            };

            return metrics;
          })
        );

        const validMetrics = repoMetrics.filter((m): m is RepositoryMetrics => m !== null);
        const results = performAdvancedComparison(validMetrics);
        setComparisonResults(results);
      } catch (e) {
        console.error("Failed to fetch battle data", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [repositories]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="size-16 rounded-full border-4 border-indigo-500/20 border-t-indigo-500"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <MaterialIcon name="psychology" size={24} className="text-indigo-500" />
            </div>
          </div>
          <p className="text-sm font-bold text-indigo-500">Running Complex Analysis...</p>
          <p className="text-xs text-muted-foreground">Calculating 7 composite indices</p>
        </div>
      </div>
    );
  }

  if (comparisonResults.length < 2) {
    return (
      <Card className="p-8 text-center">
        <div className="size-20 rounded-2xl bg-linear-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center mx-auto mb-4">
          <MaterialIcon name="sports_martial_arts" size={40} className="text-indigo-500" />
        </div>
        <h3 className="text-xl font-bold mb-2">Battle Mode Requires 2+ Repositories</h3>
        <p className="text-sm text-muted-foreground">Add more repositories for advanced comparison</p>
      </Card>
    );
  }

  const roundWinner = activeBattleRound.getWinner(comparisonResults);
  const overallWinner = comparisonResults[0];

  return (
    <div className="space-y-6">
      {/* Battle Header with Tier Badges */}
      <Card className="p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-r from-indigo-500/5 via-purple-500/5 to-pink-500/5" />
        <div className="relative z-10">
          <div className="flex justify-center gap-2 mb-4">
            {comparisonResults.map((result, idx) => (
              <motion.div
                key={idx}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: idx * 0.1 }}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-black",
                  result.tier === "S" && "bg-yellow-500/20 text-yellow-600 border border-yellow-500/30",
                  result.tier === "A" && "bg-emerald-500/20 text-emerald-600 border border-emerald-500/30",
                  result.tier === "B" && "bg-blue-500/20 text-blue-600 border border-blue-500/30",
                  result.tier === "C" && "bg-slate-500/20 text-slate-600 border border-slate-500/30",
                  result.tier === "D" && "bg-rose-500/20 text-rose-600 border border-rose-500/30"
                )}
              >
                {result.tier}-TIER
              </motion.div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-4 mb-6 flex-wrap">
            {comparisonResults.map((result, idx) => (
              <motion.div
                key={idx}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: idx * 0.2, type: "spring" }}
                className="flex items-center gap-3"
              >
                <div className="relative">
                  <Image 
                    src={repositories[idx]?.avatar || ""} 
                    width={56} 
                    height={56} 
                    className="size-14 rounded-2xl shadow-xl border-2 border-white" 
                    alt="" 
                  />
                  <div className="absolute -bottom-2 -right-2 size-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shadow-lg">
                    #{result.rank}
                  </div>
                </div>
                <div className="text-left">
                  <div className="font-bold text-lg">{repositories[idx]?.repo}</div>
                  <div className="text-xs text-muted-foreground">{repositories[idx]?.owner}</div>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs font-black">{formatScoreWithIndicator(result.composite.overall)}</span>
                  </div>
                </div>
                {idx < comparisonResults.length - 1 && (
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    className="mx-6 px-4 py-2 rounded-xl bg-linear-to-r from-indigo-500 to-purple-500 text-white text-sm font-black shadow-lg"
                  >
                    VS
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {BATTLE_ROUNDS.map((round, idx) => (
              <button
                key={round.id}
                onClick={() => setActiveRound(idx)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all",
                  activeRound === idx
                    ? `bg-linear-to-r ${round.color} text-white shadow-lg scale-105`
                    : "bg-surface-container/50 text-muted-foreground hover:text-foreground"
                )}
              >
                <MaterialIcon name={round.icon} size={14} />
                {round.title}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Round Winner Banner */}
      <AnimatePresence mode="wait">
        {roundWinner && (
          <motion.div
            key={activeBattleRound.id}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
          >
            <Card className={cn("p-6 relative overflow-hidden bg-linear-to-r", activeBattleRound.color)}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,white,transparent)] opacity-20" />
              <div className="relative z-10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="size-16 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
                    <MaterialIcon name="emoji_events" size={32} className="text-white" />
                  </div>
                  <div>
                    <div className="text-white/80 text-xs font-bold uppercase tracking-wider mb-1">
                      {activeBattleRound.title} Winner
                    </div>
                    <div className="text-white text-2xl font-black">
                      {repositories[comparisonResults.findIndex(r => r === roundWinner)]?.repo}
                    </div>
                    <div className="text-white/90 text-sm">
                      {activeBattleRound.getScoreDisplay(roundWinner)}
                    </div>
                  </div>
                </div>
                <div className="hidden md:flex flex-col items-end gap-2">
                  <div className="text-white/80 text-xs">Confidence: {Math.round(roundWinner.confidence)}%</div>
                  <div className="flex gap-1">
                    {roundWinner.badges.slice(0, 3).map((badge, i) => (
                      <span key={i} className="px-3 py-1 rounded-full bg-white/20 text-white text-xs font-bold backdrop-blur-sm">
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Round Content */}
      {activeRound === 0 && <InfluenceRound results={comparisonResults} repos={repositories} />}
      {activeRound === 1 && <VelocityRound results={comparisonResults} repos={repositories} />}
      {activeRound === 2 && <QualityRound results={comparisonResults} repos={repositories} />}
      {activeRound === 3 && <CommunityRound results={comparisonResults} repos={repositories} />}
      {activeRound === 4 && <SustainabilityRound results={comparisonResults} repos={repositories} />}
      {activeRound === 5 && <OverallRound results={comparisonResults} repos={repositories} />}
    </div>
  );
}

function InfluenceRound({ results, repos }: { results: AdvancedComparisonResult[]; repos: SearchRepoResult[] }) {
  const radarData = [
    { subject: "Stars", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.composite.influence])) },
    { subject: "Network", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.breakdowns.influence.networkScore])) },
    { subject: "Engagement", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.breakdowns.influence.engagementScore])) },
    { subject: "Diversity", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.breakdowns.influence.diversityScore])) },
    { subject: "Fork Impact", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.breakdowns.influence.forkScore])) },
  ];

  const colors = ["#f59e0b", "#f97316", "#ef4444"];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="p-6">
        <h4 className="text-sm font-bold mb-4 flex items-center gap-2">
          <MaterialIcon name="public" size={18} className="text-amber-500" />
          Influence Dimensions
        </h4>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke="currentColor" strokeOpacity={0.1} />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
              {results.map((r, i) => (
                <Radar
                  key={i}
                  name={repos[i]?.repo}
                  dataKey={repos[i]?.repo}
                  stroke={colors[i % colors.length]}
                  fill={colors[i % colors.length]}
                  fillOpacity={0.3}
                />
              ))}
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="space-y-4">
        {results.map((result, idx) => (
          <motion.div key={idx} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.1 }}>
            <Card className="p-4">
              <div className="flex items-center gap-4">
                <div className="size-12 rounded-xl bg-linear-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                  <span className="text-xl font-black text-amber-500">#{idx + 1}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Image src={repos[idx]?.avatar || ""} width={24} height={24} className="size-6 rounded-lg" alt="" />
                    <span className="font-bold">{repos[idx]?.repo}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Stars</span>
                      <span className="font-bold">{formatNumber(result.repo.stars)}</span>
                    </div>
                    <Progress value={result.breakdowns.influence.starScore} className="h-1 bg-surface-container-highest" />
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Forks</span>
                      <span className="font-bold">{formatNumber(result.repo.forks)}</span>
                    </div>
                    <Progress value={result.breakdowns.influence.forkScore} className="h-1 bg-surface-container-highest" />
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black text-amber-500">{Math.round(result.composite.influence)}</div>
                  <div className="text-[10px] text-muted-foreground">Percentile: {Math.round(result.percentiles.influence)}%</div>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function VelocityRound({ results, repos }: { results: AdvancedComparisonResult[]; repos: SearchRepoResult[] }) {
  const velocityData = results.map((r, i) => ({
    name: repos[i]?.repo,
    score: r.composite.velocity,
    weekly: r.breakdowns.velocity.weeklyAvg,
    consistency: r.breakdowns.velocity.consistency,
    acceleration: r.breakdowns.velocity.acceleration,
    trend: r.velocity.trend,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {results.map((result, idx) => (
          <motion.div key={idx} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: idx * 0.1 }}>
            <Card className={cn(
              "p-6 relative overflow-hidden",
              result.velocity.trend === "accelerating" && "border-emerald-500/30",
              result.velocity.trend === "decelerating" && "border-rose-500/30"
            )}>
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <Image src={repos[idx]?.avatar || ""} width={40} height={40} className="size-10 rounded-xl" alt="" />
                  <div>
                    <div className="font-bold">{repos[idx]?.repo}</div>
                    <div className="text-xs text-muted-foreground">Development Velocity</div>
                  </div>
                </div>

                <div className="flex items-center gap-4 mb-4">
                  <MaterialIcon 
                    name={getTrendIcon(result.velocity.trend)} 
                    size={32} 
                    className={cn(
                      result.velocity.trend === "accelerating" && "text-emerald-500",
                      result.velocity.trend === "stable" && "text-blue-500",
                      result.velocity.trend === "decelerating" && "text-rose-500"
                    )} 
                  />
                  <div>
                    <div className="text-3xl font-black">{Math.round(result.composite.velocity)}</div>
                    <div className="text-xs text-muted-foreground capitalize">{result.velocity.trend}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Weekly Avg</span>
                    <span className="font-bold">{result.breakdowns.velocity.weeklyAvg.toFixed(1)} commits</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Consistency</span>
                    <span className="font-bold">{Math.round(result.breakdowns.velocity.consistency)}%</span>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="p-6">
        <h4 className="text-sm font-bold mb-4">Velocity Breakdown</h4>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={velocityData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.05} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip 
                contentStyle={{ backgroundColor: "var(--surface-container-highest)", border: "1px solid var(--outline-variant)", borderRadius: "12px" }}
                formatter={(value) => [`${Math.round(Number(value) || 0)}`, ""]}
              />
              <Bar dataKey="score" fill="#3b82f6" name="Overall" radius={[4, 4, 0, 0]} />
              <Bar dataKey="consistency" fill="#10b981" name="Consistency" radius={[4, 4, 0, 0]} />
              <Bar dataKey="acceleration" fill="#f59e0b" name="Acceleration" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function QualityRound({ results, repos }: { results: AdvancedComparisonResult[]; repos: SearchRepoResult[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="p-6">
        <h4 className="text-sm font-bold mb-4 flex items-center gap-2">
          <MaterialIcon name="verified" size={18} className="text-emerald-500" />
          Quality Matrix
        </h4>
        <div className="space-y-4">
          {results.map((result, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Image src={repos[idx]?.avatar || ""} width={20} height={20} className="size-5 rounded" alt="" />
                  <span className="text-sm font-bold">{repos[idx]?.repo}</span>
                </div>
                <span className="text-xs text-muted-foreground">{Math.round(result.composite.quality)}/100</span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {[
                  { label: "Bug", value: result.breakdowns.quality.bugScore, color: "bg-rose-500" },
                  { label: "PR", value: result.breakdowns.quality.prQuality, color: "bg-blue-500" },
                  { label: "Maint", value: result.breakdowns.quality.maintenanceScore, color: "bg-emerald-500" },
                  { label: "Lang", value: result.breakdowns.quality.langDiversity, color: "bg-purple-500" },
                  { label: "Lic", value: result.breakdowns.quality.licenseScore, color: "bg-amber-500" },
                ].map((item, i) => (
                  <div key={i} className="space-y-1">
                    <div className="text-[8px] text-center text-muted-foreground truncate">{item.label}</div>
                    <div className="h-16 bg-surface-container-highest rounded-md relative overflow-hidden">
                      <motion.div 
                        initial={{ height: 0 }}
                        animate={{ height: `${item.value}%` }}
                        transition={{ delay: idx * 0.1 + i * 0.05, duration: 0.5 }}
                        className={cn("absolute bottom-0 w-full", item.color)}
                      />
                    </div>
                    <div className="text-[8px] text-center font-bold">{Math.round(item.value)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="space-y-4">
        {results.map((result, idx) => (
          <Card key={idx} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Image src={repos[idx]?.avatar || ""} width={24} height={24} className="size-6 rounded" alt="" />
                <span className="font-bold text-sm">{repos[idx]?.repo}</span>
              </div>
              <div className="flex items-center gap-2">
                <MaterialIcon name="verified" size={16} className="text-emerald-500" />
                <span className="text-lg font-black text-emerald-500">{Math.round(result.composite.quality)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-center">
                <div className="text-lg font-bold text-emerald-500">{result.repo.prMergeRate.toFixed(0)}%</div>
                <div className="text-[9px] text-muted-foreground uppercase">PR Merge Rate</div>
              </div>
              <div className="p-2 rounded-lg bg-blue-500/10 text-center">
                <div className="text-lg font-bold text-blue-500">{result.repo.issueResolutionRate.toFixed(0)}%</div>
                <div className="text-[9px] text-muted-foreground uppercase">Issue Resolution</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CommunityRound({ results, repos }: { results: AdvancedComparisonResult[]; repos: SearchRepoResult[] }) {
  const communityData = results.map((r, i) => ({
    name: repos[i]?.repo,
    overall: r.composite.communityHealth,
    contributors: r.breakdowns.communityHealth.contributorScore,
    distribution: r.breakdowns.communityHealth.distributionScore,
    onboarding: r.breakdowns.communityHealth.onboardingScore,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {results.map((result, idx) => (
          <motion.div key={idx} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: idx * 0.1 }}>
            <Card className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="size-12 rounded-xl bg-linear-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                  <MaterialIcon name="groups" size={24} className="text-purple-500" />
                </div>
                <div>
                  <div className="font-bold">{repos[idx]?.repo}</div>
                  <div className="text-xs text-muted-foreground">{result.repo.contributors} contributors</div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Distribution Health</span>
                  <span className="text-sm font-bold">{Math.round(result.breakdowns.communityHealth.distributionScore)}%</span>
                </div>
                <Progress value={result.breakdowns.communityHealth.distributionScore} className="h-2" />

                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Onboarding</span>
                  <span className="text-sm font-bold">{Math.round(result.breakdowns.communityHealth.onboardingScore)}%</span>
                </div>
                <Progress value={result.breakdowns.communityHealth.onboardingScore} className="h-2" />

                <div className="pt-3 border-t border-outline-variant/10">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Overall Score</span>
                    <span className="text-2xl font-black text-purple-500">{Math.round(result.composite.communityHealth)}</span>
                  </div>
                </div>
              </div>

              {result.repo.topContributors.length > 0 && (
                <div className="mt-4 pt-3 border-t border-outline-variant/10">
                  <div className="text-xs text-muted-foreground mb-2">Top Contributors</div>
                  <div className="flex -space-x-2">
                    {result.repo.topContributors.slice(0, 5).map((c, i) => (
                      <img key={i} src={c.avatar} alt="" className="size-6 rounded-full border-2 border-white" title={`${c.login}: ${c.contributions} commits`} />
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="p-6">
        <h4 className="text-sm font-bold mb-4">Community Health Comparison</h4>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={communityData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" strokeOpacity={0.05} />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: "var(--surface-container-highest)", border: "1px solid var(--outline-variant)", borderRadius: "12px" }} />
              <Bar dataKey="contributors" fill="#a855f7" name="Contributors" radius={[0, 4, 4, 0]} stackId="a" />
              <Bar dataKey="distribution" fill="#ec4899" name="Distribution" radius={[0, 4, 4, 0]} stackId="a" />
              <Bar dataKey="onboarding" fill="#3b82f6" name="Onboarding" radius={[0, 4, 4, 0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function SustainabilityRound({ results, repos }: { results: AdvancedComparisonResult[]; repos: SearchRepoResult[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="p-6">
        <h4 className="text-sm font-bold mb-4 flex items-center gap-2">
          <MaterialIcon name="eco" size={18} className="text-green-500" />
          Sustainability Factors
        </h4>
        <div className="space-y-4">
          {results.map((result, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex items-center gap-2">
                <Image src={repos[idx]?.avatar || ""} width={20} height={20} className="size-5 rounded" alt="" />
                <span className="text-sm font-bold">{repos[idx]?.repo}</span>
                <span className="ml-auto text-sm font-black text-green-500">{Math.round(result.composite.sustainability)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded bg-green-500/10">
                  <div className="text-green-500 font-bold">{Math.round(result.breakdowns.sustainability.recencyScore)}%</div>
                  <div className="text-muted-foreground">Recency</div>
                </div>
                <div className="p-2 rounded bg-emerald-500/10">
                  <div className="text-emerald-500 font-bold">{Math.round(result.breakdowns.sustainability.issueHealth)}%</div>
                  <div className="text-muted-foreground">Issue Health</div>
                </div>
                <div className="p-2 rounded bg-blue-500/10">
                  <div className="text-blue-500 font-bold">{Math.round(result.breakdowns.sustainability.prEfficiency)}%</div>
                  <div className="text-muted-foreground">PR Efficiency</div>
                </div>
                <div className="p-2 rounded bg-amber-500/10">
                  <div className="text-amber-500 font-bold">{Math.round(result.breakdowns.sustainability.docScore)}%</div>
                  <div className="text-muted-foreground">Documentation</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h4 className="text-sm font-bold mb-4">Project Features</h4>
        <div className="space-y-3">
          {results.map((result, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-surface-container-highest/50">
              <div className="flex items-center gap-2">
                <Image src={repos[idx]?.avatar || ""} width={24} height={24} className="size-6 rounded" alt="" />
                <span className="font-medium text-sm">{repos[idx]?.repo}</span>
              </div>
              <div className="flex gap-2">
                {result.repo.hasWiki && <FeatureBadge icon="description" label="Wiki" />}
                {result.repo.hasPages && <FeatureBadge icon="web" label="Pages" />}
                {result.repo.hasDiscussions && <FeatureBadge icon="forum" label="Discussions" />}
                {result.repo.hasProjects && <FeatureBadge icon="task" label="Projects" />}
                {result.repo.license && <FeatureBadge icon="verified" label={result.repo.license} />}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function OverallRound({ results, repos }: { results: AdvancedComparisonResult[]; repos: SearchRepoResult[] }) {
  const winner = results[0];
  const winnerRepo = repos[0];

  return (
    <div className="space-y-6">
      <Card className="p-8 relative overflow-hidden bg-linear-to-r from-yellow-500 via-amber-500 to-orange-500">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,white,transparent)] opacity-20" />
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative z-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm mb-4">
            <MaterialIcon name="emoji_events" size={18} className="text-white" />
            <span className="text-white text-sm font-bold uppercase tracking-wider">Grand Champion</span>
          </div>
          <div className="flex items-center justify-center gap-6 mb-6">
            <div className="relative">
              <Image src={winnerRepo?.avatar || ""} width={80} height={80} className="size-20 rounded-2xl shadow-2xl border-4 border-white" alt="" />
              <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 2, repeat: Infinity }} className="absolute -top-4 -right-4 size-10 rounded-full bg-white text-amber-500 flex items-center justify-center shadow-lg">
                <MaterialIcon name="crown" size={24} />
              </motion.div>
            </div>
            <div className="text-left">
              <div className="text-white/80 text-sm">{winnerRepo?.owner}</div>
              <div className="text-white text-3xl font-black">{winnerRepo?.repo}</div>
              <div className="text-white/90 text-lg font-bold">
                {formatScoreWithIndicator(winner.composite.overall)} / 100
              </div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {winner.badges.map((badge, i) => (
              <span key={i} className="px-3 py-1 rounded-full bg-white/20 text-white text-xs font-bold backdrop-blur-sm">
                {badge}
              </span>
            ))}
          </div>
          {winner.predictions.growthTrajectory !== "plateau" && (
            <div className="mt-4 text-white/80 text-sm">
              Projected: +{formatNumber(winner.predictions.projectedStars30d)} stars in 30 days
            </div>
          )}
        </motion.div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h4 className="text-sm font-bold mb-4">Composite Score Breakdown</h4>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={[
                { subject: "Influence", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.composite.influence])) },
                { subject: "Velocity", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.composite.velocity])) },
                { subject: "Quality", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.composite.quality])) },
                { subject: "Community", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.composite.communityHealth])) },
                { subject: "Sustainability", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.composite.sustainability])) },
                { subject: "Momentum", ...Object.fromEntries(results.map((r, i) => [repos[i]?.repo, r.composite.momentum])) },
              ]}>
                <PolarGrid stroke="currentColor" strokeOpacity={0.1} />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
                {results.map((r, i) => (
                  <Radar
                    key={i}
                    name={repos[i]?.repo}
                    dataKey={repos[i]?.repo}
                    stroke={["#6366f1", "#ec4899", "#f59e0b"][i % 3]}
                    fill={["#6366f1", "#ec4899", "#f59e0b"][i % 3]}
                    fillOpacity={0.3}
                  />
                ))}
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="space-y-3">
          {results.map((result, idx) => (
            <motion.div key={idx} initial={{ x: -50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.15 }}>
              <Card className={cn("p-4 relative overflow-hidden", idx === 0 ? "bg-linear-to-r from-amber-500/10 to-transparent border-amber-500/30" : "")}>
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "size-12 rounded-xl flex items-center justify-center font-black text-xl",
                    idx === 0 ? "bg-amber-500 text-white" : 
                    idx === 1 ? "bg-slate-400 text-white" : 
                    idx === 2 ? "bg-orange-600 text-white" : 
                    "bg-surface-container-highest"
                  )}>
                    #{idx + 1}
                  </div>
                  <Image src={repos[idx]?.avatar || ""} width={48} height={48} className="size-12 rounded-xl" alt="" />
                  <div className="flex-1">
                    <div className="font-bold">{repos[idx]?.repo}</div>
                    <div className="text-xs text-muted-foreground">{repos[idx]?.owner}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-indigo-500">{Math.round(result.composite.overall)}</div>
                    <div className="text-[10px] text-muted-foreground uppercase">{result.tier}-Tier</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-6 gap-1">
                  {[
                    { label: "Inf", value: result.composite.influence },
                    { label: "Vel", value: result.composite.velocity },
                    { label: "Qual", value: result.composite.quality },
                    { label: "Com", value: result.composite.communityHealth },
                    { label: "Sus", value: result.composite.sustainability },
                    { label: "Mom", value: result.composite.momentum },
                  ].map((item, i) => (
                    <div key={i} className="text-center">
                      <div className="text-[8px] text-muted-foreground">{item.label}</div>
                      <div className="text-xs font-bold">{Math.round(item.value)}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureBadge({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10 text-green-500 text-[10px] font-bold">
      <MaterialIcon name={icon} size={10} />
      {label}
    </div>
  );
}
