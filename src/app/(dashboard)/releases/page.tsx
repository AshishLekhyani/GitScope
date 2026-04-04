export const dynamic = 'force-dynamic';

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { formatDistanceToNow, format } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/material-icon";
import { Card } from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  author: {
    login: string;
    avatar_url: string;
  };
  assets: { name: string }[];
}

interface RepoReleasesResult {
  owner: string;
  repo: string;
  avatar: string | null;
  releases: GitHubRelease[];
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return "";
  const stripped = text
    .replace(/#+\s/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\n/g, " ")
    .trim();
  return stripped.length > maxLen
    ? stripped.slice(0, maxLen).trimEnd() + "…"
    : stripped;
}

async function fetchReleasesForRepo(
  owner: string,
  repo: string,
  token: string | null
): Promise<GitHubRelease[]> {
  try {
    const headers: HeadersInit = {
      Accept: "application/vnd.github.v3+json",
    };
    if (token) headers["Authorization"] = `token ${token}`;

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`,
      { headers, next: { revalidate: 60 } }
    );

    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ReleasesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(ROUTES.login);

  const token = await getGitHubToken();

  // ── Get last 5 unique repos from search history ────────────────────────────
  const recentRepos: { owner: string; repo: string; avatar: string | null }[] =
    [];

  try {
    if (session.user.id) {
      const rows = await prisma.searchHistory.findMany({
        where: { userId: session.user.id, type: "repo" },
        orderBy: { timestamp: "desc" },
        take: 20, // take extra to de-dup
      });

      // De-duplicate by owner/repo, keep first occurrence (most recent)
      const seen = new Set<string>();
      for (const row of rows) {
        const parts = row.query.split("/");
        if (parts.length !== 2) continue;
        const [owner, repo] = parts;
        const key = `${owner}/${repo}`;
        if (!seen.has(key)) {
          seen.add(key);
          recentRepos.push({ owner, repo, avatar: row.avatar ?? null });
        }
        if (recentRepos.length >= 5) break;
      }
    }
  } catch {
    // DB unavailable — show CTA
  }

  const hasHistory = recentRepos.length > 0;

  // ── Fetch releases in parallel ─────────────────────────────────────────────
  let results: RepoReleasesResult[] = [];

  if (hasHistory) {
    results = await Promise.all(
      recentRepos.map(async ({ owner, repo, avatar }) => {
        const releases = await fetchReleasesForRepo(owner, repo, token);
        return { owner, repo, avatar, releases };
      })
    );
  }

  // ── Flatten for aggregate stats ────────────────────────────────────────────
  const allReleases = results.flatMap((r) =>
    r.releases.map((rel) => ({ ...rel, repoOwner: r.owner, repoName: r.repo, repoAvatar: r.avatar }))
  );

  const totalReleases = allReleases.length;

  const latestRelease = allReleases
    .filter((r) => r.published_at)
    .sort(
      (a, b) =>
        new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime()
    )[0];

  // ── Build flat timeline: newest first ─────────────────────────────────────
  const timeline = [...allReleases]
    .filter((r) => !r.draft && r.published_at)
    .sort(
      (a, b) =>
        new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime()
    );

  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight">
            <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-indigo-500/10">
              <MaterialIcon name="new_releases" size={22} className="text-indigo-500" />
            </span>
            <span className="bg-clip-text text-transparent bg-linear-to-r from-indigo-500 to-purple-500">
              Release Timeline
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Recent releases for your last analyzed repositories.
          </p>
        </div>

        {hasHistory && totalReleases > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2">
              <MaterialIcon name="new_releases" size={15} className="text-indigo-500" />
              <span className="text-xs font-bold">
                {totalReleases} release{totalReleases !== 1 ? "s" : ""}
              </span>
            </div>
            {latestRelease?.published_at && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2">
                <MaterialIcon name="calendar_today" size={15} className="text-emerald-500" />
                <span className="text-xs font-bold text-muted-foreground">
                  Latest:{" "}
                  <span className="text-foreground">
                    {format(new Date(latestRelease.published_at), "MMM d, yyyy")}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── No history CTA ──────────────────────────────────────────────────── */}
      {!hasHistory && (
        <div className="flex flex-col items-center justify-center gap-6 rounded-3xl border-2 border-dashed border-border/50 py-24 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-indigo-500/10">
            <MaterialIcon name="manage_search" size={32} className="text-indigo-400" />
          </div>
          <div className="max-w-sm space-y-2">
            <h3 className="text-xl font-black">No repository history yet</h3>
            <p className="text-sm text-muted-foreground">
              GitScope will show you the latest releases from your recently
              analyzed repositories. Search a repository to get started.
            </p>
          </div>
          <Link
            href={ROUTES.search}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-500"
          >
            <MaterialIcon name="search" size={16} className="text-white" />
            Search a Repository
          </Link>
        </div>
      )}

      {/* ── No releases found ────────────────────────────────────────────────── */}
      {hasHistory && totalReleases === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-border/50 py-16 text-center">
          <MaterialIcon name="new_releases" size={40} className="text-muted-foreground/20" />
          <div>
            <h3 className="text-lg font-black">No releases found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              None of your recently analyzed repositories have published GitHub
              releases.
            </p>
          </div>
        </div>
      )}

      {/* ── Main layout ─────────────────────────────────────────────────────── */}
      {hasHistory && totalReleases > 0 && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: vertical timeline */}
          <div className="lg:col-span-2">
            <div className="relative space-y-0 pl-6">
              {/* Vertical line */}
              <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" />

              {timeline.map((release, idx) => {
                const timeAgo = release.published_at
                  ? formatDistanceToNow(new Date(release.published_at), {
                      addSuffix: true,
                    })
                  : "Unknown date";
                const dateFormatted = release.published_at
                  ? format(new Date(release.published_at), "MMM d, yyyy")
                  : "";
                const bodyText = truncate(release.body, 200);
                const isLatest = idx === 0;

                return (
                  <div key={`${release.repoOwner}/${release.repoName}/${release.id}`} className="relative flex gap-4 pb-8">
                    {/* Timeline dot */}
                    <div
                      className={cn(
                        "absolute -left-6 mt-1 flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 border-background",
                        isLatest
                          ? "bg-indigo-500 shadow-lg shadow-indigo-500/30"
                          : release.prerelease
                          ? "bg-amber-500/20 border-amber-500/50"
                          : "bg-muted"
                      )}
                    >
                      {isLatest && (
                        <div className="size-2 rounded-full bg-white" />
                      )}
                    </div>

                    {/* Card */}
                    <div
                      className={cn(
                        "flex-1 overflow-hidden rounded-3xl border bg-card shadow-sm transition-all hover:shadow-md",
                        isLatest
                          ? "border-indigo-500/30 bg-indigo-500/[0.02]"
                          : "border-border hover:border-border/80"
                      )}
                    >
                      {/* Card header */}
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-muted/20 px-5 py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          {release.repoAvatar && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={release.repoAvatar}
                              alt={release.repoOwner}
                              width={22}
                              height={22}
                              className="size-[22px] shrink-0 rounded-md border border-border/50"
                            />
                          )}
                          <div className="min-w-0">
                            <Link
                              href={ROUTES.dashboard(release.repoOwner, release.repoName)}
                              className="font-mono text-sm font-bold hover:text-indigo-500 transition-colors truncate block"
                            >
                              <span className="text-muted-foreground">
                                {release.repoOwner}/
                              </span>
                              {release.repoName}
                            </Link>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          {isLatest && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                              Latest
                            </span>
                          )}
                          {release.prerelease && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-500">
                              Pre-release
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2.5 py-0.5 font-mono text-[11px] font-black text-indigo-500">
                            {release.tag_name}
                          </span>
                        </div>
                      </div>

                      {/* Card body */}
                      <div className="px-5 py-4 space-y-3">
                        {release.name && release.name !== release.tag_name && (
                          <h3 className="font-bold text-foreground">
                            {release.name}
                          </h3>
                        )}

                        {bodyText ? (
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {bodyText}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground/50 italic">
                            No release notes provided.
                          </p>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                              <MaterialIcon name="schedule" size={12} />
                              {timeAgo}
                            </span>
                            {dateFormatted && (
                              <span className="flex items-center gap-1">
                                <MaterialIcon name="calendar_today" size={12} />
                                {dateFormatted}
                              </span>
                            )}
                            {release.assets.length > 0 && (
                              <span className="flex items-center gap-1">
                                <MaterialIcon name="download" size={12} />
                                {release.assets.length} asset
                                {release.assets.length !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>

                          <a
                            href={release.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-muted-foreground transition-all hover:border-indigo-500/30 hover:bg-indigo-500/5 hover:text-indigo-500"
                          >
                            View on GitHub
                            <MaterialIcon name="open_in_new" size={11} />
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: sidebar */}
          <div className="space-y-4">
            {/* Aggregate stats */}
            <Card className="rounded-3xl border border-border p-5 shadow-sm">
              <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-muted-foreground">
                Summary
              </h3>
              <div className="space-y-3">
                {[
                  {
                    label: "Total Releases",
                    value: totalReleases,
                    icon: "new_releases",
                    color: "text-indigo-500",
                  },
                  {
                    label: "Repositories",
                    value: recentRepos.length,
                    icon: "source",
                    color: "text-purple-500",
                  },
                  {
                    label: "Pre-releases",
                    value: allReleases.filter((r) => r.prerelease).length,
                    icon: "science",
                    color: "text-amber-500",
                  },
                  {
                    label: "With Assets",
                    value: allReleases.filter((r) => r.assets.length > 0).length,
                    icon: "download",
                    color: "text-emerald-500",
                  },
                ].map(({ label, value, icon, color }) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MaterialIcon name={icon} size={14} className={color} />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <span className="text-sm font-black">{value}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Per-repo release counts */}
            <Card className="rounded-3xl border border-border p-5 shadow-sm">
              <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-muted-foreground">
                By Repository
              </h3>
              <div className="space-y-3">
                {results.map((r) => (
                  <div
                    key={`${r.owner}/${r.repo}`}
                    className="flex items-center gap-3"
                  >
                    {r.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.avatar}
                        alt={r.owner}
                        width={20}
                        height={20}
                        className="size-5 shrink-0 rounded-md border border-border/50"
                      />
                    ) : (
                      <div className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[9px] font-black">
                        {r.owner[0]?.toUpperCase()}
                      </div>
                    )}
                    <Link
                      href={ROUTES.dashboard(r.owner, r.repo)}
                      className="flex-1 min-w-0 font-mono text-xs truncate text-muted-foreground hover:text-indigo-500 transition-colors"
                    >
                      <span className="text-muted-foreground/60">{r.owner}/</span>
                      <span className="font-bold text-foreground">{r.repo}</span>
                    </Link>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-black",
                        r.releases.length === 0
                          ? "text-muted-foreground/40"
                          : "text-foreground"
                      )}
                    >
                      {r.releases.length}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Token info */}
            {!token && (
              <Card className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-5">
                <div className="flex items-start gap-3">
                  <MaterialIcon name="warning" size={16} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
                      No GitHub token
                    </p>
                    <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 leading-relaxed">
                      Releases are fetched without auth (60 req/hr limit). Connect GitHub for higher rate limits.
                    </p>
                    <Link
                      href="/api/auth/signin/github"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:underline mt-1"
                    >
                      Connect GitHub
                      <MaterialIcon name="open_in_new" size={10} />
                    </Link>
                  </div>
                </div>
              </Card>
            )}

            {/* Quick nav */}
            <Link
              href={ROUTES.activity}
              className="flex items-center justify-between gap-3 rounded-3xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-indigo-500/30 hover:bg-muted/40"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-500/10">
                  <MaterialIcon name="bolt" size={18} className="text-indigo-500" />
                </div>
                <div>
                  <p className="text-sm font-bold">Activity Pulse</p>
                  <p className="text-xs text-muted-foreground">Full event feed</p>
                </div>
              </div>
              <MaterialIcon name="chevron_right" size={18} className="text-muted-foreground" />
            </Link>

            <Link
              href={ROUTES.search}
              className="flex items-center justify-between gap-3 rounded-3xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-indigo-500/30 hover:bg-muted/40"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-purple-500/10">
                  <MaterialIcon name="search" size={18} className="text-purple-500" />
                </div>
                <div>
                  <p className="text-sm font-bold">Search Repos</p>
                  <p className="text-xs text-muted-foreground">Add more to your history</p>
                </div>
              </div>
              <MaterialIcon name="chevron_right" size={18} className="text-muted-foreground" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
