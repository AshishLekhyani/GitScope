export const dynamic = 'force-dynamic';

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/material-icon";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Contributor Leaderboard",
  description: "Ranked contributors across your analyzed GitHub repositories.",
};

/* ── Types ─────────────────────────────────────────────────────────── */

interface GitHubContributor {
  login: string;
  avatar_url: string;
  contributions: number;
  html_url: string;
}

interface AggregatedContributor {
  login: string;
  avatarUrl: string;
  totalContributions: number;
  repos: string[];
}

/* ── GitHub fetch (no auth — public API) ────────────────────────────── */

async function fetchContributors(owner: string, repo: string): Promise<GitHubContributor[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=10&anon=0`,
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        next: { revalidate: 300 },
      }
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

/* ── Rank badge helper ──────────────────────────────────────────────── */

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-yellow-400/20 border border-yellow-400/40 text-yellow-400 font-black text-sm">
        1
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-400/20 border border-slate-400/40 text-slate-400 font-black text-sm">
        2
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-400/20 border border-orange-400/40 text-orange-400 font-black text-sm">
        3
      </div>
    );
  }
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted/50 border border-border/50 text-muted-foreground font-bold text-xs">
      {rank}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */

export default async function LeaderboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(ROUTES.login);

  /* Fetch last 8 unique repo searches */
  let repoQueries: string[] = [];
  try {
    if (session.user.id) {
      const rows = await prisma.searchHistory.findMany({
        where: { userId: session.user.id, type: "repo" },
        orderBy: { timestamp: "desc" },
        take: 8,
        select: { query: true },
      });
      repoQueries = rows.map((r) => r.query);
    }
  } catch {
    // DB unavailable — show empty state
  }

  const hasHistory = repoQueries.length > 0;

  /* Aggregate contributors across repos */
  const aggregated = new Map<string, AggregatedContributor>();

  if (hasHistory) {
    const results = await Promise.all(
      repoQueries.map(async (query) => {
        const [owner, repo] = query.split("/");
        if (!owner || !repo) return { query, contributors: [] as GitHubContributor[] };
        const contributors = await fetchContributors(owner, repo);
        return { query, contributors };
      })
    );

    for (const { query, contributors } of results) {
      for (const c of contributors) {
        if (!c.login) continue;
        const existing = aggregated.get(c.login);
        if (existing) {
          existing.totalContributions += c.contributions;
          if (!existing.repos.includes(query)) existing.repos.push(query);
        } else {
          aggregated.set(c.login, {
            login: c.login,
            avatarUrl: c.avatar_url,
            totalContributions: c.contributions,
            repos: [query],
          });
        }
      }
    }
  }

  const top20 = Array.from(aggregated.values())
    .sort((a, b) => b.totalContributions - a.totalContributions)
    .slice(0, 20);

  const maxContributions = top20[0]?.totalContributions ?? 1;

  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 mb-3">
            <span className="size-1.5 rounded-full bg-yellow-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Rankings</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <MaterialIcon name="emoji_events" size={32} className="text-yellow-500" />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-yellow-500 to-orange-500">
              Contributor Leaderboard
            </span>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            Across your analyzed repositories
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-3 px-4 py-3 rounded-2xl bg-card border border-border">
          <MaterialIcon name="group" size={20} className="text-muted-foreground" />
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Contributors</div>
            <div className="text-lg font-black">{top20.length}</div>
          </div>
        </div>
      </div>

      {/* No history empty state */}
      {!hasHistory ? (
        <div className="flex flex-col items-center justify-center py-24 text-center rounded-3xl border-2 border-dashed border-border/50 gap-5">
          <div className="flex size-20 items-center justify-center rounded-3xl bg-yellow-500/10">
            <MaterialIcon name="emoji_events" size={40} className="text-yellow-500/60" />
          </div>
          <div className="space-y-2 max-w-sm">
            <h3 className="text-xl font-black">No Repository History Yet</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Analyze some public GitHub repositories first to build a contributor leaderboard across your searches.
            </p>
          </div>
          <Link
            href={ROUTES.search}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-bold transition-colors"
          >
            <MaterialIcon name="search" size={18} className="text-white" />
            Analyze a Repository
          </Link>
        </div>
      ) : top20.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-3xl border-2 border-dashed border-border/50 gap-4">
          <MaterialIcon name="people_outline" size={40} className="text-muted-foreground/30" />
          <div>
            <h3 className="text-lg font-black mb-1">No Contributors Found</h3>
            <p className="text-sm text-muted-foreground">
              Could not load contributors from the GitHub API. The repos may be private or rate-limited.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Top 3 podium — wide view */}
          <div className="lg:col-span-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {top20.slice(0, 3).map((c, i) => {
                const rank = i + 1;
                const podiumColors = [
                  "from-yellow-500/10 to-yellow-500/5 border-yellow-500/30",
                  "from-slate-400/10 to-slate-400/5 border-slate-400/30",
                  "from-orange-400/10 to-orange-400/5 border-orange-400/30",
                ] as const;
                const textColors = ["text-yellow-500", "text-slate-400", "text-orange-400"] as const;
                return (
                  <div
                    key={c.login}
                    className={cn(
                      "relative flex flex-col items-center gap-3 p-6 rounded-3xl border bg-gradient-to-br",
                      podiumColors[i]
                    )}
                  >
                    <div className={cn("text-4xl font-black opacity-20 absolute top-4 right-5", textColors[i])}>
                      #{rank}
                    </div>
                    <Image
                      src={c.avatarUrl}
                      alt={c.login}
                      width={72}
                      height={72}
                      className="rounded-2xl border-2 border-white/10 shadow-lg"
                    />
                    <div className="text-center">
                      <a
                        href={`https://github.com/${c.login}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn("font-black text-base hover:underline", textColors[i])}
                      >
                        @{c.login}
                      </a>
                      <p className="text-2xl font-black mt-1">
                        {c.totalContributions.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">contributions</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {c.repos.length} repo{c.repos.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Full ranked list */}
          <Card className="lg:col-span-2 rounded-3xl border border-border overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2">
              <MaterialIcon name="leaderboard" size={18} className="text-indigo-500" />
              <h2 className="font-black text-sm uppercase tracking-widest">Full Rankings</h2>
            </div>
            <div className="divide-y divide-border/40">
              {top20.map((c, i) => {
                const rank = i + 1;
                const pct = Math.round((c.totalContributions / maxContributions) * 100);
                return (
                  <div
                    key={c.login}
                    className="group flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors"
                  >
                    <RankBadge rank={rank} />
                    <Image
                      src={c.avatarUrl}
                      alt={c.login}
                      width={36}
                      height={36}
                      className="size-9 rounded-xl border border-border/50 shrink-0"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={`https://github.com/${c.login}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-bold hover:text-indigo-500 transition-colors truncate"
                        >
                          {c.login}
                        </a>
                        <span className="text-sm font-black text-indigo-500 shrink-0">
                          {c.totalContributions.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {c.repos.length} repo{c.repos.length !== 1 ? "s" : ""} — {c.repos.slice(0, 2).join(", ")}{c.repos.length > 2 ? ` +${c.repos.length - 2} more` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Sidebar: stats + repo list */}
          <div className="space-y-5">
            <Card className="rounded-3xl border border-border p-6 space-y-4 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Summary</h3>
              {[
                { label: "Repos Analyzed", value: repoQueries.length },
                { label: "Unique Contributors", value: aggregated.size },
                { label: "Top Contributor", value: top20[0]?.login ?? "—" },
                {
                  label: "Total Contributions",
                  value: Array.from(aggregated.values())
                    .reduce((s, c) => s + c.totalContributions, 0)
                    .toLocaleString(),
                },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-xs font-black">{value}</span>
                </div>
              ))}
            </Card>

            <Card className="rounded-3xl border border-border p-6 space-y-3 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Analyzed Repos</h3>
              {repoQueries.map((q) => {
                const [owner, repo] = q.split("/");
                return (
                  <Link
                    key={q}
                    href={owner && repo ? ROUTES.dashboard(owner, repo) : ROUTES.search}
                    className="flex items-center gap-2 text-xs hover:text-indigo-500 transition-colors group"
                  >
                    <MaterialIcon name="code" size={14} className="text-muted-foreground group-hover:text-indigo-500" />
                    <span className="font-mono truncate text-muted-foreground group-hover:text-indigo-500">
                      {q}
                    </span>
                  </Link>
                );
              })}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
