"use client";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAppDispatch } from "@/store/hooks";
import { setCommandPaletteOpen, setShortcutsOpen } from "@/store/slices/uiSlice";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { AppSidebar } from "./app-sidebar";
import { GitScopeCommandPalette } from "./gitscope-command-palette";
import { ShortcutsModal } from "./shortcuts-modal";
import { TopNav } from "./top-nav";
import { RateLimitBanner } from "./rate-limit-banner";
import { AnnouncementBanner } from "./announcement-banner";
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
  const session = propSession;
  const pathname = usePathname();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  // Resizable sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(256); // default 256px (w-64)
  const [isResizing, setIsResizing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(256);

  // Ref for search input to enable keyboard shortcut focus
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load sidebar state from localStorage on mount
  useEffect(() => {
    const savedCollapsed = localStorage.getItem("gitscope:sidebar:collapsed");
    const savedWidth = localStorage.getItem("gitscope:sidebar:width");
    if (savedCollapsed !== null) {
      setIsCollapsed(savedCollapsed === "true");
    }
    if (savedWidth !== null) {
      const parsed = parseInt(savedWidth, 10);
      if (!isNaN(parsed) && parsed >= 200 && parsed <= 400) {
        setSidebarWidth(parsed);
      }
    }
    // Check if mobile on mount and on resize
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    setMounted(true);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Save sidebar state to localStorage when it changes
  useEffect(() => {
    if (mounted) {
      localStorage.setItem("gitscope:sidebar:collapsed", String(isCollapsed));
    }
  }, [isCollapsed, mounted]);
  
  // Save sidebar width to localStorage when it changes
  useEffect(() => {
    if (mounted && !isCollapsed) {
      localStorage.setItem("gitscope:sidebar:width", String(sidebarWidth));
    }
  }, [sidebarWidth, mounted, isCollapsed]);
  
  // Handle resize interactions - instant updates
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(200, Math.min(400, resizeStartWidth.current + delta));
      // Instant update - no RAF delay
      setSidebarWidth(newWidth);
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
    };
    
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);
  
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
    setIsResizing(true);
  };

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



  return (
    <div className="bg-background flex min-h-screen flex-col">
      <GitScopeCommandPalette />
      <ShortcutsModal />

      <AnnouncementBanner />
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
            ref={sidebarRef}
            className={cn(
              "border-sidebar-border bg-sidebar text-sidebar-foreground fixed top-16 left-0 z-30 hidden h-[calc(100vh-4rem)] flex-col border-r transition-none md:flex",
              isCollapsed && "w-20"
            )}
            style={isCollapsed ? undefined : { width: `${sidebarWidth}px` }}
            suppressHydrationWarning
          >
            <AppSidebar 
              isCollapsed={isCollapsed} 
              onToggleCollapse={() => setIsCollapsed(!isCollapsed)} 
            />
            
            {/* Resize handle with visual indicator */}
            {!isCollapsed && (
              <>
                {/* Invisible wider grab area for easier targeting */}
                <div
                  className="absolute top-0 right-0 w-4 h-full cursor-col-resize z-50"
                  onMouseDown={startResize}
                  title="Drag to resize sidebar"
                >
                  {/* Visual line indicator - instant */}
                  <div 
                    className={cn(
                      "absolute right-1 top-0 h-full w-0.5",
                      isResizing 
                        ? "bg-primary" 
                        : "bg-transparent hover:bg-primary/40"
                    )}
                  />
                </div>
                {/* Active resize line - instant */}
                <div 
                  className={cn(
                    "absolute right-0 top-0 h-full w-px pointer-events-none",
                    isResizing ? "opacity-100 bg-primary" : "opacity-0"
                  )}
                />
              </>
            )}
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
          className="flex min-w-0 flex-1 flex-col"
          style={{
            // No padding on mobile (sidebar hidden), dynamic padding on desktop
            paddingLeft: isMobile ? 0 : isCollapsed ? "80px" : `${sidebarWidth}px`
          }}
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
            pathname === "/" ? "text-amber-400" : "text-stone-500"
          )}
        >
          <MaterialIcon name="dashboard" className="!text-[22px]" />
          Home
        </Link>
        <Link
          href={ROUTES.search}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 p-2 text-[10px]",
            pathname.startsWith("/search") ? "text-amber-400" : "text-stone-500"
          )}
        >
          <MaterialIcon name="analytics" className="!text-[22px]" />
          Search
        </Link>
        <Link
          href={ROUTES.compare}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 p-2 text-[10px]",
            pathname.startsWith("/compare") ? "text-amber-400" : "text-stone-500"
          )}
        >
          <MaterialIcon name="compare_arrows" className="!text-[22px]" />
          Compare
        </Link>
        <Link
          href={ROUTES.settings}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 p-2 text-[10px]",
            pathname.startsWith("/settings") ? "text-amber-400" : "text-stone-500"
          )}
        >
          <MaterialIcon name="settings" className="!text-[22px]" />
          Config
        </Link>
      </nav>
    </div>
  );
}
