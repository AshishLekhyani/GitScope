"use client";

import { useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { PRReviewer } from "@/features/intelligence/pr-reviewer";
import { CommitInspector } from "@/features/intelligence/commit-inspector";
import { RepoScanner } from "@/features/intelligence/repo-scanner";

// ── Types ─────────────────────────────────────────────────────────────────────

type CodeLensTab = "pr-review" | "commit-inspect" | "repo-scan";

interface TabConfig {
  id: CodeLensTab;
  icon: string;
  label: string;
  shortLabel: string;
  badge?: string;
  badgeColor?: string;
  description: string;
  agentCount: number;
}

const TABS: TabConfig[] = [
  {
    id: "pr-review",
    icon: "rate_review",
    label: "PR Review",
    shortLabel: "PR Review",
    badge: "AI",
    badgeColor: "bg-indigo-500/20 text-indigo-400 border-indigo-500/20",
    description: "Multi-agent PR analysis: security scanning, breaking change detection, value assessment, and merge risk verdict.",
    agentCount: 6,
  },
  {
    id: "commit-inspect",
    icon: "commit",
    label: "Commit Inspector",
    shortLabel: "Commits",
    badge: "AI",
    badgeColor: "bg-indigo-500/20 text-indigo-400 border-indigo-500/20",
    description: "Inspect any commit SHA for security risks, quality regressions, and codebase impact — line by line.",
    agentCount: 6,
  },
  {
    id: "repo-scan",
    icon: "manage_search",
    label: "Repo Deep Scan",
    shortLabel: "Deep Scan",
    badge: "AI",
    badgeColor: "bg-violet-500/20 text-violet-400 border-violet-500/20",
    description: "Full codebase health audit — architecture, security posture, tech debt, dependencies, and prioritized roadmap.",
    agentCount: 6,
  },
];

// ── Main component ────────────────────────────────────────────────────────────

interface CodeReviewHubProps {
  selectedRepos: string[];
  plan: string;
  aiAgentDepth: number;
  aiRequestsPerHour: number;
  githubConnected: boolean;
}

export function CodeReviewHub({
  selectedRepos,
  plan,
  aiAgentDepth,
  githubConnected,
}: CodeReviewHubProps) {
  const [activeTab, setActiveTab] = useState<CodeLensTab>("pr-review");

  const canDeepScan = plan === "professional" || plan === "team" || plan === "enterprise";
  const allowsPrivateRepo =
    plan === "professional" || plan === "team" || plan === "enterprise";

  const primaryRepo = selectedRepos[0] ?? null;

  // ── Tab content ─────────────────────────────────────────────────────────────
  const renderContent = () => {
    switch (activeTab) {
      case "pr-review":
        return (
          <PRReviewer
            selectedRepo={primaryRepo}
            canDeepScan={canDeepScan}
            allowsPrivateRepo={allowsPrivateRepo}
          />
        );

      case "commit-inspect":
        return (
          <CommitInspector
            selectedRepo={primaryRepo}
            canDeepScan={canDeepScan}
          />
        );

      case "repo-scan":
        return (
          <RepoScanner
            selectedRepo={primaryRepo}
            canDeepScan={canDeepScan}
            allowsPrivateRepo={allowsPrivateRepo}
          />
        );

      default:
        return null;
    }
  };

  const activeTabConfig = TABS.find((t) => t.id === activeTab)!;

  // Agent pipeline display labels
  const AGENT_PIPELINE = [
    { icon: "security", label: "Security Sentinel" },
    { icon: "star_rate", label: "Quality Analyst" },
    { icon: "architecture", label: "Architecture Advisor" },
    { icon: "speed", label: "Performance Profiler" },
    { icon: "account_tree", label: "Dependency Inspector" },
    { icon: "psychology", label: "Debate Peer Reviewer" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-outline-variant/10">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/5 border border-violet-500/10">
              <MaterialIcon name="auto_awesome" size={12} className="text-violet-400" />
              <span className="text-[9px] font-black uppercase tracking-widest text-violet-400/80">
                Neural Code Lens
              </span>
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/5 border border-indigo-500/10 text-[8px] font-black text-indigo-400/80 uppercase tracking-widest">
              <span className="size-1.5 rounded-full bg-indigo-400 animate-pulse" />
              {activeTabConfig.agentCount} Agents
            </div>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">
            {activeTabConfig.label}
          </h2>
          <p className="text-xs text-muted-foreground/60 max-w-lg leading-relaxed">
            {activeTabConfig.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[9px] font-black uppercase tracking-widest">
          {primaryRepo && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container/40 border border-outline-variant/10 text-muted-foreground/70">
              <MaterialIcon name="folder" size={11} className="text-indigo-400" />
              {primaryRepo}
            </div>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container/40 border border-outline-variant/10 text-muted-foreground/50">
            <MaterialIcon name="psychology" size={11} className="text-indigo-400" />
            Depth {aiAgentDepth}
          </div>
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border",
            githubConnected
              ? "bg-emerald-500/5 border-emerald-500/15 text-emerald-400"
              : "bg-surface-container/40 border-outline-variant/10 text-muted-foreground/50"
          )}>
            <MaterialIcon name={githubConnected ? "link" : "link_off"} size={11} />
            {githubConnected ? "GitHub Connected" : "Not Linked"}
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="grid grid-cols-3 gap-2">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left transition-all",
                isActive
                  ? "bg-indigo-500/10 border-indigo-500/30"
                  : "bg-surface-container/20 border-outline-variant/8 hover:bg-surface-container/40 hover:border-outline-variant/20"
              )}
            >
              {tab.badge && (
                <span className={cn(
                  "absolute -top-1.5 -right-1 text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full border",
                  tab.badgeColor
                )}>
                  {tab.badge}
                </span>
              )}
              <div className={cn(
                "size-8 rounded-xl flex items-center justify-center shrink-0",
                isActive ? "bg-indigo-500/20" : "bg-surface-container/60"
              )}>
                <MaterialIcon name={tab.icon} size={16} className={isActive ? "text-indigo-400" : "text-muted-foreground/50"} />
              </div>
              <span className={cn(
                "text-[10px] font-black uppercase tracking-wider leading-tight",
                isActive ? "text-indigo-400" : "text-muted-foreground/60"
              )}>
                {tab.shortLabel}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Agent pipeline legend ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 mr-1">Agents:</span>
        {AGENT_PIPELINE.map((a) => (
          <div key={a.label} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-container/30 border border-outline-variant/8">
            <MaterialIcon name={a.icon} size={10} className="text-muted-foreground/40" />
            <span className="text-[8px] font-semibold text-muted-foreground/40">{a.label}</span>
          </div>
        ))}
      </div>

      {/* GitHub notice */}
      {!githubConnected && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10">
          <MaterialIcon name="info" size={15} className="shrink-0 mt-0.5 text-amber-400" />
          <div>
            <p className="text-xs font-black text-amber-400">GitHub not connected</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5 leading-relaxed">
              Public repos work without authentication. For private repos,{" "}
              <a href="/settings" className="text-indigo-400 underline underline-offset-2">connect GitHub in Settings</a>.
            </p>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      <div className="min-h-100">
        {renderContent()}
      </div>
    </div>
  );
}
