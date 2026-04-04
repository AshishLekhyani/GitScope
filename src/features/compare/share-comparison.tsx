"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MaterialIcon } from "@/components/material-icon";
import { SearchRepoResult } from "@/features/layout/top-nav";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/utils/formatDate";
import { cn } from "@/lib/utils";

interface ShareComparisonProps {
  repositories: SearchRepoResult[];
}

interface RepoMetrics {
  stars: number;
  forks: number;
  openIssues: number;
  closedIssues: number;
  contributors: number;
  prMergeRate: number;
  issueResolutionRate: number;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export function ShareComparison({ repositories }: ShareComparisonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"share" | "export">("share");
  const [exportFormat, setExportFormat] = useState<"markdown" | "json" | "csv" | "text">("markdown");
  const [metrics, setMetrics] = useState<Record<string, RepoMetrics>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeTab === "export" && repositories.length > 0 && Object.keys(metrics).length === 0) {
      fetchMetrics();
    }
  }, [activeTab, repositories]);

  const fetchMetrics = async () => {
    setLoading(true);
    const newMetrics: Record<string, RepoMetrics> = {};
    
    await Promise.all(
      repositories.map(async (repo) => {
        try {
          const [repoRes, pullsRes] = await Promise.all([
            fetch(`/api/github/proxy?path=repos/${repo.owner}/${repo.repo}`),
            fetch(`/api/github/repos/${repo.owner}/${repo.repo}/pulls?state=all&per_page=50`),
          ]);

          if (!repoRes.ok) return;
          
          const repoData = await repoRes.json();
          const pulls = pullsRes.ok ? await pullsRes.json() : { data: [] };
          const pullRequests = pulls.data || [];
          
          const mergedPRs = pullRequests.filter((p: any) => p.merged_at).length;
          const totalPRs = pullRequests.length;
          
          newMetrics[`${repo.owner}/${repo.repo}`] = {
            stars: repoData.stargazers_count || 0,
            forks: repoData.forks_count || 0,
            openIssues: repoData.open_issues_count || 0,
            closedIssues: repoData.closed_issues_count || 0,
            contributors: repoData.watchers_count || 0,
            prMergeRate: totalPRs > 0 ? (mergedPRs / totalPRs) * 100 : 0,
            issueResolutionRate: (repoData.open_issues_count || 0) + (repoData.closed_issues_count || 0) > 0
              ? ((repoData.closed_issues_count || 0) / ((repoData.open_issues_count || 0) + (repoData.closed_issues_count || 0))) * 100
              : 0,
            language: repoData.language || "Unknown",
            createdAt: repoData.created_at,
            updatedAt: repoData.pushed_at,
          };
        } catch (e) {
          console.error(`Failed to fetch metrics for ${repo.owner}/${repo.repo}`, e);
        }
      })
    );
    
    setMetrics(newMetrics);
    setLoading(false);
  };

  if (repositories.length === 0) return null;

  const shareUrl = typeof window !== "undefined" 
    ? `${window.location.origin}/compare?repos=${repositories.map(r => `${r.owner}/${r.repo}`).join(",")}`
    : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const calculateRankings = () => {
    const repoIds = repositories.map(r => `${r.owner}/${r.repo}`);
    const scored = repoIds.map(id => {
      const m = metrics[id] || { stars: 0, forks: 0, prMergeRate: 0, issueResolutionRate: 0 };
      return {
        id,
        name: id,
        score: (m.stars * 0.3) + (m.forks * 0.2) + (m.prMergeRate * 0.25) + (m.issueResolutionRate * 0.25),
        metrics: m,
      };
    });
    return scored.sort((a, b) => b.score - a.score);
  };

  const generateMarkdownReport = () => {
    const rankings = calculateRankings();
    const date = new Date().toLocaleDateString();
    
    let report = `# GitScope Repository Comparison Report\n\n`;
    report += `**Generated:** ${date}  \n`;
    report += `**URL:** ${shareUrl}\n\n`;
    
    report += `## Summary\n\n`;
    report += `| Rank | Repository | Stars | Forks | Health | PR Rate | Issues |\n`;
    report += `|------|------------|-------|-------|--------|---------|--------|\n`;
    
    rankings.forEach((r, i) => {
      const m = r.metrics;
      const health = m.issueResolutionRate > 70 ? "🟢" : m.issueResolutionRate > 40 ? "🟡" : "🔴";
      report += `| #${i + 1} | **${r.name}** | ${formatNumber(m.stars)} | ${formatNumber(m.forks)} | ${health} ${Math.round(m.issueResolutionRate)}% | ${Math.round(m.prMergeRate)}% | ${m.openIssues} open |\n`;
    });
    
    report += `\n## Detailed Metrics\n\n`;
    rankings.forEach((r, i) => {
      const m = r.metrics;
      report += `### ${i + 1}. ${r.name}\n\n`;
      report += `- **Primary Language:** ${m.language}\n`;
      report += `- **Stars:** ${formatNumber(m.stars)}\n`;
      report += `- **Forks:** ${formatNumber(m.forks)}\n`;
      report += `- **Contributors:** ${formatNumber(m.contributors)}\n`;
      report += `- **Open Issues:** ${m.openIssues}\n`;
      report += `- **Closed Issues:** ${m.closedIssues}\n`;
      report += `- **Issue Resolution Rate:** ${m.issueResolutionRate.toFixed(1)}%\n`;
      report += `- **PR Merge Rate:** ${m.prMergeRate.toFixed(1)}%\n`;
      report += `- **Created:** ${new Date(m.createdAt).toLocaleDateString()}\n`;
      report += `- **Last Updated:** ${new Date(m.updatedAt).toLocaleDateString()}\n\n`;
    });
    
    report += `---\n\n*Generated by GitScope - Repository Intelligence Platform*\n`;
    return report;
  };

  const generateJSONReport = () => {
    const rankings = calculateRankings();
    const data = {
      reportType: "GitScope Repository Comparison",
      generatedAt: new Date().toISOString(),
      url: shareUrl,
      summary: {
        totalRepositories: repositories.length,
        rankings: rankings.map((r, i) => ({
          rank: i + 1,
          repository: r.name,
          overallScore: Math.round(r.score),
          metrics: {
            stars: r.metrics.stars,
            forks: r.metrics.forks,
            openIssues: r.metrics.openIssues,
            closedIssues: r.metrics.closedIssues,
            contributors: r.metrics.contributors,
            prMergeRate: parseFloat(r.metrics.prMergeRate.toFixed(2)),
            issueResolutionRate: parseFloat(r.metrics.issueResolutionRate.toFixed(2)),
            primaryLanguage: r.metrics.language,
          },
        })),
      },
      repositories: rankings.map(r => ({
        fullName: r.name,
        url: `https://github.com/${r.name}`,
        metrics: r.metrics,
      })),
    };
    return JSON.stringify(data, null, 2);
  };

  const generateCSVReport = () => {
    const rankings = calculateRankings();
    let csv = "Rank,Repository,Stars,Forks,Contributors,Open Issues,Closed Issues,Issue Resolution %,PR Merge %,Language,Created At,Updated At\n";
    
    rankings.forEach((r, i) => {
      const m = r.metrics;
      csv += `${i + 1},${r.name},${m.stars},${m.forks},${m.contributors},${m.openIssues},${m.closedIssues},${m.issueResolutionRate.toFixed(2)},${m.prMergeRate.toFixed(2)},${m.language},${m.createdAt},${m.updatedAt}\n`;
    });
    
    return csv;
  };

  const generateTextReport = () => {
    const rankings = calculateRankings();
    const date = new Date().toLocaleDateString();
    
    let text = `GitScope Repository Comparison Report\n`;
    text += `${"=".repeat(50)}\n\n`;
    text += `Generated: ${date}\n`;
    text += `URL: ${shareUrl}\n\n`;
    text += `RANKINGS:\n`;
    text += `${"-".repeat(50)}\n\n`;
    
    rankings.forEach((r, i) => {
      const m = r.metrics;
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
      text += `${medal} #${i + 1} ${r.name}\n`;
      text += `    Score: ${Math.round(r.score)}/100\n`;
      text += `    Stars: ${formatNumber(m.stars)} | Forks: ${formatNumber(m.forks)}\n`;
      text += `    Health: ${m.issueResolutionRate.toFixed(1)}% | PR Rate: ${m.prMergeRate.toFixed(1)}%\n`;
      text += `    Issues: ${m.openIssues} open, ${m.closedIssues} closed\n`;
      text += `    Language: ${m.language}\n\n`;
    });
    
    text += `${"=".repeat(50)}\n`;
    text += "Generated by GitScope\n";
    return text;
  };

  const handleExport = () => {
    let content = "";
    let filename = "";
    let mimeType = "";

    switch (exportFormat) {
      case "markdown":
        content = generateMarkdownReport();
        filename = `gitscope-report-${Date.now()}.md`;
        mimeType = "text/markdown";
        break;
      case "json":
        content = generateJSONReport();
        filename = `gitscope-report-${Date.now()}.json`;
        mimeType = "application/json";
        break;
      case "csv":
        content = generateCSVReport();
        filename = `gitscope-report-${Date.now()}.csv`;
        mimeType = "text/csv";
        break;
      case "text":
        content = generateTextReport();
        filename = `gitscope-report-${Date.now()}.txt`;
        mimeType = "text/plain";
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    let content = "";
    switch (exportFormat) {
      case "markdown":
        content = generateMarkdownReport();
        break;
      case "json":
        content = generateJSONReport();
        break;
      case "csv":
        content = generateCSVReport();
        break;
      case "text":
        content = generateTextReport();
        break;
    }
    navigator.clipboard.writeText(content);
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="rounded-full border-indigo-500/20 text-indigo-500 hover:bg-indigo-500/10"
      >
        <MaterialIcon name="share" size={16} className="mr-2" />
        Share
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute right-0 top-full mt-2 w-96 z-50 rounded-2xl border border-outline-variant/10 bg-surface-container/95 backdrop-blur-xl shadow-2xl p-4"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-1 bg-surface-container-highest/50 rounded-lg p-1">
                <button
                  onClick={() => setActiveTab("share")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                    activeTab === "share"
                      ? "bg-indigo-500 text-white"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Share
                </button>
                <button
                  onClick={() => setActiveTab("export")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                    activeTab === "export"
                      ? "bg-indigo-500 text-white"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Export Report
                </button>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <MaterialIcon name="close" size={18} />
              </button>
            </div>

            {activeTab === "share" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Share Link
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={shareUrl}
                      readOnly
                      className="flex-1 bg-surface-container-highest/50 rounded-lg px-3 py-2 text-[10px] font-mono truncate border border-outline-variant/10"
                    />
                    <button
                      onClick={handleCopy}
                      className="px-3 py-2 rounded-lg bg-indigo-500 text-white text-xs font-bold hover:bg-indigo-600 transition-colors"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Share on Social
                  </label>
                  <div className="flex gap-2">
                    <a
                      href={`https://twitter.com/intent/tweet?text=Check out this repository comparison on GitScope!&url=${encodeURIComponent(shareUrl)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#1DA1F2]/10 text-[#1DA1F2] hover:bg-[#1DA1F2]/20 text-xs font-bold transition-colors"
                    >
                      <MaterialIcon name="chat" size={14} />
                      Twitter
                    </a>
                    <a
                      href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#0A66C2]/10 text-[#0A66C2] hover:bg-[#0A66C2]/20 text-xs font-bold transition-colors"
                    >
                      <MaterialIcon name="business_center" size={14} />
                      LinkedIn
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Export Format
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: "markdown", label: "Markdown", icon: "description" },
                      { id: "json", label: "JSON", icon: "data_object" },
                      { id: "csv", label: "CSV", icon: "table" },
                      { id: "text", label: "Text", icon: "text_snippet" },
                    ].map((format) => (
                      <button
                        key={format.id}
                        onClick={() => setExportFormat(format.id as any)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all",
                          exportFormat === format.id
                            ? "bg-indigo-500 text-white"
                            : "bg-surface-container-highest/50 hover:bg-surface-container-highest border border-outline-variant/10"
                        )}
                      >
                        <MaterialIcon name={format.icon} size={14} />
                        {format.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Preview
                  </label>
                  <div className="bg-surface-container-highest/50 rounded-lg p-3 border border-outline-variant/10 max-h-40 overflow-y-auto">
                    <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">
                      {loading 
                        ? "Loading repository data..." 
                        : Object.keys(metrics).length === 0
                          ? "Click Export to generate report..."
                          : exportFormat === "markdown" 
                            ? generateMarkdownReport().slice(0, 500) + "..."
                            : exportFormat === "json"
                              ? generateJSONReport().slice(0, 500) + "..."
                              : exportFormat === "csv"
                                ? generateCSVReport().split("\n").slice(0, 4).join("\n") + "..."
                                : generateTextReport().slice(0, 500) + "..."
                      }
                    </pre>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-surface-container-highest/50 hover:bg-surface-container-highest border border-outline-variant/10 text-xs font-bold transition-colors"
                  >
                    <MaterialIcon name="content_copy" size={14} />
                    Copy
                  </button>
                  <button
                    onClick={handleExport}
                    disabled={loading}
                    className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    <MaterialIcon name="download" size={14} />
                    {loading ? "Loading..." : "Download"}
                  </button>
                </div>
              </div>
            )}

            <div className="pt-3 mt-3 border-t border-outline-variant/10">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Selected ({repositories.length})
              </label>
              <div className="mt-2 flex flex-wrap gap-1">
                {repositories.map((repo) => (
                  <span 
                    key={`${repo.owner}/${repo.repo}`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-500 text-[10px] font-bold"
                  >
                    {repo.owner}/{repo.repo}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
