export const dynamic = 'force-dynamic';

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { MaterialIcon } from "@/components/material-icon";
import Link from "next/link";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Language Analytics",
  description: "Language distribution across your analyzed GitHub repositories.",
};

/* ── Language color palette ─────────────────────────────────────────── */

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178C6",
  JavaScript: "#F7DF1E",
  Python: "#3572A5",
  Rust: "#DEA584",
  Go: "#00ADD8",
  Java: "#B07219",
  "C++": "#F34B7D",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#FA7343",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Scala: "#C22D40",
  Shell: "#89E051",
  HTML: "#E34C26",
  CSS: "#563D7C",
  Vue: "#41B883",
  Svelte: "#FF3E00",
  Elixir: "#6E4A7E",
  Haskell: "#5E5086",
  Lua: "#000080",
  R: "#198CE7",
  MATLAB: "#E16737",
  Perl: "#0298C3",
  Dockerfile: "#384D54",
  Makefile: "#427819",
};

function langColor(name: string): string {
  return LANG_COLORS[name] ?? `hsl(${(name.charCodeAt(0) * 37 + name.charCodeAt(1 % name.length) * 17) % 360}, 60%, 55%)`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

/* ── GitHub fetch ───────────────────────────────────────────────────── */

async function fetchLanguages(owner: string, repo: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/languages`,
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        next: { revalidate: 600 },
      }
    );
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

/* ── Pie segment component (pure CSS) ──────────────────────────────── */

function PieChart({ segments }: { segments: { name: string; pct: number; color: string }[] }) {
  // Build a conic-gradient string from segments
  let cumulative = 0;
  const stops = segments.map((s) => {
    const start = cumulative;
    cumulative += s.pct;
    return `${s.color} ${start.toFixed(1)}% ${cumulative.toFixed(1)}%`;
  });

  return (
    <div
      className="size-44 rounded-full shrink-0 shadow-lg"
      style={{ background: `conic-gradient(${stops.join(", ")})` }}
      aria-label="Language distribution pie chart"
    />
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */

export default async function LanguagesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(ROUTES.login);

  /* Fetch last 10 unique repo searches */
  let repoQueries: string[] = [];
  try {
    if (session.user.id) {
      const rows = await prisma.searchHistory.findMany({
        where: { userId: session.user.id, type: "repo" },
        orderBy: { timestamp: "desc" },
        take: 10,
        select: { query: true },
      });
      repoQueries = rows.map((r) => r.query);
    }
  } catch {
    // DB unavailable — show empty state
  }

  const hasHistory = repoQueries.length > 0;

  /* Aggregate language bytes across all repos */
  const globalBytes = new Map<string, number>();
  const perRepo: { query: string; langs: Record<string, number>; total: number }[] = [];

  if (hasHistory) {
    const results = await Promise.all(
      repoQueries.map(async (query) => {
        const [owner, repo] = query.split("/");
        if (!owner || !repo) return { query, langs: {} as Record<string, number> };
        const langs = await fetchLanguages(owner, repo);
        return { query, langs };
      })
    );

    for (const { query, langs } of results) {
      const total = Object.values(langs).reduce((s, v) => s + v, 0);
      if (total > 0) {
        perRepo.push({ query, langs, total });
      }
      for (const [lang, bytes] of Object.entries(langs)) {
        globalBytes.set(lang, (globalBytes.get(lang) ?? 0) + bytes);
      }
    }
  }

  const totalBytes = Array.from(globalBytes.values()).reduce((s, v) => s + v, 0);

  const rankedLangs = Array.from(globalBytes.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, bytes]) => ({
      name,
      bytes,
      pct: totalBytes > 0 ? (bytes / totalBytes) * 100 : 0,
      color: langColor(name),
    }));

  // Consolidate languages below 2% into "Other"
  const mainLangs = rankedLangs.filter((l) => l.pct >= 2);
  const otherBytes = rankedLangs.filter((l) => l.pct < 2).reduce((s, l) => s + l.bytes, 0);
  const pieSegments =
    otherBytes > 0
      ? [...mainLangs.map((l) => ({ name: l.name, pct: l.pct, color: l.color })), { name: "Other", pct: (otherBytes / totalBytes) * 100, color: "#6B7280" }]
      : mainLangs.map((l) => ({ name: l.name, pct: l.pct, color: l.color }));

  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 mb-3">
            <span className="size-1.5 rounded-full bg-blue-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-500">Analytics</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <MaterialIcon name="code" size={32} className="text-blue-500" />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-cyan-500">
              Language Analytics
            </span>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            Distribution across your analyzed repositories
          </p>
        </div>
        {totalBytes > 0 && (
          <div className="hidden sm:flex items-center gap-3 px-4 py-3 rounded-2xl bg-card border border-border">
            <MaterialIcon name="data_usage" size={20} className="text-muted-foreground" />
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Code</div>
              <div className="text-lg font-black">{formatBytes(totalBytes)}</div>
            </div>
          </div>
        )}
      </div>

      {/* No history empty state */}
      {!hasHistory ? (
        <div className="flex flex-col items-center justify-center py-24 text-center rounded-3xl border-2 border-dashed border-border/50 gap-5">
          <div className="flex size-20 items-center justify-center rounded-3xl bg-blue-500/10">
            <MaterialIcon name="code" size={40} className="text-blue-500/60" />
          </div>
          <div className="space-y-2 max-w-sm">
            <h3 className="text-xl font-black">No Repository History Yet</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Analyze some public GitHub repositories first to see language breakdowns across your searches.
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
      ) : rankedLangs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-3xl border-2 border-dashed border-border/50 gap-4">
          <MaterialIcon name="warning" size={40} className="text-muted-foreground/30" />
          <div>
            <h3 className="text-lg font-black mb-1">No Language Data Found</h3>
            <p className="text-sm text-muted-foreground">
              Could not load language data from the GitHub API. The repos may be empty, private, or rate-limited.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* ── Global Distribution ── */}
          <Card className="rounded-3xl border border-border p-6 sm:p-8 shadow-sm">
            <h2 className="text-base font-black uppercase tracking-widest text-muted-foreground mb-6 flex items-center gap-2">
              <MaterialIcon name="pie_chart" size={18} className="text-indigo-500" />
              Overall Distribution
            </h2>

            <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-start">
              {/* Pie chart */}
              {pieSegments.length > 0 && (
                <div className="flex flex-col items-center gap-4 shrink-0">
                  <PieChart segments={pieSegments} />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                    {repoQueries.length} repo{repoQueries.length !== 1 ? "s" : ""}
                  </p>
                </div>
              )}

              {/* Ranked list */}
              <div className="flex-1 w-full space-y-3">
                {rankedLangs.slice(0, 15).map((lang, i) => (
                  <div key={lang.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: lang.color }}
                        />
                        <span className="text-sm font-bold">{lang.name}</span>
                        {i < 3 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-black uppercase">
                            #{i + 1}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <span className="text-xs text-muted-foreground hidden sm:block">
                          {formatBytes(lang.bytes)}
                        </span>
                        <span className="text-sm font-black" style={{ color: lang.color }}>
                          {lang.pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${lang.pct}%`, backgroundColor: lang.color }}
                      />
                    </div>
                  </div>
                ))}
                {rankedLangs.length > 15 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    +{rankedLangs.length - 15} more languages (below 1%)
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* ── Per-repo breakdown ── */}
          {perRepo.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-base font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <MaterialIcon name="bar_chart" size={18} className="text-indigo-500" />
                Per-Repository Breakdown
              </h2>

              <div className="grid gap-4 sm:grid-cols-2">
                {perRepo.map(({ query, langs, total }) => {
                  const [owner, repo] = query.split("/");
                  const sortedLangs = Object.entries(langs)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 6);

                  return (
                    <Card
                      key={query}
                      className="rounded-3xl border border-border p-5 space-y-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={owner && repo ? ROUTES.dashboard(owner, repo) : ROUTES.search}
                          className="text-sm font-black hover:text-indigo-500 transition-colors truncate font-mono"
                        >
                          <span className="text-muted-foreground">{owner}/</span>
                          <span className="text-indigo-500">{repo}</span>
                        </Link>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatBytes(total)}
                        </span>
                      </div>

                      {/* Stacked bar */}
                      <div className="h-3 rounded-full overflow-hidden flex">
                        {sortedLangs.map(([name, bytes]) => {
                          const pct = (bytes / total) * 100;
                          return (
                            <div
                              key={name}
                              title={`${name}: ${pct.toFixed(1)}%`}
                              className="h-full transition-all"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: langColor(name),
                                minWidth: pct > 0.5 ? "4px" : "0",
                              }}
                            />
                          );
                        })}
                      </div>

                      <div className="space-y-2">
                        {sortedLangs.map(([name, bytes]) => {
                          const pct = (bytes / total) * 100;
                          return (
                            <div key={name} className="flex items-center gap-2">
                              <span
                                className="size-2 rounded-full shrink-0"
                                style={{ backgroundColor: langColor(name) }}
                              />
                              <span className="text-xs text-muted-foreground flex-1 truncate">{name}</span>
                              <span className="text-xs font-bold shrink-0">{pct.toFixed(1)}%</span>
                            </div>
                          );
                        })}
                        {Object.keys(langs).length > 6 && (
                          <p className="text-[10px] text-muted-foreground">
                            +{Object.keys(langs).length - 6} more
                          </p>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
