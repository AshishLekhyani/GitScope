"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import Link from "next/link";

const STORAGE_KEY = "gitscope_tour_completed";

type TourStep = {
  id: string;
  icon: string;
  color: string;
  bg: string;
  title: string;
  body: string | ReactNode;
  cta: string;
  skip: boolean;
  action?: { label: string; href: string };
};

const STEPS: TourStep[] = [
  {
    id: "welcome",
    icon: "rocket_launch",
    color: "text-indigo-400",
    bg: "bg-indigo-500/10 border-indigo-500/20",
    title: "Welcome to GitScope!",
    body: "GitScope is your engineering intelligence dashboard. Analyze public GitHub repositories, compare projects, track activity, and get AI-powered insights.",
    cta: "Start Tour",
    skip: true,
  },
  {
    id: "search",
    icon: "travel_explore",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    title: "Search and Analyze Repos",
    body: "Use the top search bar (or press /), type owner/repo like vercel/next.js, and press Enter. You get stars, commit history, contributors, code structure, and more.",
    cta: "Got it",
    skip: false,
    action: { label: "Try Search", href: "/search" },
  },
  {
    id: "intelligence",
    icon: "psychology",
    color: "text-purple-400",
    bg: "bg-purple-500/10 border-purple-500/20",
    title: "Use Intelligence Hub",
    body: "Intelligence Hub gives AI-driven analysis for code health, PR risk, dependency mapping, and repository momentum.",
    cta: "Got it",
    skip: false,
    action: { label: "Open Hub", href: "/intelligence" },
  },
  {
    id: "github-token",
    icon: "vpn_key",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    title: "Add Your GitHub Token",
    body: (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">If you use email/password login, add your own GitHub token to increase API limits.</p>
        <ol className="list-decimal pl-4 space-y-1 text-xs text-muted-foreground">
          <li>Open Settings - Account.</li>
          <li>Create a Personal Access Token in GitHub settings.</li>
          <li>Paste it into Personal GitHub Token and click Save.</li>
          <li>Confirm status shows Token active - 5,000 req/hr.</li>
        </ol>
        <a
          href="https://github.com/settings/tokens"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Open GitHub Token Settings
          <MaterialIcon name="open_in_new" size={12} />
        </a>
      </div>
    ),
    cta: "Got it",
    skip: false,
    action: { label: "Open Account Settings", href: "/settings?tab=account" },
  },
  {
    id: "shortcuts",
    icon: "keyboard",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    title: "Power User Shortcuts",
    body: (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Navigate quickly with keyboard:</p>
        <div className="grid grid-cols-2 gap-2 mt-3">
          {[
            ["Cmd+K / Ctrl+K", "Command palette"],
            ["/", "Focus search"],
            ["T", "Toggle theme"],
            ["F", "Fullscreen"],
            ["G -> O", "Go to Overview"],
            ["G -> E", "Go to Explore"],
          ].map(([key, desc]) => (
            <div key={key} className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-surface-container border border-outline-variant/20 font-mono text-[10px] text-foreground shrink-0">
                {key}
              </kbd>
              <span className="text-[11px] text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    cta: "Finish Tour",
    skip: false,
  },
];

interface OnboardingTourProps {
  userKey: string;
}

export function OnboardingTour({ userKey }: OnboardingTourProps) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!userKey) return;

    try {
      const done = localStorage.getItem(`${STORAGE_KEY}:${userKey}`);
      if (!done) setVisible(true);
    } catch {
      // localStorage may be blocked
    }
  }, [userKey]);

  const complete = () => {
    try {
      localStorage.setItem(`${STORAGE_KEY}:${userKey}`, "1");
    } catch {
      // ignore storage failures
    }
    setVisible(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else complete();
  };

  const current = STEPS[step];

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
            onClick={complete}
          />

          <motion.div
            key="card"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="fixed bottom-6 left-1/2 z-[201] w-full max-w-md -translate-x-1/2 px-4 sm:px-0"
          >
            <div className="overflow-hidden rounded-3xl border border-outline-variant/20 bg-surface-container/95 shadow-2xl backdrop-blur-xl">
              <div className="h-0.5 w-full bg-outline-variant/10">
                <motion.div
                  className="h-full bg-indigo-500"
                  animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
                  transition={{ ease: "easeOut" }}
                />
              </div>

              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-1.5">
                    {STEPS.map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "rounded-full transition-all",
                          i === step ? "w-4 h-1.5 bg-indigo-500" : i < step ? "size-1.5 bg-indigo-500/40" : "size-1.5 bg-outline-variant/20"
                        )}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground/50">
                    {step + 1} / {STEPS.length}
                  </span>
                </div>

                <div className={cn("inline-flex size-12 items-center justify-center rounded-2xl border mb-4", current.bg)}>
                  <MaterialIcon name={current.icon} size={24} className={current.color} />
                </div>

                <h3 className="text-lg font-bold tracking-tight mb-2">{current.title}</h3>
                {typeof current.body === "string" ? (
                  <p className="text-sm text-muted-foreground leading-relaxed">{current.body}</p>
                ) : (
                  current.body
                )}

                <div className="flex items-center gap-3 mt-6">
                  <button
                    type="button"
                    onClick={next}
                    className="flex-1 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-600 transition-colors"
                  >
                    {current.cta}
                  </button>
                  {current.action && (
                    <Link
                      href={current.action.href}
                      onClick={next}
                      className="flex items-center gap-1.5 rounded-xl border border-outline-variant/20 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-outline-variant/40 transition-colors whitespace-nowrap"
                    >
                      {current.action.label}
                      <MaterialIcon name="arrow_forward" size={14} />
                    </Link>
                  )}
                  {current.skip && (
                    <button
                      type="button"
                      onClick={complete}
                      className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors px-2"
                    >
                      Skip
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
