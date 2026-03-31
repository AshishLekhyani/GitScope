"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { Session } from "next-auth";

export interface AuthProviderProps {
  children: React.ReactNode;
  session: Session | null;
}

export function AuthProvider({ children, session }: AuthProviderProps) {
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      // If the browser restored the page natively from BFCache (instead of network)
      if (event.persisted) {
        // Dispatch a synthetic resize event to ensure layout-dependent components
        // (recharts ResponsiveContainer, Monaco, etc.) recalculate their dimensions.
        // Doing this instead of router.refresh() perfectly protects React Server Components 
        // from entering Suspense boundaries and cracking the UI layout.
        window.dispatchEvent(new Event("resize"));
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  return (
    <SessionProvider 
      session={session}
      // Force refetchOnWindowFocus to false. 
      // NextAuth v4's background refresh triggers a router.refresh() 
      // that crashes Next.js 15+ during initial hydration/ Turbopack load.
      refetchOnWindowFocus={false}
    >
      {children}
    </SessionProvider>
  );
}
