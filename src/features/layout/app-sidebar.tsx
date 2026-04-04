"use client";

import { MaterialIcon } from "@/components/material-icon";
import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useGitHubRateLimit } from "@/hooks/use-github-rate-limit";
import { useSession, signIn } from "next-auth/react";
import { useState, useEffect } from "react";

function parseRepo(pathname: string): { owner?: string; repo?: string } {
  const m = pathname.match(/^\/dashboard\/([^/]+)\/([^/]+)/);
  if (!m) return {};
  return { owner: m[1], repo: m[2] };
}

const PKG_VERSION = "2.4.0-stable";

type NavDef = {
  href: string;
  label: string;
  mat: string;
  match: (p: string) => boolean;
};

export function AppSidebar({
  onNavigate,
  isCollapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const { owner, repo } = parseRepo(pathname);
  const { setTheme, resolvedTheme } = useTheme();
  const { data: session } = useSession();
  
  // Connected providers from database (source of truth)
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [hasLoadedProviders, setHasLoadedProviders] = useState(false);
  
  useEffect(() => {
    // Fetch connected providers from database
    fetch("/api/user/account")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.connectedProviders) {
          setConnectedProviders(data.connectedProviders);
        }
        setHasLoadedProviders(true);
      })
      .catch(() => setHasLoadedProviders(true));
  }, []);
  
  // Check if GitHub is connected using database-stored providers
  const hasGitHub = connectedProviders.includes("github");
  // Fallback to session check while loading or if DB fetch fails
  const isGitHub = hasLoadedProviders 
    ? hasGitHub 
    : session?.provider === "github" || (!session?.provider && Boolean(session?.accessToken));

  // Sidebar content is static — never needs session-based loading
  const isLoading = false;

  const mainNav: NavDef[] = [
    {
      href: ROUTES.overview,
      label: "Overview",
      mat: "home",
      match: (p) => p === "/overview",
    },
    {
      href: ROUTES.activity,
      label: "Activity Log",
      mat: "bubble_chart",
      match: (p) => p.startsWith("/activity"),
    },
    {
      href: "/intelligence",
      label: "Intelligence Hub",
      mat: "psychology",
      match: (p) => p.startsWith("/intelligence"),
    },
    {
      href: ROUTES.notifications,
      label: "Notifications",
      mat: "notifications_active",
      match: (p) => p.startsWith("/notifications"),
    },
  ];

  const discoverNav: NavDef[] = [
    {
      href: ROUTES.search,
      label: "Search Repos",
      mat: "travel_explore",
      match: (p) => p.startsWith("/search"),
    },
    {
      href: ROUTES.trending,
      label: "Trending",
      mat: "trending_up",
      match: (p) => p.startsWith("/trending"),
    },
    {
      href: ROUTES.compare,
      label: "Compare Repos",
      mat: "compare_arrows",
      match: (p) => p.startsWith("/compare"),
    },
    {
      href: ROUTES.organizations,
      label: "Organizations",
      mat: "corporate_fare",
      match: (p) => p.startsWith("/organizations"),
    },
    {
      href: ROUTES.topics,
      label: "Topic Explorer",
      mat: "tag",
      match: (p) => p.startsWith("/topics"),
    },
  ];

  const analyticsNav: NavDef[] = [
    {
      href: ROUTES.leaderboard,
      label: "Leaderboard",
      mat: "leaderboard",
      match: (p) => p.startsWith("/leaderboard"),
    },
    {
      href: ROUTES.languages,
      label: "Languages",
      mat: "code_blocks",
      match: (p) => p.startsWith("/languages"),
    },
    {
      href: ROUTES.releases,
      label: "Releases",
      mat: "new_releases",
      match: (p) => p.startsWith("/releases"),
    },
    {
      href: ROUTES.bookmarks,
      label: "Bookmarks",
      mat: "bookmark",
      match: (p) => p.startsWith("/bookmarks"),
    },
  ];

  const repoNav =
    owner && repo
      ? [
        {
          href: ROUTES.dashboard(owner, repo),
          label: "Overview",
          mat: "dashboard",
        },
        {
          href: ROUTES.analytics(owner, repo),
          label: "Repository Analytics",
          mat: "analytics",
        },
        {
          href: ROUTES.contributors(owner, repo),
          label: "Contributor Insights",
          mat: "group",
        },
        {
          href: ROUTES.code(owner, repo),
          label: "Code Insights",
          mat: "code",
        },
        {
          href: ROUTES.commits(owner, repo),
          label: "Commits",
          mat: "history",
        },
        {
          href: ROUTES.source(owner, repo),
          label: "Source Explorer",
          mat: "folder_open",
        },
      ]
      : [];

  const linkCls = (active: boolean) =>
    cn(
      "flex items-center active:scale-[0.98]",
      isCollapsed ? "justify-center p-2 rounded-md mx-2 my-1" : "gap-3 border-l-2 py-2.5 pr-4 pl-3 text-sm",
      active
        ? isCollapsed
          ? "bg-sidebar-accent text-indigo-400 dark:text-indigo-400"
          : "border-tertiary bg-sidebar-accent text-indigo-400 dark:text-indigo-400 font-bold"
        : isCollapsed
          ? "text-muted-foreground hover:bg-sidebar-accent/80 hover:text-foreground border-transparent"
          : "border-transparent text-muted-foreground hover:bg-sidebar-accent/80 hover:text-foreground"
    );

  const isRepoActive = (href: string) => {
    if (href.endsWith("/source")) {
      return pathname.startsWith(href);
    }
    return pathname === href;
  }; const { rateLimit, loading: rateLimitLoading } = useGitHubRateLimit();

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-2">
      <div className={cn("mb-1 flex items-center px-5", isCollapsed ? "justify-center px-0" : "justify-between")}>
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className={cn("bg-indigo-500 size-2 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.5)]", isLoading && "animate-pulse")} />
            {isLoading ? (
              <div className="h-7 w-36 animate-pulse rounded bg-slate-700/80 dark:bg-slate-800/90" />
            ) : (
              <span className="font-heading text-lg font-bold text-foreground">
                Engineering Hub
              </span>
            )}
          </div>
        )}
        {!isCollapsed && onToggleCollapse && (
          <button onClick={onToggleCollapse} className="text-muted-foreground hover:text-foreground transition-colors">
            <MaterialIcon name="keyboard_double_arrow_left" size={20} />
          </button>
        )}
        {isCollapsed && onToggleCollapse && (
          <button onClick={onToggleCollapse} className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-md hover:bg-sidebar-accent/80">
            <MaterialIcon name="keyboard_double_arrow_right" size={20} />
          </button>
        )}
      </div>

      {!isCollapsed && (
        <div className="border-border mb-1 border-b px-5 pb-1 dark:border-white/5">
          {isLoading ? (
            <div className="h-4 w-44 animate-pulse rounded bg-slate-700/40 dark:bg-slate-900/80" />
          ) : (
            <p className="font-mono text-[8px] tracking-widest text-muted-foreground uppercase">
              Main Analytics Console
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 custom-scrollbar">
        <nav className="pb-4">
          {/* Main */}
          {!isCollapsed && (
            <p className="text-muted-foreground px-3 pb-1 pt-2 text-[9px] font-black tracking-[0.15em] uppercase opacity-50">Main</p>
          )}
          <div className="space-y-0.5 mb-2">
            {mainNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={isCollapsed ? item.label : undefined}
                onClick={onNavigate}
                className={linkCls(item.match(pathname))}
              >
                <MaterialIcon name={item.mat} size={20} className="text-inherit" />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </Link>
            ))}
          </div>

          {/* Discover */}
          {isCollapsed && <div className="mx-4 my-3 h-px bg-border dark:bg-white/10" />}
          {!isCollapsed && (
            <p className="text-muted-foreground px-3 pb-1 pt-3 text-[9px] font-black tracking-[0.15em] uppercase opacity-50">Discover</p>
          )}
          <div className="space-y-0.5 mb-2">
            {discoverNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={isCollapsed ? item.label : undefined}
                onClick={onNavigate}
                className={linkCls(item.match(pathname))}
              >
                <MaterialIcon name={item.mat} size={20} className="text-inherit" />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </Link>
            ))}
          </div>

          {/* Analytics */}
          {isCollapsed && <div className="mx-4 my-3 h-px bg-border dark:bg-white/10" />}
          {!isCollapsed && (
            <p className="text-muted-foreground px-3 pb-1 pt-3 text-[9px] font-black tracking-[0.15em] uppercase opacity-50">Analytics</p>
          )}
          <div className="space-y-0.5 mb-2">
            {analyticsNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={isCollapsed ? item.label : undefined}
                onClick={onNavigate}
                className={linkCls(item.match(pathname))}
              >
                <MaterialIcon name={item.mat} size={20} className="text-inherit" />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </Link>
            ))}
          </div>

          {/* Repository section */}
          {repoNav.length > 0 && (
            <>
              {isCollapsed && <div className="mx-4 my-3 h-px bg-border dark:bg-white/10" />}
              {!isCollapsed && (
                <p className="text-muted-foreground px-3 pb-1 pt-3 text-[9px] font-black tracking-[0.15em] uppercase opacity-50">Repository</p>
              )}
              <div className="space-y-0.5 mb-2">
                {repoNav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={isCollapsed ? item.label : undefined}
                    onClick={onNavigate}
                    className={linkCls(isRepoActive(item.href))}
                  >
                    <MaterialIcon name={item.mat} size={20} className="text-inherit" />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                ))}
              </div>
            </>
          )}

          {/* Settings at bottom of nav */}
          {isCollapsed && <div className="mx-4 my-3 h-px bg-border dark:bg-white/10" />}
          <div className="space-y-0.5 mt-2">
            <Link
              href={ROUTES.settings}
              title={isCollapsed ? "Settings" : undefined}
              onClick={onNavigate}
              className={linkCls(pathname.startsWith("/settings"))}
            >
              <MaterialIcon name="settings" size={20} className="text-inherit" />
              {!isCollapsed && <span className="truncate">Settings</span>}
            </Link>
            <Link
              href="/docs-reference"
              title={isCollapsed ? "Documentation" : undefined}
              onClick={onNavigate}
              className={linkCls(pathname.startsWith("/docs-reference"))}
            >
              <MaterialIcon name="menu_book" size={20} className="text-inherit" />
              {!isCollapsed && <span className="truncate">Documentation</span>}
            </Link>
          </div>
        </nav>
      </div>

      <div className="border-border mt-auto border-t px-2 py-3 dark:border-white/5 bg-surface-container/30">
        {/* API Rate Limit — only show for GitHub users (their own rate limit) */}
        {!isCollapsed && isGitHub && (
          <div className="px-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <MaterialIcon name="speed" size={14} className="text-indigo-400" />
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">API Rate</span>
              </div>
              <span className={cn("text-[9px] font-mono font-bold", (rateLimit?.remaining || 0) < 500 ? "text-amber-500" : "text-indigo-400")}>
                {rateLimitLoading ? "…" : `${(rateLimit?.remaining ?? 0).toLocaleString()} / ${(rateLimit?.limit ?? 5000).toLocaleString()}`}
              </span>
            </div>
            <div className="h-1 w-full bg-outline-variant/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-1000 rounded-full"
                /* dynamic percentage — cannot be a static Tailwind class */
                style={{ width: rateLimit ? `${(rateLimit.remaining / rateLimit.limit) * 100}%` : "100%" }}
              />
            </div>
          </div>
        )}

        {/* Connect GitHub CTA — shown to non-GitHub users */}
        {!isCollapsed && !isGitHub && session && (
          <button
            type="button"
            onClick={() => signIn("github")}
            className="w-full mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/5 border border-indigo-500/20 hover:bg-indigo-500/10 transition-colors text-left"
          >
            <MaterialIcon name="hub" size={16} className="text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] font-bold text-indigo-400">Connect GitHub</div>
              <div className="text-[9px] text-muted-foreground truncate">Unlock full features</div>
            </div>
          </button>
        )}

        {/* Workspace Quick-Actions */}
        <Link
          href={ROUTES.activity}
          title={isCollapsed ? "Session Activity" : undefined}
          onClick={onNavigate}
          className={cn(
            "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 flex items-center transition-colors group",
            isCollapsed ? "justify-center p-2 rounded-md mx-2 my-1" : "gap-3 px-4 py-1.5 text-xs rounded-md"
          )}
        >
          <MaterialIcon name="history" size={18} className="group-hover:text-indigo-400 transition-colors" />
          {!isCollapsed && <span>Session Activity</span>}
        </Link>

        {isCollapsed && (
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 flex items-center justify-center p-2 rounded-md mx-2 my-1 transition-colors"
          >
            <MaterialIcon name={resolvedTheme === 'dark' ? 'light_mode' : 'dark_mode'} size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
// AppSidebar v1
// Performance Hub section added
// parseRepo helper extracted
// collapsed icon alignment fix
