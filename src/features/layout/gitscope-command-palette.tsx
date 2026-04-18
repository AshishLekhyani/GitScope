"use client";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setCommandPaletteOpen } from "@/store/slices/uiSlice";
import { useRecentHistory } from "@/hooks/use-recent-history";
import { ROUTES } from "@/constants/routes";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { performLogout } from "@/lib/client-auth";
import {
  Terminal, Moon, Sun, LogOut, LayoutDashboard, BookOpen, Zap,
  Command as CommandIcon, TrendingUp, History, Search, GitMerge,
  Settings, Activity, Building2, Brain, CreditCard, User, RefreshCw, Github,
  Bell, Bookmark, Trophy, Package, CheckSquare, Radar,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";

type ActionItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sublabel?: string;
  href?: string;
  action?: () => void;
  category: string;
  danger?: boolean;
  keywords?: string[];
};

export function GitScopeCommandPalette() {
  const isOpen = useAppSelector((state) => state.ui.commandPaletteOpen);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const { history, clearHistory, loading: historyLoading } = useRecentHistory();
  const [search, setSearch] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch(setCommandPaletteOpen(false));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dispatch]);

  const navTo = (href: string) => {
    router.push(href);
    dispatch(setCommandPaletteOpen(false));
  };

  const isDark = resolvedTheme === "dark";

  const actions: ActionItem[] = [
    // Navigate
    { icon: LayoutDashboard, label: "Overview", sublabel: "Dashboard home", href: ROUTES.overview, category: "Navigate", keywords: ["home"] },
    { icon: Search, label: "Search Repositories", sublabel: "Find any GitHub repo", href: ROUTES.search, category: "Navigate", keywords: ["find", "explore"] },
    { icon: Brain, label: "Intelligence Hub", sublabel: "DORA metrics & AI risk", href: "/intelligence", category: "Navigate", keywords: ["ai", "dora", "velocity"] },
    { icon: Activity, label: "Activity Feed", sublabel: "Your live GitHub events", href: ROUTES.activity, category: "Navigate" },
    { icon: Bell, label: "Notifications", sublabel: "GitHub notification center", href: ROUTES.notifications, category: "Navigate", keywords: ["inbox", "alerts"] },
    // Discover
    { icon: TrendingUp, label: "Stack Trending", sublabel: "Trending in your tech stack", href: ROUTES.trending, category: "Discover" },
    { icon: GitMerge, label: "Compare Repos", sublabel: "Side-by-side benchmarks", href: ROUTES.compare, category: "Discover" },
    { icon: Building2, label: "Organizations", sublabel: "GitHub org analytics", href: ROUTES.organizations, category: "Discover" },
    // Analytics
    { icon: Trophy, label: "Contributor Leaderboard", sublabel: "Top contributors in your org", href: ROUTES.leaderboard, category: "Analytics", keywords: ["top", "contributors", "ranking"] },
    { icon: Package, label: "Release Radar", sublabel: "New releases from tracked repos", href: ROUTES.releases, category: "Analytics", keywords: ["releases", "updates", "dependencies"] },
    { icon: CheckSquare, label: "Action Items", sublabel: "Scan findings to fix", href: ROUTES.bookmarks, category: "Analytics", keywords: ["todos", "findings", "issues", "fix"] },
    // Settings
    { icon: User, label: "Profile Settings", sublabel: "Name, bio, avatar", href: `${ROUTES.settings}?tab=profile`, category: "Settings" },
    { icon: Settings, label: "Security & Password", sublabel: "Manage login methods", href: `${ROUTES.settings}?tab=account`, category: "Settings" },
    { icon: Zap, label: "Workspace Settings", sublabel: "Notifications, sync, API", href: `${ROUTES.settings}?tab=workspace`, category: "Settings" },
    { icon: CreditCard, label: "Billing & Plans", sublabel: "Upgrade your plan", href: ROUTES.pricingSettings, category: "Settings" },
    { icon: BookOpen, label: "Documentation", sublabel: "Guides & API reference", href: ROUTES.docsReference, category: "Settings", keywords: ["help", "reference"] },
    // System
    { icon: isDark ? Sun : Moon, label: `Switch to ${isDark ? "Light" : "Dark"} Mode`, action: () => { setTheme(isDark ? "light" : "dark"); dispatch(setCommandPaletteOpen(false)); }, category: "System", keywords: ["theme"] },
    { icon: RefreshCw, label: "Reload Page", action: () => { window.location.reload(); }, category: "System" },
    { icon: Github, label: "Open GitHub", sublabel: "github.com in new tab", action: () => { window.open("https://github.com", "_blank", "noopener"); dispatch(setCommandPaletteOpen(false)); }, category: "System" },
    { icon: LogOut, label: "Sign Out", action: () => { void performLogout(); }, category: "Account", danger: true },
  ];

  const q = search.toLowerCase().trim();
  const isRepoPattern = /^[\w.-]+\/[\w.-]+$/.test(q);

  const filteredActions = actions.filter((a) =>
    !q || [a.label, a.sublabel ?? "", a.category, ...(a.keywords ?? [])].some((s) => s.toLowerCase().includes(q))
  );

  const filteredHistory = (q
    ? history.filter((h) => h.name.toLowerCase().includes(q) || h.id?.toLowerCase().includes(q))
    : history
  ).slice(0, 5);

  const totalItems = filteredHistory.length + (isRepoPattern ? 1 : 0) + filteredActions.length;

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => (i + 1) % Math.max(totalItems, 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => (i - 1 + Math.max(totalItems, 1)) % Math.max(totalItems, 1)); }
      if (e.key === "Enter") {
        e.preventDefault();
        const hLen = filteredHistory.length;
        const gotoOff = isRepoPattern ? 1 : 0;
        if (selectedIdx < hLen) {
          const h = filteredHistory[selectedIdx];
          navTo(h.type === "repo" ? ROUTES.dashboard(h.id.split("/")[0], h.id.split("/")[1]) : `/${h.name}`);
        } else if (isRepoPattern && selectedIdx === hLen) {
          navTo(ROUTES.dashboard(q.split("/")[0], q.split("/")[1]));
        } else {
          const a = filteredActions[selectedIdx - hLen - gotoOff];
          if (a?.action) { a.action(); dispatch(setCommandPaletteOpen(false)); }
          else if (a?.href) navTo(a.href);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedIdx, totalItems, q]);

  useEffect(() => { setSelectedIdx(0); }, [search]);

  if (!isOpen) return null;

  const groupedActions = filteredActions.reduce<Record<string, ActionItem[]>>((acc, a) => {
    if (!acc[a.category]) acc[a.category] = [];
    acc[a.category].push(a);
    return acc;
  }, {});

  const historyOffset = filteredHistory.length + (isRepoPattern ? 1 : 0);
  let actionCursor = historyOffset;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        onClick={() => dispatch(setCommandPaletteOpen(false))}
        className="absolute inset-0 bg-background/50 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl"
      >
        <div className="flex items-center border-b border-border px-4 py-3.5 gap-3">
          <Terminal className="size-4 text-indigo-500 shrink-0" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search commands or type "owner/repo" to jump...'
            className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/40"
          />
          {search && <button type="button" onClick={() => setSearch("")} className="text-[10px] text-muted-foreground/50 hover:text-foreground">✕</button>}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">ESC</kbd>
        </div>

        <div className="max-h-[62vh] overflow-y-auto p-2">
          {isRepoPattern && (
            <button type="button"
              onClick={() => navTo(ROUTES.dashboard(q.split("/")[0], q.split("/")[1]))}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors mb-1",
                selectedIdx === filteredHistory.length ? "bg-indigo-500 text-white" : "hover:bg-indigo-500/10 hover:text-indigo-500"
              )}
            >
              <Github className="size-4 opacity-70 shrink-0" />
              <span className="flex-1">Analyze <span className="font-mono">{q}</span></span>
              <span className="text-[9px] font-black opacity-60 uppercase tracking-widest">Jump →</span>
            </button>
          )}

          <AnimatePresence>
            {(filteredHistory.length > 0 || historyLoading) && (
              <div className="mb-2">
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                    <History className="size-3" /> Recent
                  </span>
                  {!historyLoading && filteredHistory.length > 0 && (
                    <button type="button" onClick={clearHistory} className="text-[10px] text-muted-foreground/40 hover:text-primary">Clear</button>
                  )}
                </div>
                {historyLoading ? (
                  [1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2 animate-pulse">
                      <div className="size-8 rounded-lg bg-muted" />
                      <div className="h-3 w-32 bg-muted rounded" />
                    </div>
                  ))
                ) : (
                  filteredHistory.map((item, idx) => (
                    <button key={item.id} type="button"
                      onClick={() => navTo(item.type === "repo" ? ROUTES.dashboard(item.id.split("/")[0], item.id.split("/")[1]) : `/${item.name}`)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors",
                        selectedIdx === idx ? "bg-indigo-500 text-white" : "hover:bg-indigo-500/10 hover:text-indigo-500"
                      )}
                    >
                      <div className="size-8 rounded-lg overflow-hidden border border-outline-variant/20 shrink-0 bg-muted">
                        {item.avatar && <Image src={item.avatar} width={32} height={32} alt={item.name} className="size-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate">
                          {item.type === "repo" && <span className="opacity-50">{item.id.split("/")[0]}/</span>}
                          {item.name}
                        </div>
                        <div className="text-[10px] opacity-50 uppercase tracking-widest font-black">{item.type}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </AnimatePresence>

          {Object.entries(groupedActions).map(([category, items]) => {
            const catStart = actionCursor;
            actionCursor += items.length;
            return (
              <div key={category} className="mb-1">
                <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">{category}</div>
                {items.map((action, i) => {
                  const idx = catStart + i;
                  return (
                    <button key={action.label} type="button"
                      onClick={() => {
                        if (action.action) action.action();
                        else if (action.href) navTo(action.href);
                        if (!action.action) dispatch(setCommandPaletteOpen(false));
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                        selectedIdx === idx
                          ? action.danger ? "bg-destructive text-white" : "bg-indigo-500 text-white"
                          : action.danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-indigo-500/10 hover:text-indigo-500"
                      )}
                    >
                      <action.icon className="size-4 opacity-60 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate">{action.label}</div>
                        {action.sublabel && <div className="text-[10px] opacity-50 truncate">{action.sublabel}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}

          {totalItems === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No results for &quot;{search}&quot;</div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><CommandIcon className="size-3" />K</span>
            <span>↑↓ navigate</span>
            <span>↵ select</span>
          </div>
          <span className="font-bold text-indigo-500/60">GITSCOPE V1.0</span>
        </div>
      </motion.div>
    </div>
  );
}
