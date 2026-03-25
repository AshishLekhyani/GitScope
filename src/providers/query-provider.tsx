"use client";

import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState, useEffect } from "react";

// Extend React Query's focus detection to include bfcache restoration.
// The default listener only watches "focus", which does NOT fire when the
// browser restores a page from the back/forward cache. "pageshow" with
// event.persisted === true is the correct bfcache signal.
// Guard with typeof window to avoid SSR errors — Next.js evaluates module-level
// code on the server even in "use client" files.
if (typeof window !== "undefined") {
  focusManager.setEventListener((handleFocus) => {
    const onFocus = () => handleFocus(true);
    const onBlur = () => handleFocus(false);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) handleFocus(true);
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pageshow", onPageShow);
    };
  });
}

const ReactQueryDevtools = dynamic(
  () =>
    import("@tanstack/react-query-devtools").then(
      (mod) => mod.ReactQueryDevtools
    ),
  { ssr: false }
);

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
            // Enabled so React Query refetches stale queries on bfcache restore
            // (the focusManager above fires handleFocus on "pageshow" persisted).
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      })
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <QueryClientProvider client={client}>
      {children}
      {mounted && process.env.NODE_ENV !== "production" ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </QueryClientProvider>
  );
}
