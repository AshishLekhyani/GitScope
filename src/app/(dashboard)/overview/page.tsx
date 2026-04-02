export const dynamic = 'force-dynamic';

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

  // Fetch real search history from DB
  let recentHistory: { query: string; type: string; avatar: string | null; timestamp: Date }[] = [];
  try {
    if (session.user.id) {
      recentHistory = await prisma.searchHistory.findMany({
        where: { userId: session.user.id },
        orderBy: { timestamp: "desc" },
        take: 6,
      });
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
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      title: "Compare Metrics",
      description: "Analyze and juxtapose multiple repositories side-by-side.",
      icon: GitMerge,
      href: ROUTES.compare,
      color: "text-purple-500",
      bg: "bg-purple-500/10",
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

  const isFirstTime = recentHistory.length === 0;

  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      {/* Onboarding tour: first-time users only, tracked per account in localStorage */}
      {isFirstTime && <OnboardingTour userKey={session.user.id ?? session.user.email ?? "unknown-user"} />}
      {/* Header section with radial glow */}
      <div className="relative rounded-2xl border border-border bg-card p-5 shadow-sm overflow-hidden sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(67,97,238,0.1),transparent_50%)] dark:bg-[radial-gradient(circle_at_100%_0%,rgba(192,193,255,0.05),transparent_50%)]" />
        <div className="relative z-10 flex items-center gap-3 sm:gap-4">
          {image && (
            <Image
              src={image}
              alt={displayName}
              width={56}
              height={56}
              className="size-12 rounded-full border-2 border-primary/20 sm:size-14 shrink-0"
            />
          )}
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {isFirstTime ? "Welcome, " : "Welcome back, "}
              <span className="text-primary">{displayName}</span>
            </h2>
            <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
              {isFirstTime
                ? "GitScope is ready. Start by analyzing any public GitHub repository."
                : `You have ${recentHistory.length} repositor${recentHistory.length === 1 ? "y" : "ies"} in your history.`}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 sm:mt-6">
          <Link
            href={ROUTES.search}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Analyze a Repository
          </Link>
          {recentHistory.length > 0 && (
            <Link
              href={ROUTES.trending}
              className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-6 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
            >
              View Trending
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:gap-6 lg:grid-cols-4">
        {quickActions.map((action) => (
          <Link key={action.title} href={action.href}>
            <Card className="group relative overflow-hidden flex h-full flex-col justify-between p-4 transition-all hover:shadow-md hover:border-primary/50 sm:p-6">
              <div className="space-y-4">
                <div className={`inline-flex rounded-lg p-3 ${action.bg}`}>
                  <action.icon className={`h-6 w-6 ${action.color}`} />
                </div>
                <div>
                  <h3 className="font-semibold tracking-tight">{action.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {action.description}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Launch Tool <ArrowRight className="ml-1 h-4 w-4" />
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        {/* Recent Organizations */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold">Recent Organizations</h3>
          </div>
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
                  className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60 transition-colors"
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
        </Card>

        {/* Analyzed Repositories */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <GitMerge className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold">Analyzed Repositories</h3>
          </div>
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
                    className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/60 transition-colors"
                  >
                    {item.avatar ? (
                      <Image
                        src={item.avatar}
                        alt={item.query}
                        width={32}
                        height={32}
                        className="rounded-lg"
                      />
                    ) : (
                      <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
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
        </Card>
      </div>
    </div>
  );
}
// Overview page v1
