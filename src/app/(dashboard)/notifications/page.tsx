export const dynamic = 'force-dynamic';

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/material-icon";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GitHubNotification {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  subject: {
    title: string;
    url: string | null;
    type: "PullRequest" | "Issue" | "Release" | "Commit" | "Discussion" | string;
  };
  repository: {
    id: number;
    full_name: string;
    html_url: string;
    owner: {
      login: string;
      avatar_url: string;
    };
    private: boolean;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<
  string,
  { label: string; icon: string; color: string; bg: string }
> = {
  PullRequest: {
    label: "Pull Request",
    icon: "merge",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
  Issue: {
    label: "Issue",
    icon: "error_outline",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  Release: {
    label: "Release",
    icon: "new_releases",
    color: "text-rose-500",
    bg: "bg-rose-500/10",
  },
  Commit: {
    label: "Commit",
    icon: "commit",
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
  },
  Discussion: {
    label: "Discussion",
    icon: "forum",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
};

function getTypeMeta(type: string) {
  return (
    TYPE_META[type] ?? {
      label: type,
      icon: "notifications",
      color: "text-muted-foreground",
      bg: "bg-muted/40",
    }
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(ROUTES.login);

  const token = await getGitHubToken();
  const isGitHubUser =
    session.provider === "github" || Boolean(session.accessToken);

  // ── Fetch notifications ────────────────────────────────────────────────────
  let notifications: GitHubNotification[] = [];
  let fetchError: string | null = null;

  if (isGitHubUser && token) {
    try {
      const res = await fetch(
        "https://api.github.com/notifications?all=false&per_page=30",
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
          next: { revalidate: 60 },
        }
      );
      if (res.ok) {
        notifications = await res.json();
      } else {
        fetchError = `GitHub API returned ${res.status}`;
      }
    } catch {
      fetchError = "Failed to reach GitHub API";
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const unreadCount = notifications.filter((n) => n.unread).length;
  const typeCounts = notifications.reduce<Record<string, number>>((acc, n) => {
    acc[n.subject.type] = (acc[n.subject.type] ?? 0) + 1;
    return acc;
  }, {});

  // ── Group by repository ────────────────────────────────────────────────────
  const grouped = notifications.reduce<
    Record<string, { repoMeta: GitHubNotification["repository"]; items: GitHubNotification[] }>
  >((acc, n) => {
    const key = n.repository.full_name;
    if (!acc[key]) acc[key] = { repoMeta: n.repository, items: [] };
    acc[key].items.push(n);
    return acc;
  }, {});

  const groupedEntries = Object.entries(grouped).sort(
    ([, a], [, b]) =>
      new Date(b.items[0].updated_at).getTime() -
      new Date(a.items[0].updated_at).getTime()
  );

  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight">
            <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-indigo-500/10">
              <MaterialIcon name="notifications_active" size={22} className="text-indigo-500" />
            </span>
            <span className="bg-clip-text text-transparent bg-linear-to-r from-indigo-500 to-purple-500">
              Notification Center
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isGitHubUser
              ? "Your unread GitHub notifications, grouped by repository."
              : "Connect your GitHub account to see notifications."}
          </p>
        </div>
        {isGitHubUser && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2">
            <MaterialIcon name="notifications_active" size={16} className="text-muted-foreground" />
            <span className="text-xs font-bold text-muted-foreground">
              {notifications.length} total
            </span>
            {unreadCount > 0 && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="text-xs font-bold text-indigo-500">
                  {unreadCount} unread
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── No GitHub Token CTA ─────────────────────────────────────────────── */}
      {!isGitHubUser && (
        <div className="flex flex-col items-center justify-center gap-6 rounded-3xl border-2 border-dashed border-border/50 py-24 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-indigo-500/10">
            <MaterialIcon name="notifications_active" size={32} className="text-indigo-500" />
          </div>
          <div className="max-w-sm space-y-2">
            <h3 className="text-xl font-black">Connect GitHub Account</h3>
            <p className="text-sm text-muted-foreground">
              Sign in with GitHub OAuth to access your real-time notification
              feed — pull requests, issues, releases, and more.
            </p>
          </div>
          <Link
            href="/api/auth/signin/github"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-500"
          >
            <MaterialIcon name="link" size={16} className="text-white" />
            Connect GitHub Account
          </Link>
        </div>
      )}

      {/* ── Error state ─────────────────────────────────────────────────────── */}
      {isGitHubUser && fetchError && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <MaterialIcon name="warning" size={20} className="text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">{fetchError}</p>
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────────────────── */}
      {isGitHubUser && !fetchError && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: notification feed */}
          <div className="lg:col-span-2 space-y-4">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-border/50 py-20 text-center">
                <MaterialIcon name="done_all" size={40} className="text-emerald-500/40" />
                <div>
                  <h3 className="text-lg font-black">All caught up!</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    No unread notifications right now. Check back later.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedEntries.map(([repoName, group]) => (
                  <div
                    key={repoName}
                    className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"
                  >
                    {/* Repo header */}
                    <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-5 py-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={group.repoMeta.owner.avatar_url}
                        alt={group.repoMeta.owner.login}
                        width={22}
                        height={22}
                        className="size-[22px] rounded-md border border-border/50"
                      />
                      <a
                        href={group.repoMeta.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 font-mono text-sm font-bold hover:text-indigo-500 transition-colors truncate"
                      >
                        {repoName}
                      </a>
                      <span className="shrink-0 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-indigo-500">
                        {group.items.length}
                      </span>
                    </div>

                    {/* Notification items */}
                    {group.items.map((n, idx) => {
                      const meta = getTypeMeta(n.subject.type);
                      const timeAgo = formatDistanceToNow(
                        new Date(n.updated_at),
                        { addSuffix: true }
                      );
                      return (
                        <div
                          key={n.id}
                          className={cn(
                            "group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/40",
                            idx !== group.items.length - 1 &&
                              "border-b border-border/40",
                            n.unread && "bg-indigo-500/[0.03]"
                          )}
                        >
                          {/* Type icon */}
                          <div
                            className={cn(
                              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-110",
                              meta.bg
                            )}
                          >
                            <MaterialIcon
                              name={meta.icon}
                              size={16}
                              className={meta.color}
                            />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                              <p className="text-sm font-semibold leading-snug line-clamp-2 flex-1">
                                {n.subject.title}
                              </p>
                              {n.unread && (
                                <span className="inline-block size-2 shrink-0 rounded-full bg-indigo-500 mt-1.5" />
                              )}
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                                  meta.bg,
                                  meta.color
                                )}
                              >
                                {meta.label}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {timeAgo}
                              </span>
                              <span className="text-[11px] capitalize text-muted-foreground/70">
                                {n.reason.replace(/_/g, " ")}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: sidebar cards */}
          <div className="space-y-4">
            {/* Summary stats */}
            <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
              <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-muted-foreground">
                Summary
              </h3>
              <div className="space-y-3">
                {[
                  {
                    label: "Total Notifications",
                    value: notifications.length,
                    icon: "notifications",
                    color: "text-foreground",
                  },
                  {
                    label: "Unread",
                    value: unreadCount,
                    icon: "mark_email_unread",
                    color: "text-indigo-500",
                    highlight: unreadCount > 0,
                  },
                  {
                    label: "Repositories",
                    value: groupedEntries.length,
                    icon: "source",
                    color: "text-purple-500",
                  },
                ].map(({ label, value, icon, color, highlight }) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MaterialIcon name={icon} size={14} className={color} />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <span
                      className={cn(
                        "text-sm font-black",
                        highlight ? "text-indigo-500" : "text-foreground"
                      )}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Type breakdown */}
            {Object.keys(typeCounts).length > 0 && (
              <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-muted-foreground">
                  By Type
                </h3>
                <div className="space-y-2.5">
                  {Object.entries(typeCounts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => {
                      const meta = getTypeMeta(type);
                      const pct = Math.round(
                        (count / notifications.length) * 100
                      );
                      return (
                        <div key={type} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <MaterialIcon
                                name={meta.icon}
                                size={13}
                                className={meta.color}
                              />
                              <span className="text-xs font-medium text-muted-foreground">
                                {meta.label}
                              </span>
                            </div>
                            <span className="text-xs font-black">{count}</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                meta.bg.replace("/10", "")
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Quick link */}
            <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
              <h3 className="mb-2 text-xs font-black uppercase tracking-widest text-muted-foreground">
                Manage on GitHub
              </h3>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                Mark notifications as read, filter by repo, or adjust your
                notification settings directly on GitHub.
              </p>
              <a
                href="https://github.com/notifications"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-500 hover:underline"
              >
                Open GitHub Notifications
                <MaterialIcon name="open_in_new" size={12} className="text-indigo-500" />
              </a>
            </div>

            {/* Link to Activity feed */}
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
                  <p className="text-xs text-muted-foreground">See your full event feed</p>
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
