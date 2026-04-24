"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw, LayoutDashboard } from "lucide-react";
import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DashboardError]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-foreground p-8">
      <div className="text-center space-y-6 max-w-md w-full">
        <div className="size-20 mx-auto rounded-none bg-destructive/10 border border-destructive/20 flex items-center justify-center">
          <AlertCircle className="size-9 text-destructive/70" />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-black tracking-tight">Dashboard Error</h2>
          <p className="text-sm text-muted-foreground font-mono leading-relaxed">
            {error.message || "Failed to load this section. The rest of your workspace is unaffected."}
          </p>
          {error.digest && (
            <p className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest">
              Ref: {error.digest}
            </p>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-none btn-gitscope-primary text-sm font-bold"
          >
            <RefreshCw className="size-4" />
            Retry
          </button>
          <Link
            href="/overview"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-none border border-border bg-card hover:bg-muted text-sm font-bold transition-all"
          >
            <LayoutDashboard className="size-4" />
            Overview
          </Link>
        </div>
      </div>
    </div>
  );
}
