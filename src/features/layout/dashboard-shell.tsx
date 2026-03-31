"use client";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAppDispatch } from "@/store/hooks";
import { setCommandPaletteOpen, setShortcutsOpen } from "@/store/slices/uiSlice";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { AppSidebar } from "./app-sidebar";
import { GitScopeCommandPalette } from "./gitscope-command-palette";
import { ShortcutsModal } from "./shortcuts-modal";
import { TopNav } from "./top-nav";
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
        const searchInput = document.querySelector('input[aria-label="Global repository search"]') as HTMLInputElement;
        searchInput?.focus();
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
      <TopNav
        title={title}
        session={session}
        onMenuClick={() => setMobileOpen(true)}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* Desktop sidebar — fixed under header (top-16) */}
        <aside
          className={cn(
            "border-sidebar-border bg-sidebar text-sidebar-foreground fixed top-16 left-0 z-30 hidden h-[calc(100vh-4rem)] flex-col border-r transition-all duration-300 md:flex",
            isCollapsed ? "w-20" : "w-64"
          )}
        >
          <AppSidebar 
            isCollapsed={isCollapsed} 
            onToggleCollapse={() => setIsCollapsed(!isCollapsed)} 
          />
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="border-sidebar-border bg-sidebar w-[280px] border-r p-0"
          >
            <div className="flex h-full flex-col pt-12">
              <AppSidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col transition-all duration-300",
            isCollapsed ? "md:pl-20" : "md:pl-64"
          )}
        >
          {/* Keyed main content forces a fresh render on every internal navigation,
              solving the 'frozen' layout children issue mentioned in Next.js research. */}
          <main key={pathname} className="flex-1 px-4 pt-6 pb-20 md:px-8 md:pb-12 md:pt-8">
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
