"use client";

import { MaterialIcon } from "@/components/material-icon";
import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useGitHubRateLimit } from "@/hooks/use-github-rate-limit";

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

  // Sidebar content is static — never needs session-based loading
  const isLoading = false;

  const globalNav: NavDef[] = [
    {
      href: ROUTES.activity,
      label: "Activity Log",
      mat: "bubble_chart",
      match: (p) => p.startsWith("/activity"),
    },
    {
      href: ROUTES.organizations,
      label: "Organization Pulse",
      mat: "corporate_fare",
      match: (p) => p.startsWith("/organizations"),
    },
    {
      href: ROUTES.trending,
      label: "Trending Repos",
      mat: "trending_up",
      match: (p) => p.startsWith("/trending"),
    },
    {
      href: ROUTES.compare,
      label: "Repo Comparison",
      mat: "compare_arrows",
      match: (p) => p.startsWith("/compare"),
    },
    {
      href: "/intelligence",
      label: "Intelligence Hub",
      mat: "psychology",
      match: (p) => p.startsWith("/intelligence"),
    },
    {
      href: ROUTES.settings,
      label: "Settings",
      mat: "settings",
      match: (p) => p.startsWith("/settings"),
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
      "flex items-center transition-all duration-150 active:scale-[0.98]",
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
  }; const { rateLimit, latency, loading: rateLimitLoading } = useGitHubRateLimit();

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-2">
      <div className={cn("mb-6 flex items-center px-5", isCollapsed ? "justify-center px-0" : "justify-between")}>
        <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-3")}>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 dark:bg-indigo-500/20">
            <MaterialIcon name="rocket_launch" size={22} className="text-indigo-500 dark:text-indigo-400" />
          </div>
          {!isCollapsed && (
            <div>
              <h3 className="font-heading text-lg leading-none font-black tracking-tight text-indigo-600 dark:text-indigo-400">
                GitScope
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                v{PKG_VERSION}
              </p>
            </div>
          )}
        </div>
        {!isCollapsed && onToggleCollapse && (
          <button onClick={onToggleCollapse} className="text-muted-foreground hover:text-foreground transition-colors ml-auto">
            <MaterialIcon name="keyboard_double_arrow_left" size={20} />
          </button>
        )}
      </div>

      {!isCollapsed ? (
        <div className="border-border mb-4 border-b px-5 pb-4 dark:border-white/5">
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
          {isLoading ? (
            <div className="mt-2 h-4 w-44 animate-pulse rounded bg-slate-700/40 dark:bg-slate-900/80" />
          ) : (
            <p className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              Main Analytics Console
            </p>
          )}
        </div>
      ) : (
        <div className="border-border mb-4 flex justify-center border-b pb-4 dark:border-white/5 mx-2">
          {onToggleCollapse && (
            <button onClick={onToggleCollapse} className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-md hover:bg-sidebar-accent/80">
              <MaterialIcon name="keyboard_double_arrow_right" size={20} />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 custom-scrollbar">
        <nav className="space-y-1 pb-4">
          {globalNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              title={isCollapsed ? item.label : undefined}
              onClick={onNavigate}
              className={linkCls(item.match(pathname))}
            >
              <MaterialIcon name={item.mat} size={20} className="text-[inherit]" />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          ))}

          {repoNav.length > 0 && (
            <>
              {!isCollapsed && (
                <p className="text-muted-foreground px-4 pb-1 pt-4 text-[10px] font-semibold tracking-wider uppercase">
                  Repository
                </p>
              )}
              {isCollapsed && <div className="mx-4 my-4 h-px bg-border dark:bg-white/10" />}
              {repoNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  title={isCollapsed ? item.label : undefined}
                  onClick={onNavigate}
                  className={linkCls(isRepoActive(item.href))}
                >
                  <MaterialIcon name={item.mat} size={20} className="text-[inherit]" />
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </Link>
              ))}
            </>
          )}

          {!owner && !isCollapsed && (
            <div className="px-4 py-2 mt-4 rounded-lg bg-surface-container/50 border border-outline-variant/10">
              <p className="text-muted-foreground text-xs leading-relaxed text-center">
                Open a repository from Global Search to unlock repo-level analytics.
              </p>
            </div>
          )}
        </nav>
      </div>

      <div className="border-border mt-auto space-y-1 border-t px-2 py-4 dark:border-white/5 bg-surface-container/30">
        {!isCollapsed && (
          <div className="px-3 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MaterialIcon name="speed" size={16} className="text-indigo-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Performance Hub</span>
              </div>
              <div className="flex items-center gap-1.5 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[8px] font-bold text-emerald-400 border border-emerald-500/20">
                <div className="size-1 bg-emerald-400 rounded-full animate-pulse" />
                Live
              </div>
            </div>

            <div className="space-y-4">
              {/* Rate Limit */}
              <div>
                <div className="flex justify-between text-[9px] mb-2 font-mono">
                  <span className="text-slate-500">API RATE LIMIT</span>
                  <span className={cn("font-bold", (rateLimit?.remaining || 0) < 500 ? "text-amber-500" : "text-indigo-400")}>
                    {rateLimitLoading ? "..." : `${rateLimit?.remaining.toLocaleString()} / ${rateLimit?.limit.toLocaleString()}`}
                  </span>
                </div>
                <div className="h-1 w-full bg-outline-variant/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)] transition-all duration-1000"
                    style={{ width: rateLimit ? `${(rateLimit.remaining / rateLimit.limit) * 100}%` : "100%" }}
                  />
                </div>
              </div>

              {/* Latency */}
              <div className="flex justify-between items-center bg-surface-container-highest/60 p-2 rounded-lg border border-outline-variant/5 shadow-sm">
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-muted-foreground uppercase tracking-tighter">Latency</span>
                  <span className="text-[11px] font-mono font-bold text-foreground opacity-80">
                    {latency}ms <span className="text-[9px] text-muted-foreground font-normal">to gateway-node</span>
                  </span>
                </div>
                <MaterialIcon name="cable" size={14} className="text-indigo-400/50" />
              </div>
            </div>
          </div>
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
