"use client";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAppDispatch } from "@/store/hooks";
import { setCommandPaletteOpen, setShortcutsOpen } from "@/store/slices/uiSlice";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { AppSidebar } from "./app-sidebar";
import { GitScopeCommandPalette } from "./gitscope-command-palette";
import { ShortcutsModal } from "./shortcuts-modal";
import { TopNav } from "./top-nav";
import { RateLimitBanner } from "./rate-limit-banner";
import { MaterialIcon } from "@/components/material-icon";
import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";

import { Session } from "next-auth";

export function DashboardShell({ 
  children,
  session: propSession 
}: { 
  children: React.ReactNode;
  session: Session | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  // Ref for search input to enable keyboard shortcut focus
  const searchInputRef = useRef<HTMLInputElement>(null);

  // First-run onboarding
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Load sidebar state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("gitscope:sidebar:collapsed");
    if (saved !== null) {
      setIsCollapsed(saved === "true");
    }
    setMounted(true);
    // Show onboarding if user has never dismissed it
    if (!localStorage.getItem("gitscope:onboarding:done")) {
      setShowOnboarding(true);
    }
  }, []);

  // Save sidebar state to localStorage when it changes
  useEffect(() => {
    if (mounted) {
      localStorage.setItem("gitscope:sidebar:collapsed", String(isCollapsed));
    }
  }, [isCollapsed, mounted]);

  const session = propSession;

  const title =
    pathname === "/"
      ? "GitScope"
      : pathname.startsWith("/dashboard/")
        ? pathname.split("/").slice(2, 4).join("/")
        : pathname.replace(/^\//, "");

  // Global Key Listeners
  useEffect(() => {
    let lastKey = "";
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input/textarea
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        if (e.key === "Escape") {
          (document.activeElement as HTMLInputElement).blur();
          dispatch(setCommandPaletteOpen(false));
          dispatch(setShortcutsOpen(false));
        }
        return;
      }

      const mod = e.metaKey || e.ctrlKey;

      // Escape: Close All
      if (e.key === "Escape") {
        dispatch(setCommandPaletteOpen(false));
        dispatch(setShortcutsOpen(false));
      }

      // Command Palette: Mod + K
      if (mod && e.key === "k") {
        e.preventDefault();
        dispatch(setCommandPaletteOpen(true));
      }

      // Fullscreen: F
      if (e.key.toLowerCase() === "f" && !mod) {
        e.preventDefault();
        try {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
        } catch (err) {
          console.warn("Fullscreen toggle failed", err);
        }
      }

      // Theme: T
      if (e.key.toLowerCase() === "t" && !mod) {
        e.preventDefault();
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
      }

      // Navigation Prefixes (G + ...)
      if (lastKey.toLowerCase() === "g") {
        if (e.key.toLowerCase() === "o") {
          e.preventDefault();
          router.push(ROUTES.overview);
        } else if (e.key.toLowerCase() === "e") {
          e.preventDefault();
          router.push(ROUTES.search);
        } else if (e.key.toLowerCase() === "d") {
          e.preventDefault();
          router.push("/docs-reference");
        }
      }

      // Shortcuts Helper: /
      if (e.key === "/" && !mod) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      lastKey = e.key;
      // Reset prefix after a delay
      setTimeout(() => { if (lastKey === e.key) lastKey = ""; }, 1000);
    };

    const handlePopState = () => {
      dispatch(setCommandPaletteOpen(false));
      dispatch(setShortcutsOpen(false));
    };

    const handleVisibilityChange = () => {
      // router.refresh() is unstable on tab switch; state is managed by useSession
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [dispatch, resolvedTheme, setTheme, router]);



  const dismissOnboarding = () => {
    localStorage.setItem("gitscope:onboarding:done", "1");
    setShowOnboarding(false);
  };

  const ONBOARDING_STEPS = [
    {
      icon: "waving_hand",
      color: "indigo",
      tag: "Step 1 of 7",
      title: "Welcome to GitScope",
      body: "GitScope is your GitHub intelligence platform — health scores, AI security scans, PR reviews, contributor analytics, and team notifications. This quick tour shows you exactly how to get the most out of it.",
      hint: null,
      cta: "Let's go →",
    },
    {
      icon: "search",
      color: "blue",
      tag: "Step 2 of 7",
      title: "Search any repository",
      body: "Type any public GitHub repo into the search bar at the top (e.g. vercel/next.js or microsoft/vscode). You'll instantly get stars, forks, language breakdown, top contributors, commit activity, and recent issues.",
      hint: "💡 Tip: Press Ctrl+K (or ⌘K) anywhere to open the command palette and jump to Search.",
      cta: "Next →",
    },
    {
      icon: "compare_arrows",
      color: "cyan",
      tag: "Step 3 of 7",
      title: "Compare repositories",
      body: "Head to Compare in the sidebar to put two or three repos side by side. See health scores, star velocity, issue response times, and contributor counts on a single screen — great for evaluating libraries or competitors.",
      hint: "💡 Tip: Use Compare before adopting a new dependency to check its activity and quality.",
      cta: "Next →",
    },
    {
      icon: "psychology",
      color: "violet",
      tag: "Step 4 of 7",
      title: "Code Lens: AI-powered scans",
      body: "Code Lens (Intelligence Hub in the sidebar) is where the real power is. Paste any repo name and run a full scan — it checks for security vulnerabilities, code quality issues, outdated patterns, and gives an overall health score from 0–100. You also get AI-generated PR descriptions, README files, and changelogs.",
      hint: "💡 Tip: Save scan findings as Action Items to track them over time.",
      cta: "Next →",
    },
    {
      icon: "trending_up",
      color: "emerald",
      tag: "Step 5 of 7",
      title: "Stack Trending & Leaderboard",
      body: "Stack Trending shows what's gaining stars in your tech stack right now — filter by language to see what's hot in TypeScript, Python, Rust, or any other ecosystem. The Contributor Leaderboard shows the most active engineers on any repo.",
      hint: "💡 Tip: Your language filter is remembered — set it once and it persists.",
      cta: "Next →",
    },
    {
      icon: "notifications_active",
      color: "amber",
      tag: "Step 6 of 7",
      title: "Alerts & Weekly Digest",
      body: "Connect Slack or Discord in Settings → Integrations to get scan alerts whenever a repo's health drops. Enable the Weekly Digest to get a Monday morning summary of your entire fleet's health, top repos, and at-risk projects.",
      hint: "💡 Tip: Set up scheduled scans so your repos are automatically re-scanned daily, weekly, or monthly.",
      cta: "Next →",
    },
    {
      icon: "rocket_launch",
      color: "rose",
      tag: "Step 7 of 7",
      title: "You're ready to go",
      body: "Start by searching a repo you care about, or paste one into Code Lens for a full AI scan. Your Action Items, scan history, and bookmarks are all saved to your account across sessions.",
      hint: "💡 Tip: Press ? at any time to see all keyboard shortcuts.",
      cta: "Start using GitScope",
    },
  ] as const;

  const COLOR_MAP = {
    indigo: { bg: "bg-indigo-500/10", border: "border-indigo-500/20", icon: "text-indigo-400", dot: "bg-indigo-500", btn: "bg-indigo-500 hover:bg-indigo-600" },
    blue:   { bg: "bg-blue-500/10",   border: "border-blue-500/20",   icon: "text-blue-400",   dot: "bg-blue-500",   btn: "bg-blue-500 hover:bg-blue-600" },
    cyan:   { bg: "bg-cyan-500/10",   border: "border-cyan-500/20",   icon: "text-cyan-400",   dot: "bg-cyan-500",   btn: "bg-cyan-500 hover:bg-cyan-600" },
    violet: { bg: "bg-violet-500/10", border: "border-violet-500/20", icon: "text-violet-400", dot: "bg-violet-500", btn: "bg-violet-500 hover:bg-violet-600" },
    emerald:{ bg: "bg-emerald-500/10",border: "border-emerald-500/20",icon: "text-emerald-400",dot: "bg-emerald-500",btn: "bg-emerald-500 hover:bg-emerald-600" },
    amber:  { bg: "bg-amber-500/10",  border: "border-amber-500/20",  icon: "text-amber-400",  dot: "bg-amber-500",  btn: "bg-amber-500 hover:bg-amber-600" },
    rose:   { bg: "bg-rose-500/10",   border: "border-rose-500/20",   icon: "text-rose-400",   dot: "bg-rose-500",   btn: "bg-rose-500 hover:bg-rose-600" },
  } as const;

  const step = ONBOARDING_STEPS[onboardingStep];
  const colors = COLOR_MAP[step?.color ?? "indigo"];

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <GitScopeCommandPalette />
      <ShortcutsModal />

      {/* First-run onboarding modal */}
      {showOnboarding && mounted && step && (
        <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-md rounded-2xl border border-outline-variant/20 bg-surface-container p-8 shadow-2xl">
            <button
              type="button"
              onClick={dismissOnboarding}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <MaterialIcon name="close" size={18} />
            </button>

            {/* Step progress dots */}
            <div className="flex gap-1.5 mb-5">
              {ONBOARDING_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === onboardingStep
                      ? `w-6 ${colors.dot}`
                      : i < onboardingStep
                        ? `w-1.5 ${colors.dot} opacity-40`
                        : "w-1.5 bg-outline-variant/40"
                  )}
                />
              ))}
            </div>

            {/* Step tag badge */}
            <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-widest mb-4", colors.bg, colors.icon)}>
              {step.tag}
            </span>

            {/* Icon */}
            <div className={cn("flex size-12 items-center justify-center rounded-2xl border mb-4", colors.bg, colors.border)}>
              <MaterialIcon name={step.icon} size={24} className={colors.icon} />
            </div>

            <h2 className="font-heading text-xl font-bold text-foreground mb-2">{step.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">{step.body}</p>

            {/* Tip block */}
            {step.hint && (
              <div className={cn("rounded-xl border px-4 py-3 mb-5 text-[11px] text-muted-foreground leading-relaxed", colors.bg, colors.border)}>
                {step.hint}
              </div>
            )}

            {!step.hint && <div className="mb-4" />}

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={dismissOnboarding}
                className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip tour
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onboardingStep < ONBOARDING_STEPS.length - 1) {
                    setOnboardingStep(onboardingStep + 1);
                  } else {
                    dismissOnboarding();
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-mono text-[11px] font-black uppercase tracking-widest text-white transition-colors",
                  colors.btn
                )}
              >
                {step.cta}
                {onboardingStep < ONBOARDING_STEPS.length - 1 && <MaterialIcon name="arrow_forward" size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}
      <TopNav
        title={title}
        session={session}
        onMenuClick={() => setMobileOpen(true)}
        searchInputRef={searchInputRef}
      />
      <RateLimitBanner />

      <div className="relative flex min-h-0 flex-1">
        {/* Desktop sidebar — fixed under header (top-16) — client only to prevent hydration mismatch */}
        {mounted && (
          <aside
            className={cn(
              "border-sidebar-border bg-sidebar text-sidebar-foreground fixed top-16 left-0 z-30 hidden h-[calc(100vh-4rem)] flex-col border-r transition-all duration-300 md:flex",
              isCollapsed ? "w-20" : "w-64"
            )}
            suppressHydrationWarning
          >
            <AppSidebar 
              isCollapsed={isCollapsed} 
              onToggleCollapse={() => setIsCollapsed(!isCollapsed)} 
            />
          </aside>
        )}

        {mobileOpen && (
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent
              side="left"
              className="border-sidebar-border bg-sidebar w-[280px] border-r p-0 [&[data-state='closed']]:hidden"
            >
              <div className="flex h-full flex-col pt-12">
                <AppSidebar 
                  key={`mobile-${Date.now()}`}
                  onNavigate={() => setMobileOpen(false)} 
                />
              </div>
            </SheetContent>
          </Sheet>
        )}

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col transition-all duration-300",
            isCollapsed ? "md:pl-20" : "md:pl-64"
          )}
        >
          <main className="flex-1 px-4 pt-6 pb-20 md:px-8 md:pb-12 md:pt-8">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile bottom nav — Stitch reference */}
      <nav className="border-sidebar-border bg-background fixed right-0 bottom-0 left-0 z-40 flex h-16 items-center justify-around border-t px-2 md:hidden">
        <Link
          href="/"
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 p-2 text-[10px]",
            pathname === "/" ? "text-indigo-400" : "text-slate-500"
          )}
        >
          <MaterialIcon name="dashboard" className="!text-[22px]" />
          Home
        </Link>
        <Link
          href={ROUTES.search}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 p-2 text-[10px]",
            pathname.startsWith("/search") ? "text-indigo-400" : "text-slate-500"
          )}
        >
          <MaterialIcon name="analytics" className="!text-[22px]" />
          Search
        </Link>
        <Link
          href={ROUTES.compare}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 p-2 text-[10px]",
            pathname.startsWith("/compare") ? "text-indigo-400" : "text-slate-500"
          )}
        >
          <MaterialIcon name="compare_arrows" className="!text-[22px]" />
          Compare
        </Link>
        <Link
          href={ROUTES.settings}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 p-2 text-[10px]",
            pathname.startsWith("/settings") ? "text-indigo-400" : "text-slate-500"
          )}
        >
          <MaterialIcon name="settings" className="!text-[22px]" />
          Config
        </Link>
      </nav>
    </div>
  );
}
