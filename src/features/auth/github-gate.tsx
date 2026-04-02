"use client";

import { motion, AnimatePresence } from "framer-motion";
import { signIn, useSession } from "next-auth/react";
import { useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

/** Tier of the currently logged-in user */
export type AuthTier = "none" | "credentials" | "google" | "github";

export function getAuthTier(provider?: string | null): AuthTier {
  if (!provider) return "none";
  if (provider === "github") return "github";
  if (provider === "google") return "google";
  return "credentials";
}

export function useTier(): AuthTier {
  const { data: session } = useSession();
  // If provider isn't recorded but accessToken is present, treat as GitHub (pre-tracking JWT edge case)
  const provider = session?.provider ?? (!session?.provider && session?.accessToken ? "github" : undefined);
  return getAuthTier(provider);
}

/**
 * Feature access matrix.
 * "none" = not logged in
 * "credentials" = email/password
 * "google" = Google OAuth
 * "github" = GitHub OAuth (most features)
 */
export const FEATURE_TIERS: Record<string, { minTier: AuthTier; label: string }> = {
  "intelligence-hub":      { minTier: "credentials", label: "Intelligence Hub" },
  "pr-risk":               { minTier: "credentials", label: "PR Risk Predictor" },
  "dependency-radar":      { minTier: "credentials", label: "Dependency Radar" },
  "velocity-chart":        { minTier: "credentials", label: "Velocity Chart" },
  "activity-feed":         { minTier: "github", label: "Live Activity Feed" },
  "notifications":         { minTier: "github", label: "GitHub Notifications" },
  "releases":              { minTier: "credentials", label: "Release Tracker" },
  "leaderboard":           { minTier: "credentials", label: "Contributor Leaderboard" },
  "languages":             { minTier: "credentials", label: "Language Analytics" },
  "topics":                { minTier: "credentials", label: "Topic Explorer" },
  "bookmarks":             { minTier: "credentials", label: "Bookmarks" },
  "compare":               { minTier: "credentials", label: "Repo Comparison" },
  "organizations":         { minTier: "google", label: "Organization Pulse" },
  "api-token-settings":    { minTier: "google", label: "API Token Management" },
};

const TIER_ORDER: AuthTier[] = ["none", "credentials", "google", "github"];

export function hasAccess(userTier: AuthTier, requiredTier: AuthTier): boolean {
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(requiredTier);
}

const UPGRADE_MESSAGES: Record<AuthTier, { title: string; body: string; cta: string; provider?: string }> = {
  "none": {
    title: "Sign in to continue",
    body: "Create a free account or log in to use this feature.",
    cta: "Sign In",
  },
  "credentials": {
    title: "Upgrade your account",
    body: "This feature requires a Google or GitHub account. Link one in Settings → Account.",
    cta: "Connect Google",
    provider: "google",
  },
  "google": {
    title: "Connect GitHub to unlock",
    body: "This feature uses the GitHub API with your personal token. Connect GitHub to continue — your rate limit stays personal to you.",
    cta: "Connect GitHub",
    provider: "github",
  },
  "github": {
    title: "Already connected",
    body: "You have full access.",
    cta: "",
  },
};

interface GitHubGateProps {
  feature: keyof typeof FEATURE_TIERS;
  children: React.ReactNode;
  /** Show as inline blocked state instead of modal */
  inline?: boolean;
  className?: string;
}

/** Wraps children and shows a gate if the user doesn't have access */
export function GitHubGate({ feature, children, inline = false, className }: GitHubGateProps) {
  const tier = useTier();
  const required = FEATURE_TIERS[feature]?.minTier ?? "credentials";
  const allowed = hasAccess(tier, required);
  const [showModal, setShowModal] = useState(false);

  if (allowed) return <>{children}</>;

  const msg = UPGRADE_MESSAGES[tier];

  if (inline) {
    return (
      <div className={cn("relative rounded-2xl overflow-hidden", className)}>
        {/* Blurred preview */}
        <div className="pointer-events-none select-none blur-sm opacity-40 saturate-0">
          {children}
        </div>
        {/* Overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface-container/80 backdrop-blur-sm rounded-2xl border border-outline-variant/20 p-6 text-center">
          <div className="size-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <MaterialIcon name={required === "github" ? "hub" : "lock"} size={24} className="text-indigo-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-foreground">{msg.title}</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">{msg.body}</p>
          </div>
          {msg.provider && (
            <button
              type="button"
              onClick={() => signIn(msg.provider!)}
              className="rounded-xl bg-indigo-500 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-600 transition-colors"
            >
              {msg.cta}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div onClick={() => setShowModal(true)} className={cn("cursor-pointer", className)}>
        {children}
      </div>
      <AnimatePresence>
        {showModal && (
          <GateModal
            msg={msg}
            featureLabel={FEATURE_TIERS[feature]?.label ?? feature}
            required={required}
            onClose={() => setShowModal(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function GateModal({ msg, featureLabel, required, onClose }: {
  msg: typeof UPGRADE_MESSAGES[AuthTier];
  featureLabel: string;
  required: AuthTier;
  onClose: () => void;
}) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="fixed left-1/2 top-1/2 z-[301] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 px-4"
      >
        <div className="rounded-3xl border border-outline-variant/20 bg-surface-container/95 shadow-2xl backdrop-blur-xl overflow-hidden">
          {/* Header */}
          <div className="relative bg-gradient-to-br from-indigo-500/10 to-purple-500/5 px-6 pt-8 pb-6 text-center border-b border-outline-variant/10">
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-accent transition-colors"
            >
              <MaterialIcon name="close" size={18} />
            </button>
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-indigo-500/15 border border-indigo-500/20">
              <MaterialIcon name={required === "github" ? "hub" : required === "google" ? "person" : "lock"} size={28} className="text-indigo-400" />
            </div>
            <h2 className="text-lg font-bold tracking-tight">{msg.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground/60 uppercase tracking-widest font-mono">
              {featureLabel} requires {required === "github" ? "GitHub" : required === "google" ? "Google" : "an account"}
            </p>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">{msg.body}</p>

            {/* Tier comparison */}
            <div className="rounded-xl border border-outline-variant/10 overflow-hidden">
              {[
                { tier: "credentials" as AuthTier, label: "Email / Password", features: ["Search repos", "Compare repos", "Trending", "Bookmarks"] },
                { tier: "google" as AuthTier, label: "Google Account", features: ["Everything above", "Organization Pulse", "API Token settings"] },
                { tier: "github" as AuthTier, label: "GitHub Account", features: ["Everything above", "Intelligence Hub", "Activity Feed", "Notifications", "AI Risk Scoring", "Dependency Radar"] },
              ].map((row) => (
                <div
                  key={row.tier}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 border-b border-outline-variant/10 last:border-0",
                    row.tier === required && "bg-indigo-500/5"
                  )}
                >
                  <div className={cn(
                    "mt-0.5 size-5 rounded-full border flex items-center justify-center shrink-0",
                    hasAccess(required, row.tier) ? "border-indigo-500/30 bg-indigo-500/10" : "border-outline-variant/20 bg-surface-container"
                  )}>
                    {hasAccess(required, row.tier) && (
                      <MaterialIcon name="check" size={12} className="text-indigo-400" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-foreground flex items-center gap-2">
                      {row.label}
                      {row.tier === required && (
                        <span className="text-[9px] font-black text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider">Required</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{row.features.slice(0, 3).join(" · ")}</div>
                  </div>
                </div>
              ))}
            </div>

            {msg.provider && (
              <button
                type="button"
                onClick={() => { signIn(msg.provider!); onClose(); }}
                className="w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-600 transition-colors flex items-center justify-center gap-2"
              >
                <MaterialIcon name={msg.provider === "github" ? "hub" : "person"} size={18} />
                {msg.cta}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-outline-variant/20 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
