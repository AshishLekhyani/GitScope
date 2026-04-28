"use client";

/**
 * Usage Limit Toast
 * Shown in the bottom-right corner when any AI feature hits its usage cap.
 * Triggered via a browser CustomEvent — works from any component without prop drilling.
 *
 * To trigger from any component:
 *   window.dispatchEvent(new CustomEvent("gitscope:usage-limit", {
 *     detail: { feature: "Repo Analysis", resetInMinutes: 60 }
 *   }))
 */

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

interface ToastState {
  id: number;
  feature: string;
  resetInMinutes?: number;
}

export function UsageLimitToast() {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { feature = "AI feature", resetInMinutes } = (e as CustomEvent<{ feature?: string; resetInMinutes?: number }>).detail ?? {};
      const id = Date.now();
      setToasts((prev) => [...prev.slice(-2), { id, feature, resetInMinutes }]);
      setTimeout(() => dismiss(id), 9000);
    };

    window.addEventListener("gitscope:usage-limit", handler);
    return () => window.removeEventListener("gitscope:usage-limit", handler);
  }, [dismiss]);

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 60, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="pointer-events-auto w-80 rounded-none border border-amber-500/30 bg-surface-container shadow-2xl shadow-amber-500/10 backdrop-blur-sm"
          >
            {/* Accent bar */}
            <div className="h-0.5 w-full bg-linear-to-r from-amber-500 to-orange-500" />

            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-none bg-amber-500/15 border border-amber-500/20">
                  <MaterialIcon name="speed" size={16} className="text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading text-sm font-bold text-foreground">Usage limit reached</p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    <span className="text-amber-400 font-semibold">{toast.feature}</span> daily quota exhausted.
                    {toast.resetInMinutes != null
                      ? ` Resets in ${toast.resetInMinutes < 60 ? `${toast.resetInMinutes}m` : `${Math.ceil(toast.resetInMinutes / 60)}h`}.`
                      : " Upgrade for more capacity."}
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <a
                      href="/pricing-settings"
                      className="inline-flex items-center gap-1 rounded-none bg-amber-500 px-2.5 py-1 font-mono text-[9px] font-black uppercase tracking-widest text-white hover:bg-amber-600 transition-colors"
                    >
                      <MaterialIcon name="upgrade" size={11} />
                      Upgrade
                    </a>
                    <a
                      href="/settings?tab=api-keys"
                      className="inline-flex items-center gap-1 rounded-none border border-outline-variant/20 px-2.5 py-1 font-mono text-[9px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-outline-variant/40 transition-colors"
                    >
                      <MaterialIcon name="vpn_key" size={11} />
                      Add BYOK
                    </a>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Dismiss"
                >
                  <MaterialIcon name="close" size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Call this anywhere client-side when an AI route returns a usage limit error. */
export function triggerUsageLimitToast(feature: string, resetInMinutes?: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("gitscope:usage-limit", { detail: { feature, resetInMinutes } })
  );
}
