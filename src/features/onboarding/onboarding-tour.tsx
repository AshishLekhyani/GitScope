"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "gitscope_tour_v2_completed";

type Step = {
  id: string;
  icon: string;
  accentClass: string;
  accentBg: string;
  title: string;
  body: string;
  bullets?: string[];
  primaryCta: string;
  secondaryCta?: { label: string; href: string };
};

const STEPS: Step[] = [
  {
    id: "welcome",
    icon: "rocket_launch",
    accentClass: "text-amber-400",
    accentBg: "bg-amber-500/10 border-amber-500/25",
    title: "Welcome to GitScope",
    body: "Your engineering intelligence dashboard — AI-powered repo health scans, CVE detection, PR reviews, CI/CD analytics, and team dashboards all in one place.",
    bullets: ["Analyze any public or private GitHub repo", "AI scans with Anthropic, OpenAI, or Gemini", "Team workspaces, DORA metrics & more"],
    primaryCta: "Start Tour →",
  },
  {
    id: "search",
    icon: "travel_explore",
    accentClass: "text-amber-400",
    accentBg: "bg-amber-500/10 border-amber-500/25",
    title: "Search & Analyze Any Repo",
    body: "Type owner/repo in the search bar (or press / to focus it instantly). GitScope pulls real-time data — stars, commit cadence, contributors, language mix, and more.",
    bullets: [
      "Try: vercel/next.js, facebook/react, or any repo",
      "Use @username to look up a GitHub user's profile",
      "Press Enter or click Analyze to dive in",
    ],
    primaryCta: "Next",
    secondaryCta: { label: "Open Search", href: "/search" },
  },
  {
    id: "intelligence",
    icon: "psychology",
    accentClass: "text-amber-400",
    accentBg: "bg-amber-500/10 border-amber-500/25",
    title: "Intelligence Hub",
    body: "The hub is where deep analysis lives. Switch between tabs to run AI repo scans, OSV CVE checks, PR reviews, code ownership maps, CI/CD run history, and test coverage reports.",
    bullets: [
      "Code Lens → AI Repo Scan, OSV CVE, PR Review, Test Coverage",
      "Ownership → bus factor + per-contributor commit %",
      "CI/CD → GitHub Actions pass rates and run streaks",
    ],
    primaryCta: "Next",
    secondaryCta: { label: "Open Intelligence Hub", href: "/intelligence" },
  },
  {
    id: "github",
    icon: "hub",
    accentClass: "text-emerald-400",
    accentBg: "bg-emerald-500/10 border-emerald-500/25",
    title: "Connect Your GitHub Account",
    body: "OAuth sign-in gives you 5,000 GitHub API requests/hour and unlocks private repo analysis. Alternatively, paste a Personal Access Token if you prefer email/password login.",
    bullets: [
      "Settings → Account → Connect GitHub to link OAuth",
      "Or: Settings → Account → Personal GitHub Token for a PAT",
      "PAT needs repo, read:user scopes for full access",
    ],
    primaryCta: "Next",
    secondaryCta: { label: "Go to Account Settings", href: "/settings?tab=account" },
  },
  {
    id: "byok",
    icon: "vpn_key",
    accentClass: "text-amber-400",
    accentBg: "bg-amber-500/10 border-amber-500/25",
    title: "Bring Your Own AI Keys",
    body: "On the Developer plan and above, paste your own API keys to run unlimited AI scans at zero extra cost. GitScope supports Anthropic, OpenAI, and Google Gemini.",
    bullets: [
      "Settings → Integrations → AI Provider API Keys",
      "Anthropic: claude-sonnet-4-6 — best overall quality",
      "OpenAI: gpt-4o — strong alternative",
      "Gemini: gemini-1.5-pro — fast and cost-efficient",
    ],
    primaryCta: "Next",
    secondaryCta: { label: "Add API Keys", href: "/settings?tab=integrations" },
  },
  {
    id: "notifications",
    icon: "notifications_active",
    accentClass: "text-teal-400",
    accentBg: "bg-teal-500/10 border-teal-500/25",
    title: "Slack & Discord Alerts",
    body: "Get scan results, CVE alerts, and weekly digests delivered directly to your team's Slack or Discord channel. Set up a webhook in under a minute.",
    bullets: [
      "Settings → Integrations → Slack Webhook URL",
      "Settings → Integrations → Discord Webhook URL",
      "Use the Test button to verify delivery before saving",
    ],
    primaryCta: "Next",
    secondaryCta: { label: "Set Up Integrations", href: "/settings?tab=integrations" },
  },
  {
    id: "tips",
    icon: "tips_and_updates",
    accentClass: "text-rose-400",
    accentBg: "bg-rose-500/10 border-rose-500/25",
    title: "Power Tips",
    body: "A few things that will make your GitScope experience 10× faster:",
    bullets: [
      "/ to focus search instantly from anywhere",
      "Cmd+K / Ctrl+K opens the command palette",
      "T toggles dark/light theme",
      "Embed a live health badge in any README: /api/badge?repo=owner/repo",
      "Organizations tab → Shared Workspace shows all team scan history",
    ],
    primaryCta: "Start Exploring →",
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
      if (!localStorage.getItem(`${STORAGE_KEY}:${userKey}`)) setVisible(true);
    } catch { /* localStorage blocked */ }
  }, [userKey]);

  const complete = () => {
    try { localStorage.setItem(`${STORAGE_KEY}:${userKey}`, "1"); } catch { /* ignore */ }
    setVisible(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else complete();
  };

  const cur = STEPS[step];
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop — blocks interaction, does NOT dismiss on click */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed top-0 left-0 w-screen h-screen min-h-dvh z-[9998] bg-black/85 backdrop-blur-[6px]"
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            className="fixed inset-x-4 bottom-6 z-[9999] mx-auto max-w-lg sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2"
          >
            <div className="overflow-hidden border border-white/8 bg-[#110f0c]/96 shadow-[0_32px_80px_-12px_rgba(0,0,0,0.85)] backdrop-blur-2xl">

              {/* Progress bar */}
              <div className="h-0.5 bg-white/5">
                <motion.div
                  className="h-full bg-amber-500"
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: "easeOut", duration: 0.4 }}
                />
              </div>

              <div className="p-6 space-y-5">
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {STEPS.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        title={`Go to step ${i + 1}: ${s.title}`}
                        onClick={() => setStep(i)}
                        className={cn(
                          "rounded-full transition-all duration-300",
                          i === step
                            ? "w-5 h-1.5 bg-amber-400"
                            : i < step
                            ? "size-1.5 bg-amber-400/40"
                            : "size-1.5 bg-white/10"
                        )}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-white/30">
                      {step + 1} / {STEPS.length}
                    </span>
                    <button
                      type="button"
                      onClick={complete}
                      className="text-[10px] text-white/25 hover:text-white/50 transition-colors"
                    >
                      Skip all
                    </button>
                  </div>
                </div>

                {/* Icon + Content */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={cur.id}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.22 }}
                    className="space-y-4"
                  >
                    <div className={cn("inline-flex size-12 items-center justify-center rounded-none border", cur.accentBg)}>
                      <MaterialIcon name={cur.icon} size={24} className={cur.accentClass} />
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-lg font-black tracking-tight text-white">{cur.title}</h3>
                      <p className="text-sm text-white/55 leading-relaxed">{cur.body}</p>
                    </div>

                    {cur.bullets && (
                      <ul className="space-y-1.5">
                        {cur.bullets.map((b) => (
                          <li key={b} className="flex items-start gap-2 text-[11px] text-white/45">
                            <span className={cn("mt-0.5 shrink-0", cur.accentClass)}>▸</span>
                            <span className="leading-relaxed">{b}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.div>
                </AnimatePresence>

                {/* Actions */}
                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={next}
                    className="flex-1 rounded-none bg-amber-500 hover:bg-amber-400 px-4 py-2.5 text-sm font-black text-white transition-colors"
                  >
                    {cur.primaryCta}
                  </button>
                  {cur.secondaryCta && (
                    <a
                      href={cur.secondaryCta.href}
                      onClick={next}
                      className="flex items-center gap-1.5 rounded-none border border-white/10 px-4 py-2.5 text-sm font-medium text-white/50 hover:text-white hover:border-white/20 transition-all whitespace-nowrap"
                    >
                      {cur.secondaryCta.label}
                      <MaterialIcon name="arrow_forward" size={14} />
                    </a>
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
