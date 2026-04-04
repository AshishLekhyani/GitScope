"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { MaterialIcon } from "@/components/material-icon";
import { ROUTES } from "@/constants/routes";
import { performLogout } from "@/lib/client-auth";
import { useAppDispatch } from "@/store/hooks";
import { setCommandPaletteOpen, setShortcutsOpen } from "@/store/slices/uiSlice";
import { useRecentHistory } from "@/hooks/use-recent-history";
import { useNotifications, NotificationItem } from "@/hooks/use-notifications";
import { formatDistanceToNow } from "date-fns";
import {
  Menu,
  Search as SearchIcon,
  History,
  Box,
  User,
  TrendingUp,
  ChevronRight,
  Sun,
  Moon
} from "lucide-react";

import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeedbackModal } from "@/components/modals/feedback-modal";

export interface SearchRepoResult {
  owner: string;
  repo: string;
  avatar: string;
  stars: string | number;
  desc: string;
}

const RECOMMENDATIONS = {
  repos: [
    { owner: "vercel", repo: "next.js", stars: "116k", desc: "The React Framework for the Web", avatar: "https://github.com/vercel.png" },
    { owner: "facebook", repo: "react", stars: "212k", desc: "The library for web and native UIs", avatar: "https://github.com/facebook.png" },
    { owner: "shadcn", repo: "ui", stars: "46k", desc: "Beautifully designed components", avatar: "https://github.com/shadcn.png" },
  ],
  users: [
    { name: "shadcn", type: "Design Architect", avatar: "https://github.com/shadcn.png" },
    { name: "gaearon", type: "React Legend", avatar: "https://github.com/gaearon.png" },
  ]
};

const PKG_VERSION = "2.4.0-stable";

type SearchUserResult = {
  name: string;
  avatar: string;
  type: string;
};

import { Session } from "next-auth";

interface TopNavProps {
  onMenuClick?: () => void;
  title?: string;
  session: Session | null;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

export function TopNav({
  onMenuClick,
  title,
  session,
  searchInputRef
}: TopNavProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [liveResults, setLiveResults] = useState<{ repos: SearchRepoResult[]; users: SearchUserResult[] }>({ repos: [], users: [] });
  const { history: recentHistory, addToHistory, loading: historyLoading } = useRecentHistory();
  const { notifications, unreadCount, markAsRead } = useNotifications();
  const searchRef = useRef<HTMLDivElement>(null);
  const fetchTimeout = useRef<NodeJS.Timeout | null>(null);
  const { data: clientSession, status: clientStatus } = useSession(); // Still hook into session for status changes (logs outs, etc.)
  const [os, setOs] = useState<"mac" | "win">("win");

  // Prefer server-seeded session for the initial mount/hydration to avoid skeletons
  const effectiveSession = session || clientSession;
  const status = session ? "authenticated" : clientStatus;

  const isLoading = status === "loading" || !mounted;
  const userName = effectiveSession?.user?.name || effectiveSession?.user?.email?.split('@')[0] || "User";

  // Robust initials calculation.
  // Prioritizes name, then email, then hard-codes a fallback for the dashboard.
  const userInitials = (effectiveSession?.user?.name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() ||
    effectiveSession?.user?.email?.charAt(0).toUpperCase() ||
    "TU";

  const userImage = effectiveSession?.user?.image;

  useEffect(() => {
    setMounted(true);
    const ua = window.navigator.userAgent.toLowerCase();
    setOs(ua.indexOf("mac") !== -1 ? "mac" : "win");

    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsFocused(false);
      }
    };

    const handlePopState = () => {
      setIsFocused(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // Debounced Live Search
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setLiveResults({ repos: [], users: [] });
      setIsSearching(false);
      return;
    }

    if (fetchTimeout.current) clearTimeout(fetchTimeout.current);

    fetchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/github/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = await res.json();
          setLiveResults({ repos: data.repos || [], users: data.users || [] });
        }
      } catch (e) {
        console.error("Live search failed", e);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => { if (fetchTimeout.current) clearTimeout(fetchTimeout.current); };
  }, [q]);

  const repoMatch = pathname.match(/^\/dashboard\/([^/]+)\/([^/]+)/);
  const owner = repoMatch?.[1];
  const repo = repoMatch?.[2];

  const submit = () => {
    const trimmed = q.trim();
    if (!trimmed) {
      router.push(ROUTES.search);
      return;
    }
    setIsFocused(false);

    if (trimmed.includes("/")) {
      const [o, r] = trimmed.split("/").filter(Boolean);
      if (o && r) {
        // Find if we have avatar data in current results to save to history
        const repoData = liveResults.repos.find(rp => rp.owner === o && rp.repo === r);
        addToHistory({
          id: `${o}/${r}`,
          name: r,
          type: "repo",
          avatar: repoData?.avatar || `https://github.com/${o}.png`
        });
        router.push(ROUTES.dashboard(o, r));
        return;
      }
    }

    router.push(`${ROUTES.search}?q=${encodeURIComponent(trimmed)}`);
  };

  const showSuggestions = mounted && isFocused && (q.trim().length > 0 || recentHistory.length > 0);

  const nav =
    owner && repo
      ? [
        { href: ROUTES.dashboard(owner, repo), label: "Overview" },
        { href: ROUTES.analytics(owner, repo), label: "Insights" },
        { href: ROUTES.compare, label: "Compare" },
      ]
      : [
        { href: ROUTES.overview, label: "Overview" },
        { href: ROUTES.search, label: "Explore" },
        { href: ROUTES.pricing, label: "Pricing" },
        { href: ROUTES.docs, label: "Docs" },
      ];

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <motion.header
      className="bg-background border-border supports-backdrop-filter:bg-background/95 sticky top-0 z-50 flex h-16 w-full shrink-0 items-center justify-between gap-2 border-b px-3 backdrop-blur-md sm:px-6 dark:border-indigo-900/20"
    >
      {/* Mobile search overlay */}
      <AnimatePresence>
        {mobileSearchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center gap-2 bg-background px-3 sm:hidden"
          >
            <div ref={searchRef} className="relative flex min-w-0 flex-1 items-center">
              <div className={cn(
                "border-border flex min-w-0 flex-1 items-center rounded-xl border border-white/5 bg-slate-100/80 px-3 py-1.5 dark:bg-slate-900/50 ring-2 ring-indigo-500/20"
              )}>
                <MaterialIcon name="search" size={18} className="text-indigo-500 shrink-0" />
                <Input
                  autoFocus
                  value={q}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { submit(); setMobileSearchOpen(false); }
                    if (e.key === "Escape") setMobileSearchOpen(false);
                  }}
                  placeholder="owner/repo or @user"
                  className="font-mono border-0 bg-transparent py-0 text-sm focus-visible:ring-0"
                  aria-label="Mobile repository search"
                />
              </div>
            </div>
            <button
              type="button"
              aria-label="Close search"
              onClick={() => { setMobileSearchOpen(false); setQ(""); }}
              className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent"
            >
              <MaterialIcon name="close" size={20} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-8">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:bg-accent md:hidden -ml-1"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>

        <Link
          href="/"
          className="flex items-center gap-1.5 sm:gap-2 shrink-0"
        >
          <Image
            src="/logo.png"
            width={24}
            height={24}
            alt="GitScope Logo"
            className="size-6 sm:size-7 rounded-lg shadow-lg shadow-primary/10 ring-1 ring-white/10"
          />
          <div className="flex flex-col leading-none">
            <span className="font-heading text-base sm:text-lg font-bold tracking-tight text-foreground sm:text-xl">
              GitScope
            </span>
            <span className="hidden sm:block font-mono text-[8px] tracking-widest text-muted-foreground uppercase">
              v{PKG_VERSION}
            </span>
          </div>
        </Link>

        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4 md:gap-6">
          <div ref={searchRef} className="relative z-50 hidden min-w-0 max-w-md flex-1 items-center sm:flex">
            <div className={cn(
              "border-border focus-within:ring-indigo-500/40 flex min-w-0 flex-1 items-center rounded-xl border border-white/5 bg-slate-100/80 px-2 py-1.5 focus-within:ring-2 sm:px-3 dark:bg-slate-900/50 transition-all duration-200",
              isFocused && "bg-white dark:bg-slate-900 shadow-2xl ring-2 ring-indigo-500/20"
            )}>
              <div className="relative flex items-center justify-center">
                <MaterialIcon name="search" size={18} className={cn("transition-colors", isFocused ? "text-indigo-500" : "text-muted-foreground")} />
                {isSearching && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <div className="size-4 rounded-full border-2 border-indigo-500/20 border-t-indigo-500" />
                  </motion.div>
                )}
              </div>
              <Input
                ref={searchInputRef}
                value={q}
                onFocus={() => setIsFocused(true)}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  if (e.key === "Escape") setIsFocused(false);
                }}
                autoComplete="off"
                spellCheck="false"
                data-lpignore="true"
                placeholder={owner && repo ? `${owner}/${repo}` : "owner/repo or @user"}
                className="font-mono border-0 bg-transparent py-0 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
                aria-label="Global repository search"
              />
            </div>

            <AnimatePresence>
              {showSuggestions && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.98 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="absolute top-full left-0 mt-2 w-full min-w-[320px] rounded-2xl border border-white/10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-2xl overflow-hidden p-2 z-[100]"
                >
                  {/* Discovery Recommendations (Only when query is empty and no relevant history) */}
                  {!q && recentHistory.length === 0 && !historyLoading && (
                    <div className="p-2">
                      <div className="mb-2 px-2 flex items-center gap-2">
                        <TrendingUp className="size-3 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-primary">Discovery</span>
                      </div>
                      <div className="space-y-1">
                        {RECOMMENDATIONS.repos.map((item) => (
                          <button
                            key={item.owner + item.repo}
                            onClick={() => {
                              addToHistory({ id: `${item.owner}/${item.repo}`, name: item.repo, type: "repo", avatar: item.avatar });
                              setIsFocused(false);
                              router.push(ROUTES.dashboard(item.owner, item.repo));
                            }}
                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="size-8 rounded-lg overflow-hidden border border-border">
                                <Image src={item.avatar} width={32} height={32} alt={item.owner} className="size-full object-cover" />
                              </div>
                              <div>
                                <div className="text-xs font-bold text-foreground">
                                  <span className="opacity-40">{item.owner}/</span>{item.repo}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">{item.desc}</div>
                              </div>
                            </div>
                            <ChevronRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent & Matching History */}
                  {recentHistory.length > 0 && (
                    <div className="p-2 border-b border-white/5 last:border-0">
                      <div className="mb-2 px-2 flex items-center gap-2">
                        <History className="size-3 text-muted-foreground" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                          {q ? "History Matches" : "Recent Analysis"}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {recentHistory
                          .filter(item => !q || item.name.toLowerCase().includes(q.toLowerCase()) || item.id.toLowerCase().includes(q.toLowerCase()))
                          .slice(0, q ? 3 : 8)
                          .map((item) => (
                            <button
                              key={item.id + item.timestamp}
                              onClick={() => {
                                setQ(item.type === "repo" ? item.id : `@${item.name}`);
                                setIsFocused(false);
                                router.push(item.type === "repo" ? ROUTES.dashboard(item.id.split('/')[0], item.id.split('/')[1]) : `/dashboard/${item.name}`);
                              }}
                              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold hover:bg-indigo-500/10 hover:text-indigo-500 transition-colors group"
                            >
                              <div className="size-6 rounded-md overflow-hidden border border-border bg-muted">
                                {item.avatar && <Image src={item.avatar} width={24} height={24} alt={item.name} className="size-full object-cover" />}
                              </div>
                              <div className="flex-1 truncate">
                                <div className="truncate">{item.name}</div>
                                <div className="text-[8px] font-black uppercase tracking-tighter opacity-40">{item.type}</div>
                              </div>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Matching Repositories */}
                  {q && liveResults.repos.length > 0 && (
                    <div className="p-2 border-b border-white/5 last:border-0">
                      <div className="mb-2 px-2 flex items-center gap-2">
                        <Box className="size-3 text-indigo-500" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Live Repositories</span>
                      </div>
                      {liveResults.repos.map((item) => (
                        <button
                          key={`${item.owner}/${item.repo}`}
                          onClick={() => {
                            addToHistory({ id: `${item.owner}/${item.repo}`, name: item.repo, type: "repo", avatar: item.avatar });
                            setIsFocused(false);
                            router.push(ROUTES.dashboard(item.owner, item.repo));
                          }}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded-lg overflow-hidden border border-indigo-500/10">
                              <Image src={item.avatar} width={32} height={32} alt={item.owner} className="size-full object-cover" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-foreground">
                                <span className="opacity-40">{item.owner}/</span>{item.repo}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{item.desc}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] font-black text-muted-foreground">
                            <TrendingUp className="size-3" />
                            {item.stars}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Matching Users */}
                  {q && liveResults.users.length > 0 && (
                    <div className="p-2">
                      <div className="mb-2 px-2 flex items-center gap-2">
                        <User className="size-3 text-purple-500" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-purple-500">Entities</span>
                      </div>
                      {liveResults.users.map((item) => (
                        <button
                          key={item.name}
                          onClick={() => {
                            addToHistory({ id: item.name, name: item.name, type: "user", avatar: item.avatar });
                            setIsFocused(false);
                            router.push(`/dashboard/${item.name}`);
                          }}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded-full overflow-hidden bg-purple-500/10 border border-purple-500/10">
                              <Image src={item.avatar} width={24} height={24} alt={item.name} className="size-full object-cover" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-foreground">@{item.name}</div>
                              <div className="text-[10px] text-muted-foreground">{item.type}</div>
                            </div>
                          </div>
                          <ChevronRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Empty State */}
                  {q && !isSearching && liveResults.repos.length === 0 && liveResults.users.length === 0 && (
                    <div className="p-8 text-center">
                      <SearchIcon className="size-8 mx-auto text-muted-foreground/20 mb-3" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">No matches found in ecosystem</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <nav className="text-muted-foreground hidden items-center gap-1 lg:flex px-2 translate-y-[2px]">
            {nav.map((item) => {
              let active = pathname === item.href;
              if (owner && repo) {
                const base = ROUTES.dashboard(owner, repo);
                if (item.href === base) active = pathname === base;
                else if (item.label === "Insights")
                  active = pathname.includes("/analytics");
                else if (item.label === "Compare")
                  active = pathname.startsWith("/compare");
              } else {
                if (item.href === ROUTES.overview)
                  active = pathname === ROUTES.overview;
                if (item.href === ROUTES.activity)
                  active = pathname === ROUTES.activity;
                if (item.href === ROUTES.search)
                  active = pathname.startsWith("/search");
                if (item.href === ROUTES.trending)
                  active = pathname.startsWith("/trending");
                if (item.href === ROUTES.pricing)
                  active = pathname === ROUTES.pricing;
                if (item.href === ROUTES.docs)
                  active = pathname === ROUTES.docs;
              }
              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  className={cn(
                    "relative hover:bg-accent/80 whitespace-nowrap rounded px-3 py-2 text-[11px] font-bold uppercase tracking-widest transition-colors",
                    active
                      ? "text-primary dark:text-indigo-400"
                      : "hover:text-foreground"
                  )}
                >
                  {item.label}
                  {active && (
                    <motion.div
                      layoutId="navUnderline"
                      className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary dark:bg-indigo-400 rounded-full"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>


      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1 md:gap-3">
        {/* Mobile search toggle */}
        <button
          type="button"
          aria-label="Search"
          className="text-muted-foreground hover:bg-accent flex items-center justify-center rounded-full size-9 sm:hidden"
          onClick={() => setMobileSearchOpen(true)}
        >
          <MaterialIcon name="search" size={20} />
        </button>

        <button
          type="button"
          className="border-border text-muted-foreground hover:bg-accent hidden items-center gap-1.5 rounded border px-2 py-1.5 text-[10px] font-mono sm:flex"
          onClick={() => dispatch(setShortcutsOpen(true))}
        >
          <MaterialIcon name="keyboard_command_key" size={14} />
          {os === "mac" ? "⌘K" : "K"}
        </button>
        {/* Notifications Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <button
              type="button"
              disabled={isLoading}
              className={cn(
                "text-muted-foreground hover:bg-accent inline-flex rounded-full relative size-9 items-center justify-center transition-colors outline-none",
                isLoading && "animate-pulse bg-slate-200 dark:bg-slate-800/50"
              )}
              aria-label="Notifications"
            >
              {!isLoading && (
                <>
                  <MaterialIcon name="notifications" size={22} />
                  {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[8px] font-black text-primary-foreground ring-2 ring-background animate-in zoom-in duration-300">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </>
              )}
            </button>
          } />
          {!isLoading && (
            <DropdownMenuContent align="end" className="w-80 border-outline-variant/20 bg-surface-container/95 backdrop-blur-md font-sans">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="font-heading font-black text-xs uppercase tracking-widest text-muted-foreground">Intelligence Feed</span>
                {unreadCount > 0 && (
                  <button onClick={() => notifications.forEach((n: NotificationItem) => !n.isRead && markAsRead(n.id))} className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors">
                    Mark all as read
                  </button>
                )}
              </div>
              <DropdownMenuSeparator className="bg-outline-variant/10 m-0" />
              <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                    <MaterialIcon name="notifications_off" size={32} className="text-muted-foreground/20 mb-2" />
                    <p className="text-xs font-bold text-muted-foreground">All caught up!</p>
                    <p className="text-[10px] text-muted-foreground/60 leading-relaxed mt-1">
                      No new notifications from GitHub or GitScope currently.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col p-1.5 gap-0.5">
                    {notifications.map((item: NotificationItem) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          if (!item.isRead) markAsRead(item.id);
                          if (item.link) window.open(item.link, '_blank');
                        }}
                        className={cn(
                          "flex items-start gap-4 rounded-xl p-3 transition-all cursor-pointer group relative overflow-hidden",
                          item.isRead ? "opacity-60 grayscale-[0.5]" : "bg-indigo-500/5 hover:bg-indigo-500/10 border border-indigo-500/5"
                        )}
                      >
                        <div className={cn(
                          "mt-0.5 rounded-lg p-2 shrink-0 border",
                          item.type === "success" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" :
                            item.type === "warning" ? "bg-amber-500/10 border-amber-500/20 text-amber-500" :
                              item.type === "error" ? "bg-red-500/10 border-red-500/20 text-red-500" :
                                "bg-indigo-500/10 border-indigo-500/20 text-indigo-500"
                        )}>
                          <MaterialIcon
                            name={
                              item.source === "github" ? "terminal" :
                                item.type === "success" ? "check_circle" :
                                  item.type === "warning" ? "warning" : "info"
                            }
                            size={16}
                          />
                        </div>
                        <div className="flex-1 min-w-0 pr-2">
                          <p className="text-xs font-bold text-foreground truncate leading-snug">{item.title}</p>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">{item.message}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-[9px] font-black uppercase tracking-tighter opacity-40">{item.source}</span>
                            <span className="size-1 rounded-full bg-border" />
                            <span className="text-[9px] text-muted-foreground">
                              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                        {!item.isRead && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 size-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <DropdownMenuSeparator className="bg-outline-variant/10 m-0" />
              <Link
                href="https://github.com/notifications"
                target="_blank"
                className="flex items-center justify-center p-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
              >
                Go to Inbox
                <MaterialIcon name="open_in_new" size={12} className="ml-2" />
              </Link>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:bg-accent hidden rounded-full md:inline-flex"
          onClick={() => dispatch(setCommandPaletteOpen(true))}
          aria-label="Command palette"
        >
          <MaterialIcon name="terminal" size={22} />
        </Button>
        {/* Help & Resources Dropdown - Hidden on mobile */}
        <div className="hidden sm:block">
          <DropdownMenu>
          <DropdownMenuTrigger render={
            <button
              type="button"
              className="flex items-center gap-1.5 px-1 py-1 rounded-full hover:bg-accent transition-colors cursor-pointer group outline-none"
            >
              <div className="relative flex items-center justify-center size-8">
                <MaterialIcon name="help_outline" size={22} className="text-muted-foreground group-hover:text-foreground" />

                {/* 
                  Indicator for new support/changelog updates.
                  Set hasNewUpdate to true when there is a new version or manual support notification.
                */}
                {false && (
                  <div className="absolute top-0 right-0 size-2.5 flex items-center justify-center">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
                  </div>
                )}
              </div>
            </button>
          } />
          <DropdownMenuContent align="end" className="w-56 border-outline-variant/20 bg-surface-container/95 backdrop-blur-md font-sans p-1.5">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-heading text-xs font-black uppercase tracking-widest text-muted-foreground/60 px-2 py-1.5">
                Support & Intelligence
              </DropdownMenuLabel>
              <DropdownMenuItem render={<Link href={ROUTES.docs}><MaterialIcon name="menu_book" size={16} className="mr-3 text-indigo-400" />Documentation</Link>} />
              <DropdownMenuItem render={<Link href={ROUTES.api}><MaterialIcon name="code" size={16} className="mr-3 text-purple-400" />API Reference</Link>} />
              <DropdownMenuItem render={<Link href={ROUTES.status}><MaterialIcon name="monitor_heart" size={16} className="mr-3 text-emerald-400" />System Status</Link>} />
              <DropdownMenuItem render={<Link href={ROUTES.changelog}><MaterialIcon name="rocket_launch" size={16} className="mr-3 text-amber-400" />What&apos;s New</Link>} />
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="bg-outline-variant/10" />
            <DropdownMenuItem
              onClick={() => setIsFeedbackOpen(true)}
              className="cursor-pointer font-bold text-primary focus:text-primary-foreground focus:bg-primary transition-all"
            >
              <MaterialIcon name="chat_bubble" size={16} className="mr-3" />
              Give Feedback
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
        {mounted && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-accent rounded-full"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            <Sun className="inline size-5 dark:hidden" />
            <Moon className="hidden size-5 dark:inline" />
          </Button>
        )}
        {mounted && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-accent rounded-full sm:hidden"
            onClick={() => void performLogout()}
            aria-label="Sign out"
          >
            <MaterialIcon name="logout" size={20} />
          </Button>
        )}
        {/* User Account Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <button
              disabled={isLoading}
              className={cn(
                "border-border hidden size-8 overflow-hidden rounded-full border sm:block transition-all outline-none",
                isLoading ? "animate-pulse bg-slate-200 dark:bg-slate-800" : "hover:ring-2 hover:ring-primary/50"
              )}
            >
              {!isLoading && (
                <div className="from-primary to-primary-container flex size-full items-center justify-center bg-gradient-to-br text-xs font-bold text-primary-foreground">
                  {userImage ? (
                    <Image src={userImage} width={32} height={32} alt="Avatar" className="size-full object-cover" />
                  ) : (
                    userInitials
                  )}
                </div>
              )}
            </button>
          } />
          {!isLoading && (
            <DropdownMenuContent align="end" className="w-56 border-outline-variant/20 bg-surface-container/95 backdrop-blur-md font-sans">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-bold leading-none truncate">{userName}</p>
                    <p className="text-xs leading-none text-muted-foreground truncate opacity-70">
                      {session?.user?.email || "Signed in as Guest"}
                    </p>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator className="bg-outline-variant/10" />
              <DropdownMenuItem render={
                <Link href={`${ROUTES.settings}?tab=profile`}>
                  <MaterialIcon name="person" size={16} className="mr-2" />
                  Profile & Account
                </Link>
              } className="cursor-pointer" />
              <DropdownMenuItem render={
                <Link href={`${ROUTES.settings}?tab=account`}>
                  <MaterialIcon name="manage_accounts" size={16} className="mr-2" />
                  Security & Password
                </Link>
              } className="cursor-pointer" />
              {session?.user && (
                <DropdownMenuItem render={
                  <Link href={ROUTES.pricing}>
                    <MaterialIcon name="credit_card" size={16} className="mr-2" />
                    Billing (Enterprise)
                  </Link>
                } className="cursor-pointer" />
              )}
              <DropdownMenuItem render={
                <Link href={`${ROUTES.settings}?tab=workspace`}>
                  <MaterialIcon name="tune" size={16} className="mr-2" />
                  Workspace Settings
                </Link>
              } className="cursor-pointer" />
              <DropdownMenuSeparator className="opacity-10" />
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive font-bold"
                onClick={() => {
                  void performLogout();
                }}
              >
                <MaterialIcon name="logout" size={16} className="mr-2" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </div>
      <FeedbackModal open={isFeedbackOpen} onOpenChange={setIsFeedbackOpen} />
    </motion.header>
  );
}
// TopNav v1 with debounced search
// debounce 400ms
// Notifications dropdown integrated
// fix: avatar optional check
// glassmorphism search dropdown polish
// NextImage alias applied
