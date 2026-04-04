"use client";

import { Button } from "@/components/ui/button";
import { MaterialIcon } from "@/components/material-icon";
import { getRepoDetails, getContributors, getLanguages, getCommitActivity, getPullRequests } from "@/services/githubClient";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setCompareA, setCompareB } from "@/store/slices/dashboardSlice";
import { formatNumber } from "@/utils/formatDate";
import { useQueries } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

function parsePair(raw: string): { owner: string; repo: string } | null {
  const s = raw.trim();
  const parts = s.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

export function CompareReposPanel() {
  const dispatch = useAppDispatch();
  const savedA = useAppSelector((s) => s.dashboard.compareA);
  const savedB = useAppSelector((s) => s.dashboard.compareB);

  const [a, setA] = useState(
    savedA ? `${savedA.owner}/${savedA.repo}` : ""
  );
  const [b, setB] = useState(
    savedB ? `${savedB.owner}/${savedB.repo}` : ""
  );

  const pa = parsePair(a);
  const pb = parsePair(b);

  useEffect(() => {
    const p = parsePair(a);
    if (p) dispatch(setCompareA(p));
  }, [a, dispatch]);

  useEffect(() => {
    const p = parsePair(b);
    if (p) dispatch(setCompareB(p));
  }, [b, dispatch]);

  const results = useQueries({
    queries: [
      {
        queryKey: ["repo", pa?.owner, pa?.repo],
        queryFn: () => getRepoDetails(pa!.owner, pa!.repo),
        enabled: !!pa,
      },
      {
        queryKey: ["repo", pb?.owner, pb?.repo],
        queryFn: () => getRepoDetails(pb!.owner, pb!.repo),
        enabled: !!pb,
      },
      {
        queryKey: ["contributors", pa?.owner, pa?.repo],
        queryFn: () => getContributors(pa!.owner, pa!.repo),
        enabled: !!pa,
      },
      {
        queryKey: ["contributors", pb?.owner, pb?.repo],
        queryFn: () => getContributors(pb!.owner, pb!.repo),
        enabled: !!pb,
      },
      {
        queryKey: ["languages", pa?.owner, pa?.repo],
        queryFn: () => getLanguages(pa!.owner, pa!.repo),
        enabled: !!pa,
      },
      {
        queryKey: ["languages", pb?.owner, pb?.repo],
        queryFn: () => getLanguages(pb!.owner, pb!.repo),
        enabled: !!pb,
      },
      {
        queryKey: ["commits", pa?.owner, pa?.repo],
        queryFn: () => getCommitActivity(pa!.owner, pa!.repo),
        enabled: !!pa,
      },
      {
        queryKey: ["commits", pb?.owner, pb?.repo],
        queryFn: () => getCommitActivity(pb!.owner, pb!.repo),
        enabled: !!pb,
      },
      {
        queryKey: ["pulls", pa?.owner, pa?.repo],
        queryFn: () => getPullRequests(pa!.owner, pa!.repo),
        enabled: !!pa,
      },
      {
        queryKey: ["pulls", pb?.owner, pb?.repo],
        queryFn: () => getPullRequests(pb!.owner, pb!.repo),
        enabled: !!pb,
      },
    ],
  });

  const [repoA, repoB, contribA, contribB, langA, langB, commitsA, commitsB, pullsA, pullsB] = results;

  const leaderData = repoA.data;
  const challengerData = repoB.data;

  // compute monthly commits from weekly data
  function getMonthlyCommits(data: { data: { total: number }[] } | undefined) {
    if (!data?.data?.length) return 0;
    const weeks = data.data;
    const last4 = weeks.slice(-4);
    return last4.reduce((sum, w) => sum + w.total, 0);
  }

  // compute PR cycle time approximation from pulls (avg time between created and closed)
  function getAvgPRCycleHours(data: { data: { created_at: string; closed_at: string | null }[] } | undefined) {
    if (!data?.data?.length) return null;
    const merged = data.data.filter((p) => p.closed_at);
    if (merged.length === 0) return null;
    const sumHours = merged.reduce((sum, p) => {
      const created = new Date(p.created_at).getTime();
      const closed = new Date(p.closed_at!).getTime();
      return sum + (closed - created) / (1000 * 60 * 60);
    }, 0);
    return sumHours / merged.length;
  }

  const leaderCommits = getMonthlyCommits(commitsA.data);
  const challengerCommits = getMonthlyCommits(commitsB.data);
  const leaderPRCycle = getAvgPRCycleHours(pullsA.data);
  const challengerPRCycle = getAvgPRCycleHours(pullsB.data);
  const leaderContribs = contribA.data?.data?.length ?? 0;
  const challengerContribs = contribB.data?.data?.length ?? 0;

  const loading = repoA.isLoading || repoB.isLoading;

  // Build growth velocity chart from commit activity
  const commitWeeksA = commitsA.data?.data ?? [];
  const commitWeeksB = commitsB.data?.data ?? [];
  const maxWeeks = Math.max(commitWeeksA.length, commitWeeksB.length, 1);
  const chartWeeks = Math.min(maxWeeks, 12);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full"
    >
      {/* ── Search inputs ── */}
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-4">
          <p className="mb-2 font-mono text-[9px] font-bold tracking-[0.3em] text-tertiary uppercase">
            Primary Benchmark: Leader
          </p>
          <div className="flex items-center gap-2">
            <MaterialIcon name="search" size={18} className="text-muted-foreground" />
            <input
              value={a}
              onChange={(e) => setA(e.target.value)}
              placeholder="owner/repo"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <button className="flex size-8 items-center justify-center rounded-md bg-tertiary/20 text-tertiary">
              <MaterialIcon name="swap_horiz" size={18} />
            </button>
          </div>
        </div>
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-4">
          <p className="mb-2 font-mono text-[9px] font-bold tracking-[0.3em] text-primary uppercase">
            Target Benchmark: Challenger
          </p>
          <div className="flex items-center gap-2">
            <MaterialIcon name="search" size={18} className="text-muted-foreground" />
            <input
              value={b}
              onChange={(e) => setB(e.target.value)}
              placeholder="owner/repo"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <button className="flex size-8 items-center justify-center rounded-md bg-primary/20 text-primary">
              <MaterialIcon name="swap_horiz" size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="mb-10 flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
          Tactical Suggestions:
        </span>
        {[
          { label: "React vs Vue", a: "facebook/react", b: "vuejs/core" },
          { label: "Next.js vs Remix", a: "vercel/next.js", b: "remix-run/remix" },
          { label: "Tailwind vs UnoCSS", a: "tailwindlabs/tailwindcss", b: "unocss/unocss" },
        ].map((s) => (
          <button
            key={s.label}
            onClick={() => {
              setA(s.a);
              setB(s.b);
            }}
            className="rounded-full border border-white/5 bg-surface-container px-3 py-1 text-[10px] font-medium text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-muted-foreground text-sm">Loading comparison data…</p>
      )}

      {leaderData && challengerData && (
        <>
          {/* ── Growth Velocity chart ── */}
          <div className="mb-6 rounded-xl border border-outline-variant/15 bg-surface-container p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-heading text-xl font-bold text-foreground">
                  Growth Velocity
                </h2>
                <p className="text-muted-foreground text-xs">
                  Weekly commit activity comparison
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2.5 rounded-full bg-tertiary" />
                  Leader
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2.5 rounded-full bg-primary" />
                  Challenger
                </span>
              </div>
            </div>
            <div className="flex items-end gap-1">
              {Array.from({ length: chartWeeks }).map((_, i) => {
                const aVal = commitWeeksA[commitWeeksA.length - chartWeeks + i]?.total ?? 0;
                const bVal = commitWeeksB[commitWeeksB.length - chartWeeks + i]?.total ?? 0;
                const maxVal = Math.max(...commitWeeksA.map((w) => w.total), ...commitWeeksB.map((w) => w.total), 1);
                return (
                  <div key={i} className="flex flex-1 flex-col gap-0.5">
                    <div
                      className="w-full rounded-t-sm bg-tertiary/60"
                      style={{ height: `${Math.max(2, (aVal / maxVal) * 120)}px` }}
                    />
                    <div
                      className="w-full rounded-b-sm bg-primary/40"
                      style={{ height: `${Math.max(2, (bVal / maxVal) * 120)}px` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Health Matrix + Predictive Index ── */}
          <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_280px] xl:grid-cols-[1fr_320px]">
            {/* Health Matrix */}
            <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
              <h3 className="font-heading mb-4 text-lg font-bold text-foreground">
                Health Matrix
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                      <th className="pb-3 text-left">Metric</th>
                      <th className="pb-3 text-right text-tertiary">Leader</th>
                      <th className="pb-3 text-right">Challenger</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    <tr>
                      <td className="py-3 text-foreground">Stars</td>
                      <td className="py-3 text-right font-mono font-bold text-tertiary">
                        {formatNumber(leaderData.stargazers_count)}
                      </td>
                      <td className="py-3 text-right font-mono text-muted-foreground">
                        {formatNumber(challengerData.stargazers_count)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 text-foreground">Forks</td>
                      <td className="py-3 text-right font-mono font-bold text-tertiary">
                        {formatNumber(leaderData.forks_count)}
                      </td>
                      <td className="py-3 text-right font-mono text-muted-foreground">
                        {formatNumber(challengerData.forks_count)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 text-foreground">Monthly Commits</td>
                      <td className="py-3 text-right font-mono font-bold text-tertiary">
                        {leaderCommits}
                      </td>
                      <td className="py-3 text-right font-mono text-muted-foreground">
                        {challengerCommits}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 text-foreground">PR Cycle Time</td>
                      <td className="py-3 text-right font-mono font-bold text-tertiary">
                        {leaderPRCycle ? `${leaderPRCycle.toFixed(1)} hrs` : "—"}
                      </td>
                      <td className="py-3 text-right font-mono text-muted-foreground">
                        {challengerPRCycle ? `${challengerPRCycle.toFixed(1)} hrs` : "—"}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 text-foreground">Open Issues</td>
                      <td className="py-3 text-right font-mono font-bold text-tertiary">
                        {formatNumber(leaderData.open_issues_count)}
                      </td>
                      <td className="py-3 text-right font-mono text-muted-foreground">
                        {formatNumber(challengerData.open_issues_count)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-3 text-foreground">Contributors</td>
                      <td className="py-3 text-right font-mono font-bold text-tertiary">
                        {leaderContribs}+
                      </td>
                      <td className="py-3 text-right font-mono text-muted-foreground">
                        {challengerContribs}+
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Predictive Authority Index */}
            <div className="space-y-4">
              <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
                <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                  Comparative Score
                </p>
                <h3 className="font-heading mt-1 text-lg font-bold text-foreground">
                  Authority Index
                </h3>
                <div className="mt-4 grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="font-heading text-3xl font-bold text-tertiary">
                      {/* Score based on stars+forks+contributors */}
                      {Math.min(99.9, (leaderData.stargazers_count / 1000 + leaderData.forks_count / 500 + leaderContribs / 10)).toFixed(1)}
                    </p>
                    <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                      Leader Score
                    </p>
                  </div>
                  <div>
                    <p className="font-heading text-3xl font-bold text-primary">
                      {Math.min(99.9, (challengerData.stargazers_count / 1000 + challengerData.forks_count / 500 + challengerContribs / 10)).toFixed(1)}
                    </p>
                    <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                      Challenger Score
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-4">
                  <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                    Languages
                  </p>
                  <p className="font-heading mt-1 text-2xl font-bold text-foreground">
                    {Object.keys(langA.data?.data ?? {}).length}
                  </p>
                  <p className="font-mono text-[9px] text-muted-foreground">
                    vs {Object.keys(langB.data?.data ?? {}).length}
                  </p>
                </div>
                <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-4">
                  <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                    Fork Ratio
                  </p>
                  <p className="font-heading mt-1 text-2xl font-bold text-primary">
                    {leaderData.stargazers_count
                      ? (leaderData.forks_count / leaderData.stargazers_count * 100).toFixed(0)
                      : 0}%
                  </p>
                  <p className="font-mono text-[9px] text-muted-foreground">
                    vs {challengerData.stargazers_count
                      ? (challengerData.forks_count / challengerData.stargazers_count * 100).toFixed(0)
                      : 0}%
                  </p>
                </div>
              </div>

              {/* Comparison Report card */}
              <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6 text-center">
                <MaterialIcon name="star" size={28} className="mx-auto text-primary" />
                <h4 className="font-heading mt-2 font-bold text-foreground">
                  Comparison Report
                </h4>
                <p className="text-muted-foreground mt-1 text-xs">
                  Export detailed side-by-side performance data for stakeholder review.
                </p>
                <Button className="mt-4 w-full rounded-full btn-gitscope-primary font-mono text-[10px] tracking-widest uppercase">
                  Download PDF
                </Button>
              </div>
            </div>
          </div>

          {/* ── Historical Trajectory ── */}
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold text-foreground">
                Repository Timeline
              </h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <MaterialIcon name="update" size={20} className="mt-0.5 text-tertiary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Leader: {leaderData.full_name}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    Created {new Date(leaderData.created_at).toLocaleDateString()} · Last push{" "}
                    {new Date(leaderData.pushed_at).toLocaleDateString()} · {formatNumber(leaderData.stargazers_count)} Stars
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MaterialIcon name="bolt" size={20} className="mt-0.5 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Challenger: {challengerData.full_name}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    Created {new Date(challengerData.created_at).toLocaleDateString()} · Last push{" "}
                    {new Date(challengerData.pushed_at).toLocaleDateString()} · {formatNumber(challengerData.stargazers_count)} Stars
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {(repoA.isError || repoB.isError) && (
        <p className="text-destructive mt-4 text-sm">
          {(repoA.error as Error)?.message || (repoB.error as Error)?.message}
        </p>
      )}
    </motion.div>
  );
}
