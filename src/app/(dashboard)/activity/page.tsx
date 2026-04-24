export const dynamic = 'force-dynamic';

import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Activity Feed — GitScope",
  description: "Recent commits, issues, and pull requests across your tracked repositories.",
};

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import {
  GitCommit,
  GitPullRequest,
  GitMerge,
  Star,
  Zap,
  Globe,
  Clock,
  GitBranch,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { ConnectGitHubButton } from "@/components/connect-github-button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import Image from "next/image";

interface GitHubEvent {
  id: string;
  type: string;
  actor: { login: string; avatar_url: string };
  repo: { name: string };
  payload: {
    action?: string;
    ref?: string;
    commits?: { message: string }[];
    pull_request?: { title: string; number: number; html_url?: string };
    release?: { tag_name: string; html_url?: string };
    forkee?: { full_name: string; html_url?: string };
    issue?: { title: string; number: number; html_url?: string };
  };
  created_at: string;
}

function mapEvent(ev: GitHubEvent) {
  switch (ev.type) {
    case "PushEvent": {
      const count = ev.payload.commits?.length ?? 1;
      const branch = ev.payload.ref?.replace("refs/heads/", "") ?? "branch";
      return {
        icon: GitCommit, color: "text-amber-500", bg: "bg-amber-500/10",
        desc: `pushed ${count} commit${count !== 1 ? "s" : ""} to ${branch}`,
        link: `https://github.com/${ev.repo.name}/commits/${branch}`,
      };
    }
    case "PullRequestEvent":
      return {
        icon: GitPullRequest, color: "text-emerald-500", bg: "bg-emerald-500/10",
        desc: `${ev.payload.action} pull request: ${ev.payload.pull_request?.title ?? ""}`,
        link: ev.payload.pull_request?.html_url,
      };
    case "PullRequestReviewEvent":
      return {
        icon: GitPullRequest, color: "text-teal-500", bg: "bg-teal-500/10",
        desc: `reviewed PR #${ev.payload.pull_request?.number ?? ""}`,
        link: ev.payload.pull_request?.html_url,
      };
    case "IssuesEvent":
      return {
        icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-500/10",
        desc: `${ev.payload.action} issue: ${ev.payload.issue?.title ?? ""}`,
        link: ev.payload.issue?.html_url,
      };
    case "CreateEvent":
      return {
        icon: GitBranch, color: "text-amber-500", bg: "bg-amber-500/10",
        desc: `created ${ev.payload.ref ? `branch ${ev.payload.ref}` : "repository"}`,
        link: `https://github.com/${ev.repo.name}`,
      };
    case "ForkEvent":
      return {
        icon: GitMerge, color: "text-amber-500", bg: "bg-amber-500/10",
        desc: `forked to ${ev.payload.forkee?.full_name ?? ""}`,
        link: ev.payload.forkee?.html_url,
      };
    case "WatchEvent":
      return {
        icon: Star, color: "text-yellow-500", bg: "bg-yellow-500/10",
        desc: "starred repository",
        link: `https://github.com/${ev.repo.name}`,
      };
    case "ReleaseEvent":
      return {
        icon: Zap, color: "text-rose-500", bg: "bg-rose-500/10",
        desc: `released ${ev.payload.release?.tag_name ?? "new version"}`,
        link: ev.payload.release?.html_url,
      };
    default:
      return {
        icon: GitCommit, color: "text-muted-foreground", bg: "bg-muted/30",
        desc: ev.type.replace("Event", "").replace(/([A-Z])/g, " $1").trim().toLowerCase(),
        link: undefined,
      };
  }
}

const ALLOWED_TYPES = [
  "PushEvent", "PullRequestEvent", "PullRequestReviewEvent",
  "IssuesEvent", "CreateEvent", "ForkEvent", "WatchEvent", "ReleaseEvent",
];

async function getUserEvents(username: string, token: string, page: number): Promise<GitHubEvent[]> {
  const res = await fetch(
    `https://api.github.com/users/${username}/events?per_page=30&page=${page}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
      next: { revalidate: 60 },
    }
  );
  if (!res.ok) return [];
  const all: GitHubEvent[] = await res.json();
  return all.filter((e) => ALLOWED_TYPES.includes(e.type));
}

const EVENT_FILTERS = [
  { label: "All",      value: "",                  color: "text-foreground"         },
  { label: "Commits",  value: "PushEvent",          color: "text-amber-500"         },
  { label: "PRs",      value: "PullRequestEvent",   color: "text-emerald-500"        },
  { label: "Issues",   value: "IssuesEvent",         color: "text-amber-500"          },
  { label: "Stars",    value: "WatchEvent",          color: "text-yellow-500"         },
  { label: "Releases", value: "ReleaseEvent",        color: "text-rose-500"           },
  { label: "Forks",    value: "ForkEvent",           color: "text-amber-500"           },
];

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(ROUTES.login);

  const { page: pageStr, type: typeFilter } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1", 10));
  const activeFilter = EVENT_FILTERS.find((f) => f.value === (typeFilter ?? "")) ? (typeFilter ?? "") : "";

  const token = await getGitHubToken();
  const isGitHubUser = session.provider === "github" || Boolean(session.accessToken);

  let events: GitHubEvent[] = [];
  let githubLogin: string | null = null;

  if (isGitHubUser && token) {
    const profileRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
      next: { revalidate: 300 },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      githubLogin = profile.login;
      events = await getUserEvents(profile.login, token, page);
      // Client-side filter by event type (already fetched all — filter after)
      if (activeFilter) {
        events = events.filter((e) => e.type === activeFilter);
      }
    }
  }

  const pushCount = events.filter((e) => e.type === "PushEvent").length;
  const prCount = events.filter((e) => e.type === "PullRequestEvent").length;
  const totalCommits = events
    .filter((e) => e.type === "PushEvent")
    .reduce((s, e) => s + (e.payload.commits?.length ?? 0), 0);
  const starCount = events.filter((e) => e.type === "WatchEvent").length;

  const hasPrev = page > 1;
  const hasNext = events.length === 30; // if we got a full page, there might be more

  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <span className="bg-clip-text text-transparent bg-linear-to-r from-amber-500 to-amber-500">
              Activity Pulse
            </span>
            {isGitHubUser ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] uppercase font-bold text-emerald-500 tracking-widest">Live</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                <span className="text-[10px] uppercase font-bold text-amber-500 tracking-widest">Limited</span>
              </div>
            )}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            {isGitHubUser && githubLogin
              ? `Real-time GitHub events for @${githubLogin} — Page ${page}`
              : "Connect GitHub to see your live activity feed."}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-none bg-card border border-border">
          <Globe className="size-4 text-muted-foreground" />
          <span className="text-xs font-bold text-muted-foreground">GitHub Events API</span>
        </div>
      </div>

      {!isGitHubUser ? (
        <div className="flex flex-col items-center justify-center py-24 text-center rounded-none border-2 border-dashed border-border/50 gap-4">
          <GitCommit className="size-12 text-muted-foreground/20" />
          <div>
            <h3 className="text-lg font-black mb-2">GitHub Account Required</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              Sign in with GitHub OAuth to see your real-time activity feed — commits, pull requests, reviews, and more.
            </p>
            <ConnectGitHubButton callbackUrl="/activity" />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 grid-cols-1 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            {/* Event type filter bar */}
            <div className="flex flex-wrap gap-2">
              {EVENT_FILTERS.map((f) => (
                <Link
                  key={f.value || "all"}
                  href={`/activity?page=1${f.value ? `&type=${f.value}` : ""}`}
                  className={cn(
                    "px-3 py-1.5 rounded-none text-xs font-bold border transition-all",
                    activeFilter === f.value
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                      : "border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f.label}
                </Link>
              ))}
            </div>
            <div className="glass-panel rounded-none p-1 overflow-hidden">
              {events.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  {page > 1
                    ? "No more events found. You&apos;ve reached the end of your activity history."
                    : `No recent activity found for @${githubLogin}.`}
                </div>
              ) : (
                <div className="flex flex-col">
                  {events.map((ev, idx) => {
                    const mapped = mapEvent(ev);
                    const Icon = mapped.icon;
                    const timeAgo = formatDistanceToNow(new Date(ev.created_at), { addSuffix: true });
                    const repoLink = `https://github.com/${ev.repo.name}`;
                    return (
                      <div
                        key={ev.id}
                        className={cn(
                          "group flex items-start gap-3 p-3 sm:gap-4 sm:p-5 transition-all hover:bg-muted/50",
                          idx !== events.length - 1 && "border-b border-border/50"
                        )}
                      >
                        <Image
                          src={ev.actor.avatar_url}
                          alt={ev.actor.login}
                          width={32}
                          height={32}
                          className="size-8 sm:size-9 rounded-none border border-border/50 shrink-0 mt-0.5"
                        />
                        <div className={cn("flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-none shadow-sm transition-transform group-hover:scale-110", mapped.bg)}>
                          <Icon className={cn("size-4 sm:size-5", mapped.color)} />
                        </div>
                        <div className="flex-1 space-y-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-sm font-bold">
                              <span className="text-foreground">{ev.actor.login}</span>
                              <span className="mx-2 text-muted-foreground font-normal">in</span>
                              <a
                                href={repoLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground hover:text-amber-500 transition-colors"
                              >
                                {ev.repo.name}
                              </a>
                            </p>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0 font-medium uppercase tracking-wider">
                              <Clock className="size-3" />
                              {timeAgo}
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground/90 font-medium truncate">
                            {mapped.link ? (
                              <a href={mapped.link} target="_blank" rel="noopener noreferrer" className="hover:text-amber-500 transition-colors">
                                {mapped.desc}
                              </a>
                            ) : mapped.desc}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pagination — preserves active type filter */}
            {(() => {
              const typeParam = activeFilter ? `&type=${activeFilter}` : "";
              return (
                <div className="flex items-center justify-between px-1">
                  <Link
                    href={`/activity?page=${page - 1}${typeParam}`}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-none border text-xs font-bold transition-all",
                      hasPrev
                        ? "border-border bg-card hover:bg-muted hover:border-amber-500/30"
                        : "border-border/30 text-muted-foreground/30 pointer-events-none"
                    )}
                    aria-disabled={!hasPrev}
                  >
                    <ChevronLeft className="size-4" /> Previous Page
                  </Link>
                  <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                    Page {page}
                  </span>
                  <Link
                    href={`/activity?page=${page + 1}${typeParam}`}
                    className={cn(
                      "inline-flex items-center gap-2 px-4 py-2 rounded-none border text-xs font-bold transition-all",
                      hasNext
                        ? "border-border bg-card hover:bg-muted hover:border-amber-500/30"
                        : "border-border/30 text-muted-foreground/30 pointer-events-none"
                    )}
                    aria-disabled={!hasNext}
                  >
                    Next Page <ChevronRight className="size-4" />
                  </Link>
                </div>
              );
            })()}
          </div>

          <div className="space-y-6">
            <Card className="glass-panel p-6 border-none shadow-none">
              <h3 className="text-sm font-black uppercase tracking-widest mb-4">Quick Stats</h3>
              <div className="space-y-4">
                {[
                  { label: "Events This Page", value: String(events.length) },
                  { label: "Push Events", value: String(pushCount) },
                  { label: "Commits Tracked", value: String(totalCommits), highlight: true },
                  { label: "Pull Requests", value: String(prCount) },
                  { label: "Stars Given", value: String(starCount) },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-medium">{label}</span>
                    <span className={cn("text-xs font-black", highlight && "text-emerald-500")}>{value}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="glass-panel p-6 border-none shadow-none">
              <h3 className="text-xs font-black uppercase tracking-widest mb-2">Pro Tip</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                GitHub&apos;s Events API stores up to 90 days of activity across 10 pages. Use pagination to explore your full history. Visit the{" "}
                <Link href="/intelligence" className="text-amber-500 hover:underline">Intelligence Hub</Link>{" "}
                for DORA metrics and cycle time analysis.
              </p>
            </Card>

            <Card className="glass-panel p-6 border-none shadow-none">
              <h3 className="text-xs font-black uppercase tracking-widest mb-3">Event Types</h3>
              <div className="space-y-2">
                {[
                  { type: "Push", color: "bg-amber-500", count: pushCount },
                  { type: "Pull Requests", color: "bg-emerald-500", count: prCount },
                  { type: "Stars", color: "bg-yellow-500", count: starCount },
                  { type: "Other", color: "bg-muted-foreground", count: events.length - pushCount - prCount - starCount },
                ].map((item) => (
                  <div key={item.type} className="flex items-center gap-2">
                    <div className={cn("size-2 rounded-full shrink-0", item.color)} />
                    <span className="text-xs text-muted-foreground flex-1">{item.type}</span>
                    <span className="text-xs font-bold">{item.count}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
