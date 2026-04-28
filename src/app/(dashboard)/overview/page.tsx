export const dynamic = 'force-dynamic';

import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Overview — GitScope",
  description: "Your repository fleet health at a glance.",
};

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import {
  Building2,
  Search,
  GitMerge,
  TrendingUp,
  Settings,
  ArrowRight,
  ShieldAlert,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import Image from "next/image";
import { OnboardingTour } from "@/features/onboarding/onboarding-tour";

export default async function OverviewPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect(ROUTES.login);
  }

  const { name, email, image } = session.user;
  const displayName = name || email?.split("@")[0] || "Engineer";

  // Fetch real search history + account creation date from DB
  let recentHistory: { query: string; type: string; avatar: string | null; timestamp: Date }[] = [];
  let accountCreatedAt: Date | null = null;
  try {
    if (session.user.id) {
      const [history, user] = await Promise.all([
        prisma.searchHistory.findMany({
          where: { userId: session.user.id },
          orderBy: { timestamp: "desc" },
          take: 6,
        }),
        prisma.user.findUnique({
          where: { id: session.user.id },
          select: { createdAt: true },
        }),
      ]);
      recentHistory = history;
      accountCreatedAt = user?.createdAt ?? null;
    }
  } catch {
    // Silently fail — DB may not be seeded yet
  }

  const repoHistory = recentHistory.filter((h) => h.type === "repo");
  const orgHistory = recentHistory.filter((h) => h.type === "user");

  const quickActions = [
    {
      title: "Search Repositories",
      description: "Find and analyze any public GitHub repository instantly.",
      icon: Search,
      href: ROUTES.search,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
    {
      title: "Compare Metrics",
      description: "Analyze and juxtapose multiple repositories side-by-side.",
      icon: GitMerge,
      href: ROUTES.compare,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
    {
      title: "Trending Projects",
      description: "Discover the most starred and forked projects today.",
      icon: TrendingUp,
      href: ROUTES.trending,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      title: "Account Settings",
      description: "Manage your profile, tokens, and preferences.",
      icon: Settings,
      href: ROUTES.settings,
      color: "text-orange-500",
      bg: "bg-orange-500/10",
    },
  ];

  function timeAgo(date: Date): string {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 60) return "just now";
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  }

  const recentHistoryIsEmpty = recentHistory.length === 0;
  // Show onboarding only for accounts created in the last 2 hours (true first login)
  const isNewAccount = accountCreatedAt
    ? Date.now() - accountCreatedAt.getTime() < 2 * 60 * 60 * 1000
    : false;
  const isFirstTime = recentHistoryIsEmpty;

  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      {/* Onboarding tour: first-time users only, tracked per account in localStorage */}
      {isNewAccount && <OnboardingTour userKey={session.user.id ?? session.user.email ?? "unknown-user"} />}
      {/* Header section with radial glow */}
      <Card className="relative border border-border overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(199,122,18,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_100%_0%,rgba(251,191,36,0.05),transparent_50%)]" />
        <div className="absolute top-0 left-0 right-0 h-px bg-linear-to-r from-primary/30 via-primary/60 to-transparent" />
        <div className="relative z-10 p-5 sm:p-8">
          <div className="flex items-start gap-3 sm:gap-4">
            {image && (
              <Image
                src={image}
                alt={displayName}
                width={48}
                height={48}
                className="size-11 rounded-full border-2 border-primary/30 sm:size-13 shrink-0 mt-0.5"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] tracking-widest text-primary uppercase mb-1">
                {isFirstTime ? "// NEW SESSION" : "// RETURNING ENGINEER"}
              </p>
              <h2 className="font-bold tracking-tight leading-tight" style={{ fontFamily: "var(--font-space-grotesk)", fontSize: "clamp(20px,3vw,32px)", letterSpacing: "-0.02em" }}>
                {isFirstTime ? "Welcome, " : "Welcome back, "}
                <span className="text-primary">{displayName}</span>
              </h2>
              <p className="text-muted-foreground mt-1.5 text-xs sm:text-sm font-mono">
                {isFirstTime
                  ? "GitScope ready — analyze any public GitHub repository to begin."
                  : `${recentHistory.length} repositor${recentHistory.length === 1 ? "y" : "ies"} in history · Intelligence Hub live`}
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Link
              href={ROUTES.search}
              className="inline-flex h-9 items-center justify-center bg-foreground text-background px-5 text-[11px] font-bold font-mono uppercase tracking-widest transition-colors hover:bg-foreground/80"
            >
              Analyze Repository →
            </Link>
            {recentHistory.length > 0 && (
              <Link
                href={ROUTES.trending}
                className="inline-flex h-9 items-center justify-center border border-border px-5 text-[11px] font-bold font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                Stack Trending
              </Link>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-px grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-border bg-border">
        {quickActions.map((action) => (
          <Link key={action.title} href={action.href}>
            <div className="group relative flex h-full flex-col justify-between p-5 bg-background transition-colors duration-200 hover:bg-surface-container sm:p-6 min-h-36">
              <div>
                <div className={`inline-flex p-2.5 mb-4 ${action.bg}`}>
                  <action.icon className={`h-5 w-5 ${action.color}`} />
                </div>
                <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase mb-1.5">{action.title}</p>
                <p className="text-sm text-foreground font-medium leading-snug">
                  {action.description}
                </p>
              </div>
              <div className="mt-4 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                Open <ArrowRight className="size-3" />
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        {/* Recent Organizations */}
        <Card className="overflow-hidden border border-border shadow-none">
          <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
            <div className="flex size-7 items-center justify-center bg-amber-500/10">
              <Building2 className="h-4 w-4 text-amber-500" />
            </div>
            <p className="font-mono text-[10px] tracking-widest text-foreground uppercase font-bold">Recent Organizations</p>
          </div>
          <div className="p-5">
          {orgHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ShieldAlert className="h-8 w-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                No recent organizations found.
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Search an organization to track it here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {orgHistory.map((item) => (
                <Link
                  key={item.query}
                  href={`https://github.com/${item.query}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-none p-2 hover:bg-muted/60 transition-colors"
                >
                  {item.avatar ? (
                    <Image
                      src={item.avatar}
                      alt={item.query}
                      width={32}
                      height={32}
                      className="rounded-full"
                    />
                  ) : (
                    <div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                      {item.query[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.query}</p>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <Clock className="h-3 w-3" />
                    {timeAgo(item.timestamp)}
                  </span>
                </Link>
              ))}
            </div>
          )}
          </div>
        </Card>

        {/* Analyzed Repositories */}
        <Card className="overflow-hidden border border-border shadow-none">
          <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
            <div className="flex size-7 items-center justify-center bg-amber-500/10">
              <GitMerge className="h-4 w-4 text-amber-500" />
            </div>
            <p className="font-mono text-[10px] tracking-widest text-foreground uppercase font-bold">Analyzed Repositories</p>
          </div>
          <div className="p-5">
          {repoHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search className="h-8 w-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                Your history is empty.
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Start analyzing repositories to build your history.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {repoHistory.map((item) => {
                const [owner, repo] = item.query.split("/");
                return (
                  <Link
                    key={item.query}
                    href={owner && repo ? ROUTES.dashboard(owner, repo) : ROUTES.search}
                    className="flex items-center gap-3 rounded-none p-2 hover:bg-muted/60 transition-colors"
                  >
                    {item.avatar ? (
                      <Image
                        src={item.avatar}
                        alt={item.query}
                        width={32}
                        height={32}
                        className="rounded-none"
                      />
                    ) : (
                      <div className="size-8 rounded-none bg-primary/10 flex items-center justify-center">
                        <GitMerge className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono truncate">
                        <span className="text-muted-foreground">{owner}/</span>
                        <span className="font-bold text-primary">{repo}</span>
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Clock className="h-3 w-3" />
                      {timeAgo(item.timestamp)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
          </div>
        </Card>
      </div>
    </div>
  );
}
// Overview page v1
