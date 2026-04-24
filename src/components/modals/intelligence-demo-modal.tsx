"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MaterialIcon } from "@/components/material-icon";
import { motion, AnimatePresence } from "framer-motion";

const SESSION_KEY = "intelligence-demo-modal-shown";
const STORAGE_KEY = "intelligence-page-state";

interface PageState {
  selectedRepos: string[];
  activeTab: "radar" | "velocity" | "risk";
}

interface DemoModalProps {
  onStateRestore?: (state: PageState) => void;
  onStateSave?: (state: PageState) => void;
}

export function IntelligenceDemoModal({ onStateRestore, onStateSave }: DemoModalProps) {
  const [open, setOpen] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  useEffect(() => {
    const hasShown = sessionStorage.getItem(SESSION_KEY);
    if (!hasShown) {
      const timer = setTimeout(() => {
        setOpen(true);
        sessionStorage.setItem(SESSION_KEY, "true");
      }, 800);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && onStateRestore) {
        const state: PageState = JSON.parse(saved);
        onStateRestore(state);
      }
    } catch {}
  }, [onStateRestore]);

  const handleDismiss = () => {
    setIsDismissing(true);
    setTimeout(() => {
      setOpen(false);
      setIsDismissing(false);
    }, 1200);
  };

  const saveState = useCallback((state: PageState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (onStateSave) onStateSave(state);
    } catch {}
  }, [onStateSave]);

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen && !isDismissing) handleDismiss();
      else if (!isDismissing) setOpen(newOpen);
    }}>
      <DialogContent 
        className={"fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] sm:max-w-[500px] p-0 overflow-hidden border border-amber-500/20 bg-surface-container/95 backdrop-blur-xl max-h-[90vh] overflow-y-auto"}
        style={{ pointerEvents: isDismissing ? "none" : "auto", margin: 0 }}
      >
        <AnimatePresence mode={"wait"}>
          {!isDismissing ? (
            <motion.div
              key={"content"}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, filter: "blur(8px)" }}
              transition={{ duration: 1 }}
              className={"p-4 sm:p-6 relative"}
            >
              <div className={"absolute inset-0 bg-linear-to-br from-amber-500/5 via-transparent to-orange-500/5 pointer-events-none"} />
              
              <DialogHeader className={"relative"}>
                <div className={"flex items-center gap-3 sm:gap-4 mb-4"}>
                  <div className={"size-12 sm:size-14 rounded-none bg-linear-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center border border-amber-500/30 shrink-0"}>
                    <MaterialIcon name={"warning"} className={"text-amber-500"} size={24} />
                  </div>
                  <div className={"min-w-0"}>
                    <DialogTitle className={"text-lg sm:text-xl font-bold tracking-tight text-foreground font-heading"}>
                      Demo Mode Active
                    </DialogTitle>
                    <DialogDescription className={"text-muted-foreground text-xs sm:text-sm"}>
                      AI features are simulated for demonstration
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className={"space-y-3 sm:space-y-4 relative"}>
                <div className={"rounded-none border border-amber-500/10 bg-amber-500/5 p-3 sm:p-4"}>
                  <p className={"text-xs sm:text-sm text-muted-foreground leading-relaxed"}>
                    <span className={"text-amber-500 font-semibold"}>Heads up:</span>{" "}
                    The AI-powered features in this hub are currently running on 
                    <span className={"font-semibold text-foreground"}> pre-written logic and demo data</span>. 
                    No real API keys are being used — this is purely a preview of what&apos;s possible.
                  </p>
                </div>

                <div className={"flex items-start gap-3 text-xs text-muted-foreground"}>
                  <MaterialIcon name={"info"} size={16} className={"text-primary mt-0.5 shrink-0"} />
                  <p>
                    All intelligence metrics, predictions, and analysis shown are 
                    simulated responses designed to demonstrate the UI/UX.
                  </p>
                </div>

                <div className={"flex items-center gap-2 text-xs text-muted-foreground/60"}>
                  <span className={"size-1.5 rounded-full bg-emerald-500 animate-pulse"} />
                  <span>Your workspace state will be remembered when you return</span>
                </div>
              </div>

              <div className={"mt-4 sm:mt-6 flex justify-end"}>
                <Button 
                  onClick={handleDismiss}
                  className={"bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-semibold px-4 sm:px-6 transition-all active:scale-[0.98] shadow-lg shadow-amber-500/20 w-full sm:w-auto"}
                >
                  <MaterialIcon name={"auto_fix_high"} size={18} className={"mr-2"} />
                  I Understand
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={"dismiss"}
              initial={{ opacity: 0.5 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 1 }}
              className={"h-[320px] flex items-center justify-center"}
            >
              <p className={"text-sm text-amber-500/40"}>Fading to dust...</p>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

export function useIntelligenceState() {
  const saveState = useCallback((state: PageState) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, []);

  const loadState = useCallback((): PageState | null => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  }, []);

  const clearState = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  }, []);

  return { saveState, loadState, clearState };
}
