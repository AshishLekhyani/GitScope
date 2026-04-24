"use client";

import { useEffect } from "react";

const PROTECTED_PREFIXES = [
  "/overview",
  "/activity",
  "/organizations",
  "/settings",
  "/pricing-settings",
  "/dashboard",
  "/intelligence",
  "/compare",
  "/trending",
  "/search",
  "/docs-reference",
  "/notifications",
  "/bookmarks",
  "/releases",
  "/leaderboard",
  "/languages",
  "/topics",
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function NavigationGuard() {
  useEffect(() => {
    let checking = false;

    const verifyAccess = async () => {
      if (checking) return;
      const pathname = window.location.pathname;
      const onLogin = pathname === "/login";
      const needsAuth = isProtectedPath(pathname);
      if (!onLogin && !needsAuth) return;

      checking = true;
      try {
        const res = await fetch("/api/auth/session", {
          cache: "no-store",
          headers: { "x-gitscope-guard": Date.now().toString() },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { user?: unknown } | null;
        const isAuthed = Boolean(data?.user);

        if (needsAuth && !isAuthed) {
          window.location.replace(
            `/login?from=${encodeURIComponent(
              `${window.location.pathname}${window.location.search}`
            )}`
          );
          return;
        }

        if (onLogin && isAuthed) {
          window.location.replace("/overview");
        }
      } catch {
        // Silent fallback; route guards on server/proxy still apply.
      } finally {
        checking = false;
      }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
        return;
      }
      // Always verify auth on any pageshow — bfcache restores included.
      // If the user logged out on another tab/device, this redirects them.
      void verifyAccess();
    };

    const handlePopState = () => {
      void verifyAccess();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void verifyAccess();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("popstate", handlePopState);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void verifyAccess();
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
