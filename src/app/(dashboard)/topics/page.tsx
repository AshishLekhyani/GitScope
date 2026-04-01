export const dynamic = 'force-dynamic';

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/material-icon";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Topic Explorer",
  description: "Discover patterns in your analyzed GitHub repositories.",
};

/* ── Types ─────────────────────────────────────────────────────────── */

interface TopicApiResponse {
  names: string[];
}

interface TopicEntry {
  name: string;
  count: number;
}

interface RepoTopicGroup {
  query: string;
  topics: string[];
}

/* ── GitHub fetch ───────────────────────────────────────────────────── */

async function fetchTopics(owner: string, repo: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/topics`,
      {
        headers: {
          Accept: "application/vnd.github.mercy-preview+json",
        },
        next: { revalidate: 600 },
      }
    );
    if (!res.ok) return [];
    const data: TopicApiResponse = await res.json();
    return data.names ?? [];
  } catch {
    return [];
  }
}

/* ── Tag cloud font sizing ──────────────────────────────────────────── */

function tagSizeClass(count: number, maxCount: number): string {
  const ratio = count / maxCount;
  if (ratio >= 0.75) return "text-xl font-black";
  if (ratio >= 0.5) return "text-lg font-bold";
  if (ratio >= 0.35) return "text-base font-bold";
  if (ratio >= 0.2) return "text-sm font-semibold";
  return "text-xs font-medium";
}

function tagOpacity(count: number, maxCount: number): string {
  const ratio = count / maxCount;
  if (ratio >= 0.6) return "opacity-100";
  if (ratio >= 0.35) return "opacity-90";
  if (ratio >= 0.2) return "opacity-75";
  return "opacity-60";
}

/* ── Page ───────────────────────────────────────────────────────────── */

export default async function TopicsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(ROUTES.login);

  /* Fetch last 15 unique repo searches */
  let repoQueries: string[] = [];
  try {
    if (session.user.id) {
      const rows = await prisma.searchHistory.findMany({
        where: { userId: session.user.id, type: "repo" },
        orderBy: { timestamp: "desc" },
        take: 15,
        select: { query: true },
      });
      repoQueries = rows.map((r) => r.query);
    }
  } catch {
    // DB unavailable — show empty state
  }

  const hasHistory = repoQueries.length > 0;

  /* Aggregate topics */
  const topicCounts = new Map<string, number>();
  const repoTopics: RepoTopicGroup[] = [];

  if (hasHistory) {
    const results = await Promise.all(
      repoQueries.map(async (query) => {
        const [owner, repo] = query.split("/");
        if (!owner || !repo) return { query, topics: [] as string[] };
        const topics = await fetchTopics(owner, repo);
        return { query, topics };
      })
    );

    for (const { query, topics } of results) {
      if (topics.length > 0) {
        repoTopics.push({ query, topics });
        for (const topic of topics) {
          topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
        }
      }
    }
  }

  const rankedTopics: TopicEntry[] = Array.from(topicCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, count }));

  const top20Topics = rankedTopics.slice(0, 20);
  const maxCount = rankedTopics[0]?.count ?? 1;

  /* Group repos by topic (top 10 topics only) */
  const topTopicNames = new Set(top20Topics.slice(0, 10).map((t) => t.name));
  const topicToRepos = new Map<string, string[]>();
  for (const { query, topics } of repoTopics) {
    for (const topic of topics) {
      if (topTopicNames.has(topic)) {
        const existing = topicToRepos.get(topic) ?? [];
        existing.push(query);
        topicToRepos.set(topic, existing);
      }
    }
  }

  const hasTopics = rankedTopics.length > 0;

  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 mb-3">
            <span className="size-1.5 rounded-full bg-purple-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-purple-500">Discovery</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <MaterialIcon name="travel_explore" size={32} className="text-purple-500" />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-pink-500">
              Topic Explorer
            </span>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            Discover patterns in your repositories
          </p>
        </div>
        {hasTopics && (
          <div className="hidden sm:flex items-center gap-3 px-4 py-3 rounded-2xl bg-card border border-border">
            <MaterialIcon name="tag" size={20} className="text-muted-foreground" />
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Unique Topics</div>
              <div className="text-lg font-black">{rankedTopics.length}</div>
            </div>
          </div>
        )}
      </div>

      {/* No history empty state */}
      {!hasHistory ? (
        <div className="flex flex-col items-center justify-center py-24 text-center rounded-3xl border-2 border-dashed border-border/50 gap-5">
          <div className="flex size-20 items-center justify-center rounded-3xl bg-purple-500/10">
            <MaterialIcon name="travel_explore" size={40} className="text-purple-500/60" />
          </div>
          <div className="space-y-2 max-w-sm">
            <h3 className="text-xl font-black">No Repository History Yet</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Analyze some public GitHub repositories first to explore topics and discover patterns across your searches.
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
      ) : !hasTopics ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-3xl border-2 border-dashed border-border/50 gap-4">
          <MaterialIcon name="label_off" size={40} className="text-muted-foreground/30" />
          <div>
            <h3 className="text-lg font-black mb-1">No Topics Found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              None of your analyzed repositories have GitHub topics set. Topics help maintainers categorize their work.
            </p>
          </div>
          <Link
            href={ROUTES.search}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border hover:bg-muted text-sm font-bold transition-colors"
          >
            Analyze More Repositories
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* ── Tag Cloud ── */}
          <section className="rounded-3xl border border-border bg-card p-6 sm:p-8">
            <h2 className="text-base font-black uppercase tracking-widest text-muted-foreground mb-6 flex items-center gap-2">
              <MaterialIcon name="cloud" size={18} className="text-purple-500" />
              Topic Cloud
            </h2>
            <div className="flex flex-wrap gap-3 items-center">
              {rankedTopics.map(({ name, count }) => (
                <a
                  key={name}
                  href={`https://github.com/topics/${name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${count} repo${count !== 1 ? "s" : ""} — explore on GitHub`}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full",
                    "bg-purple-500/10 border border-purple-500/20 text-purple-400",
                    "hover:bg-purple-500/20 hover:border-purple-500/40 hover:text-purple-300",
                    "transition-all duration-150 cursor-pointer",
                    tagSizeClass(count, maxCount),
                    tagOpacity(count, maxCount)
                  )}
                >
                  <span className="text-purple-500/60 text-[9px] font-black">#</span>
                  {name}
                  {count > 1 && (
                    <span className="text-[9px] font-black bg-purple-500/20 rounded-full px-1.5 py-0.5 ml-0.5">
                      {count}
                    </span>
                  )}
                </a>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-5 font-medium">
              Larger tags appear in more of your analyzed repos. Click to explore on GitHub.
            </p>
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* ── Top 20 Ranked List ── */}
            <div className="lg:col-span-2 rounded-3xl border border-border bg-card overflow-hidden">
              <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2">
                <MaterialIcon name="format_list_numbered" size={18} className="text-indigo-500" />
                <h2 className="font-black text-sm uppercase tracking-widest">Top 20 Topics</h2>
              </div>
              <div className="divide-y divide-border/40">
                {top20Topics.map(({ name, count }, i) => {
                  const pct = Math.round((count / maxCount) * 100);
                  return (
                    <div
                      key={name}
                      className="group flex items-center gap-4 px-6 py-3.5 hover:bg-muted/40 transition-colors"
                    >
                      <span className="text-xs font-black text-muted-foreground/50 w-5 shrink-0 text-right">
                        {i + 1}
                      </span>
                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <a
                            href={`https://github.com/topics/${name}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-bold hover:text-purple-400 transition-colors"
                          >
                            #{name}
                          </a>
                          <span className="text-xs font-black text-purple-400 shrink-0">
                            {count} repo{count !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Summary sidebar ── */}
            <div className="space-y-5">
              <div className="rounded-3xl border border-border bg-card p-6 space-y-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Summary</h3>
                {[
                  { label: "Repos with Topics", value: repoTopics.length },
                  { label: "Repos without Topics", value: repoQueries.length - repoTopics.length },
                  { label: "Unique Topics", value: rankedTopics.length },
                  { label: "Most Common", value: rankedTopics[0]?.name ? `#${rankedTopics[0].name}` : "—" },
                  { label: "Avg Topics / Repo", value: repoTopics.length > 0 ? (rankedTopics.reduce((s, t) => s + t.count, 0) / repoTopics.length).toFixed(1) : "0" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="text-xs font-black">{value}</span>
                  </div>
                ))}
              </div>

              {repoTopics.length > 0 && (
                <div className="rounded-3xl border border-border bg-card p-6 space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Repos Analyzed</h3>
                  {repoQueries.map((q) => {
                    const [owner, repo] = q.split("/");
                    const hasTopicsInThisRepo = repoTopics.some((rt) => rt.query === q);
                    return (
                      <Link
                        key={q}
                        href={owner && repo ? ROUTES.dashboard(owner, repo) : ROUTES.search}
                        className="flex items-center gap-2 text-xs hover:text-indigo-500 transition-colors group"
                      >
                        <MaterialIcon
                          name={hasTopicsInThisRepo ? "label" : "label_off"}
                          size={14}
                          className={cn(
                            "shrink-0",
                            hasTopicsInThisRepo ? "text-purple-500" : "text-muted-foreground/40"
                          )}
                        />
                        <span className="font-mono truncate text-muted-foreground group-hover:text-indigo-500">
                          {q}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Repos by Topic ── */}
          {topicToRepos.size > 0 && (
            <section className="space-y-4">
              <h2 className="text-base font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <MaterialIcon name="account_tree" size={18} className="text-indigo-500" />
                Repos by Topic
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from(topicToRepos.entries()).map(([topic, repos]) => (
                  <div
                    key={topic}
                    className="rounded-3xl border border-border bg-card p-5 space-y-3"
                  >
                    <a
                      href={`https://github.com/topics/${topic}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm font-bold hover:bg-purple-500/20 transition-colors"
                    >
                      #{topic}
                    </a>
                    <div className="space-y-2">
                      {repos.map((q) => {
                        const [owner, repo] = q.split("/");
                        return (
                          <Link
                            key={q}
                            href={owner && repo ? ROUTES.dashboard(owner, repo) : ROUTES.search}
                            className="flex items-center gap-2 group"
                          >
                            <MaterialIcon name="code" size={13} className="text-muted-foreground/40 group-hover:text-indigo-500 transition-colors shrink-0" />
                            <span className="text-xs font-mono text-muted-foreground group-hover:text-indigo-500 transition-colors truncate">
                              <span className="opacity-60">{owner}/</span>
                              <span className="font-bold">{repo}</span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
