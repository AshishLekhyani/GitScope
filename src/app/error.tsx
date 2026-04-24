"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-8">
      <div className="text-center space-y-8 max-w-md w-full">
        <div className="relative">
          <div className="absolute inset-0 bg-destructive/10 rounded-full blur-3xl scale-150" />
          <div className="relative size-24 mx-auto rounded-none bg-destructive/10 border border-destructive/20 flex items-center justify-center">
            <AlertCircle className="size-10 text-destructive/60" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-black tracking-tight">Something Went Wrong</h1>
          <p className="text-sm text-muted-foreground font-mono leading-relaxed">
            {error.message || "An unexpected error occurred. Our systems have been notified."}
          </p>
          {error.digest && (
            <p className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest">
              Error ID: {error.digest}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-none btn-gitscope-primary text-sm font-bold transition-all"
          >
            <RefreshCw className="size-4" />
            Try Again
          </button>
          <Link
            href="/overview"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-none border border-border bg-card hover:bg-muted text-sm font-bold transition-all"
          >
            <Home className="size-4" />
            Go to Overview
          </Link>
        </div>

        <div className="pt-4 border-t border-border/50">
          <p className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest">
            GitScope · Runtime Error
          </p>
        </div>
      </div>
    </div>
  );
}
