"use client";

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  headBranch: string;
  event: string;
  durationMs: number | null;
}

interface WorkflowGroup {
  name: string;
  runs: WorkflowRun[];
  passRate: number;
  avgDurationMs: number | null;
}

interface CiData {
  repo: string;
  workflows: WorkflowGroup[];
  overallPassRate: number;
  latestConclusion: string | null;
  latestStatus: string;
}

interface CiStatusProps {
  repos: string[];
}

function runColors(conclusion: string | null, status: string) {
  if (status === "in_progress" || status === "queued")
    return { text: "text-blue-400",   bg: "bg-blue-500/10",    border: "border-blue-500/20",    dot: "bg-blue-400"    };
  if (conclusion === "success")
    return { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", dot: "bg-emerald-400" };
  if (conclusion === "failure")
    return { text: "text-red-400",    bg: "bg-red-500/10",     border: "border-red-500/20",     dot: "bg-red-400"    };
  if (conclusion === "cancelled")
    return { text: "text-muted-foreground", bg: "bg-muted",    border: "border-outline-variant/20", dot: "bg-muted-foreground" };
  return { text: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20",   dot: "bg-amber-400"   };
}

function runLabel(conclusion: string | null, status: string) {
  if (status === "in_progress") return "Running";
  if (status === "queued") return "Queued";
  if (!conclusion) return "Pending";
  return conclusion.charAt(0).toUpperCase() + conclusion.slice(1);
}

function fmtDuration(ms: number | null) {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

export function CiStatus({ repos }: CiStatusProps) {
  const [data, setData] = useState<Record<string, CiData | "loading" | "error" | "no-ci">>({});

  useEffect(() => {
    repos.forEach((repo) => {
      if (data[repo]) return;
      setData((prev) => ({ ...prev, [repo]: "loading" }));
      loadRepo(repo);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos]);

  async function loadRepo(repo: string) {
    try {
      const res = await fetch(`/api/github/ci-runs?repo=${encodeURIComponent(repo)}`);
      if (res.status === 403 || res.status === 404) {
        setData((prev) => ({ ...prev, [repo]: "no-ci" }));
        return;
      }
      if (!res.ok) {
        setData((prev) => ({ ...prev, [repo]: "error" }));
        return;
      }
      const json = await res.json();
      if (json.noCi) { setData((prev) => ({ ...prev, [repo]: "no-ci" })); return; }
      processRuns(repo, Array.isArray(json.workflow_runs) ? json.workflow_runs : []);
    } catch {
      setData((prev) => ({ ...prev, [repo]: "error" }));
    }
  }

  function processRuns(repo: string, runs: Record<string, unknown>[]) {
    if (runs.length === 0) {
      setData((prev) => ({ ...prev, [repo]: "no-ci" }));
      return;
    }

    const byWorkflow: Record<string, WorkflowRun[]> = {};
    for (const r of runs) {
      const name = (r.name as string) ?? String(r.workflow_id ?? "Unknown");
      if (!byWorkflow[name]) byWorkflow[name] = [];
      const created = new Date(r.created_at as string).getTime();
      const updated = new Date(r.updated_at as string).getTime();
      const conclusion = (r.conclusion as string | null) ?? null;
      const status = (r.status as string) ?? "";
      byWorkflow[name].push({
        id: r.id as number,
        status,
        conclusion,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
        headBranch: (r.head_branch as string) ?? "",
        event: (r.event as string) ?? "",
        durationMs: status === "completed" && conclusion ? updated - created : null,
      });
    }

    const workflows: WorkflowGroup[] = Object.entries(byWorkflow)
      .map(([name, wRuns]) => {
        const completed = wRuns.filter((r) => r.conclusion === "success" || r.conclusion === "failure");
        const passes = completed.filter((r) => r.conclusion === "success").length;
        const timed = wRuns.filter((r) => r.durationMs !== null);
        const avgDurationMs =
          timed.length > 0
            ? Math.round(timed.reduce((s, r) => s + (r.durationMs ?? 0), 0) / timed.length)
            : null;
        return {
          name,
          runs: wRuns.slice(0, 12),
          passRate: completed.length > 0 ? Math.round((passes / completed.length) * 100) : 0,
          avgDurationMs,
        };
      })
      .sort((a, b) => b.runs.length - a.runs.length);

    const allCompleted = runs.filter((r) => r.conclusion === "success" || r.conclusion === "failure");
    const allPasses = allCompleted.filter((r) => r.conclusion === "success").length;
    const overallPassRate = allCompleted.length > 0 ? Math.round((allPasses / allCompleted.length) * 100) : 0;
    const latest = runs[0];

    setData((prev) => ({
      ...prev,
      [repo]: {
        repo,
        workflows,
        overallPassRate,
        latestConclusion: (latest?.conclusion as string | null) ?? null,
        latestStatus: (latest?.status as string) ?? "unknown",
      },
    }));
  }

  if (repos.length === 0) return null;

  return (
    <div className="space-y-10">
      {repos.map((repo) => {
        const state = data[repo];
        return (
          <div key={repo} className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                <MaterialIcon name="rocket_launch" size={16} className="text-cyan-400" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-cyan-400/80">CI/CD Status</p>
                <p className="text-sm font-black">{repo}</p>
              </div>
            </div>

            {state === "loading" && (
              <div className="flex items-center justify-center gap-3 py-16 rounded-3xl border border-outline-variant/10 bg-surface-container/20">
                <MaterialIcon name="sync" size={18} className="animate-spin text-cyan-400" />
                <span className="text-sm text-muted-foreground/60">Fetching GitHub Actions runs…</span>
              </div>
            )}

            {state === "no-ci" && (
              <div className="flex flex-col items-center gap-4 py-16 text-center rounded-3xl border-2 border-dashed border-outline-variant/15 bg-surface-container/10">
                <MaterialIcon name="rocket_launch" size={32} className="text-muted-foreground/20" />
                <div>
                  <p className="text-sm font-black text-foreground/60">No CI/CD workflows found</p>
                  <p className="text-xs text-muted-foreground/40 mt-1 max-w-xs mx-auto">
                    This repo has no GitHub Actions workflows, or Actions are disabled / private.
                  </p>
                </div>
              </div>
            )}

            {state === "error" && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                <MaterialIcon name="error" size={16} className="shrink-0" />
                Failed to load CI data — repo may be private or rate-limited by GitHub.
              </div>
            )}

            {state && state !== "loading" && state !== "error" && state !== "no-ci" && (() => {
              const d = state as CiData;
              const latestC = runColors(d.latestConclusion, d.latestStatus);
              const passColor =
                d.overallPassRate >= 80 ? "text-emerald-400" :
                d.overallPassRate >= 60 ? "text-amber-400" : "text-red-400";

              return (
                <div className="space-y-4">
                  {/* Summary strip */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className={cn("px-4 py-3 rounded-2xl border space-y-1", latestC.bg, latestC.border)}>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", latestC.dot)} />
                        <p className={cn("text-sm font-black", latestC.text)}>
                          {runLabel(d.latestConclusion, d.latestStatus)}
                        </p>
                      </div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">Latest Run</p>
                    </div>
                    <div className="px-4 py-3 rounded-2xl bg-surface-container/30 border border-outline-variant/10 space-y-0.5">
                      <p className={cn("text-lg font-black", passColor)}>{d.overallPassRate}%</p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">Pass Rate</p>
                    </div>
                    <div className="px-4 py-3 rounded-2xl bg-surface-container/30 border border-outline-variant/10 space-y-0.5">
                      <p className="text-lg font-black text-foreground">{d.workflows.length}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">Workflows</p>
                    </div>
                  </div>

                  {/* Per-workflow cards */}
                  {d.workflows.map((wf) => {
                    const wPassColor =
                      wf.passRate >= 80 ? "bg-emerald-500" :
                      wf.passRate >= 60 ? "bg-amber-500" : "bg-red-500";
                    const wPassText =
                      wf.passRate >= 80 ? "text-emerald-400" :
                      wf.passRate >= 60 ? "text-amber-400" : "text-red-400";

                    return (
                      <div key={wf.name} className="rounded-2xl border border-outline-variant/10 bg-surface-container/20 p-4 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <MaterialIcon name="play_circle" size={14} className="text-cyan-400" />
                            <span className="text-xs font-black text-foreground/85">{wf.name}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[9px] font-mono">
                            <span className={cn("font-black", wPassText)}>{wf.passRate}% pass</span>
                            {wf.avgDurationMs && (
                              <span className="text-muted-foreground/50">avg {fmtDuration(wf.avgDurationMs)}</span>
                            )}
                          </div>
                        </div>

                        {/* Run streak */}
                        <div className="flex gap-1 flex-wrap">
                          {wf.runs.map((run) => {
                            const rc = runColors(run.conclusion, run.status);
                            const date = new Date(run.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" });
                            return (
                              <div
                                key={run.id}
                                title={`${runLabel(run.conclusion, run.status)} · ${run.headBranch} · ${date}`}
                                className={cn("size-6 rounded-md border flex items-center justify-center cursor-default", rc.bg, rc.border)}
                              >
                                <span className={cn("size-1.5 rounded-full", rc.dot)} />
                              </div>
                            );
                          })}
                        </div>

                        {/* Pass rate bar */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-surface-container-highest">
                            <div
                              className={cn("h-full rounded-full transition-all duration-700", wPassColor)}
                              style={{ width: `${wf.passRate}%` }}
                            />
                          </div>
                          <span className="text-[9px] font-mono text-muted-foreground/40 w-8 text-right shrink-0">{wf.passRate}%</span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 pt-1">
                    {[
                      { dot: "bg-emerald-400", label: "Success" },
                      { dot: "bg-red-400",     label: "Failure" },
                      { dot: "bg-blue-400",    label: "Running" },
                      { dot: "bg-muted-foreground", label: "Cancelled" },
                      { dot: "bg-amber-400",   label: "Other" },
                    ].map(({ dot, label }) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <span className={cn("size-1.5 rounded-full shrink-0", dot)} />
                        <span className="text-[9px] text-muted-foreground/50">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
