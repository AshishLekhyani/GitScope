"use client";

import { useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { PRReviewer } from "@/features/intelligence/pr-reviewer";
import { CommitInspector } from "@/features/intelligence/commit-inspector";
import { RepoScanner } from "@/features/intelligence/repo-scanner";
import { PrDescriptionGenerator } from "@/features/intelligence/pr-description-generator";
import { AiGenerator } from "@/features/intelligence/ai-generator";
import { OsvScanner } from "@/features/intelligence/osv-scanner";
import { TestCoverage } from "@/features/intelligence/test-coverage";
import { PrQueue } from "@/features/intelligence/pr-queue";

type CodeLensTab = "pr-review" | "commit-inspect" | "repo-scan" | "osv" | "pr-desc" | "generate" | "coverage" | "pr-queue";

const TABS = [
  {
    id: "pr-review" as CodeLensTab,
    icon: "rate_review",
    label: "PR Review",
    description: "Security, breaking changes & merge verdict",
  },
  {
    id: "commit-inspect" as CodeLensTab,
    icon: "commit",
    label: "Commit Inspector",
    description: "Audit any commit SHA line-by-line",
  },
  {
    id: "repo-scan" as CodeLensTab,
    icon: "manage_search",
    label: "Repo Deep Scan",
    description: "Full codebase health & tech debt audit",
  },
  {
    id: "osv" as CodeLensTab,
    icon: "security",
    label: "CVE Scanner",
    description: "Google OSV database — known vulnerabilities",
  },
  {
    id: "pr-desc" as CodeLensTab,
    icon: "edit_note",
    label: "PR Description",
    description: "AI-written PR descriptions from your diff",
  },
  {
    id: "generate" as CodeLensTab,
    icon: "auto_awesome",
    label: "AI Generators",
    description: "Generate README & CHANGELOG with AI",
  },
  {
    id: "coverage" as CodeLensTab,
    icon: "science",
    label: "Test Coverage",
    description: "Coverage % via Codecov + framework detection",
  },
  {
    id: "pr-queue" as CodeLensTab,
    icon: "queue",
    label: "PR Queue",
    description: "Bulk AI review of all open PRs",
  },
];

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

  const isPro  = plan === "professional" || plan === "developer" || plan === "team" || plan === "enterprise";
  const isTeam = plan === "team" || plan === "enterprise";
  const canDeepScan            = isPro;
  const allowsPrivateRepo      = isPro;
  const fixDiffsAllowed        = isPro;
  const scheduledScansAllowed  = isPro;
  const customRulesAllowed     = isTeam;
  const multiBranchAllowed     = plan === "developer" || isTeam;
  const scanHistoryDays        = plan === "enterprise" ? 365 : plan === "team" ? 90 : (plan === "professional" || plan === "developer") ? 30 : 0;
  const primaryRepo = selectedRepos[0] ?? null;
  const activeTabConfig = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── Header strip ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-outline-variant/10">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
            <MaterialIcon name="auto_awesome" size={20} className="text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400/80">Code Lens</span>
              <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                {aiAgentDepth} depth
              </span>
            </div>
            <h2 className="text-lg font-black tracking-tight leading-tight">{activeTabConfig.label}</h2>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {primaryRepo && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container/50 border border-outline-variant/10 text-[10px] font-black text-muted-foreground/70">
              <MaterialIcon name="folder" size={11} className="text-indigo-400" />
              {primaryRepo}
            </div>
          )}
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-black",
            githubConnected
              ? "bg-emerald-500/5 border-emerald-500/15 text-emerald-400"
              : "bg-surface-container/40 border-outline-variant/10 text-muted-foreground/50"
          )}>
            <span className={cn("size-1.5 rounded-full", githubConnected ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/30")} />
            {githubConnected ? "GitHub Live" : "No GitHub"}
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 p-1 bg-surface-container/30 rounded-2xl border border-outline-variant/10 overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-all text-left min-w-max",
                isActive
                  ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                  : "text-muted-foreground/60 hover:text-foreground hover:bg-surface-container-highest/60"
              )}
            >
              <MaterialIcon name={tab.icon} size={15} className={isActive ? "text-white" : "text-muted-foreground/50"} />
              <div className="min-w-0">
                <div className={cn("text-[10px] font-black uppercase tracking-wider leading-none", isActive ? "text-white" : "")}>
                  {tab.label}
                </div>
                <div className={cn("text-[8px] mt-0.5 leading-tight truncate hidden sm:block", isActive ? "text-indigo-100/70" : "text-muted-foreground/40")}>
                  {tab.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* GitHub notice */}
      {!githubConnected && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/10">
          <MaterialIcon name="info" size={14} className="shrink-0 mt-0.5 text-amber-400" />
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Public repos work without authentication. For private repos,{" "}
            <a href="/settings" className="text-indigo-400 underline underline-offset-2">connect GitHub in Settings</a>.
          </p>
        </div>
      )}

      {/* ── Content ── */}
      <div className="min-h-80">
        {activeTab === "pr-review" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <PRReviewer
              selectedRepo={primaryRepo}
              canDeepScan={canDeepScan}
              allowsPrivateRepo={allowsPrivateRepo}
            />
          </div>
        )}
        {activeTab === "commit-inspect" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <CommitInspector
              selectedRepo={primaryRepo}
              canDeepScan={canDeepScan}
            />
          </div>
        )}
        {activeTab === "repo-scan" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <RepoScanner
              selectedRepo={primaryRepo}
              canDeepScan={canDeepScan}
              allowsPrivateRepo={allowsPrivateRepo}
              fixDiffsAllowed={fixDiffsAllowed}
              scheduledScansAllowed={scheduledScansAllowed}
              customRulesAllowed={customRulesAllowed}
              multiBranchAllowed={multiBranchAllowed}
              scanHistoryDays={scanHistoryDays}
              plan={plan}
            />
          </div>
        )}
        {activeTab === "osv" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <OsvScanner selectedRepo={primaryRepo} />
          </div>
        )}
        {activeTab === "pr-desc" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <PrDescriptionGenerator
              selectedRepo={primaryRepo}
              isPro={isPro}
            />
          </div>
        )}
        {activeTab === "generate" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <AiGenerator
              selectedRepo={primaryRepo}
              isPro={isPro}
            />
          </div>
        )}
        {activeTab === "coverage" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <TestCoverage repos={primaryRepo ? [primaryRepo] : []} />
          </div>
        )}
        {activeTab === "pr-queue" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <PrQueue selectedRepo={primaryRepo} isPro={isPro} />
          </div>
        )}
      </div>
    </div>
  );
}
