"use client";

import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import Link from "next/link";
import { Check, Minus, Zap } from "lucide-react";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    description: "Powerful analytics and AI tooling for every developer — no credit card, no time limit.",
    color: "border-border",
    badge: null,
    cta: "Get Started Free",
    ctaHref: "/login?mode=signup",
    features: [
      "10 repos tracked",
      "7-day commit history",
      "Language & contributor breakdown",
      "Code Ownership analysis",
      "DORA metrics (basic)",
      "OSV / CVE scanner",
      "PR Review & Commit Inspector",
      "Eng Insights (PR complexity & cycle time)",
      "AI analysis — 5 LLM scans / day",
      "BYOK: all providers free (Groq, Gemini, Cerebras, Anthropic, OpenAI…)",
      "Private repos unlocked via BYOK",
      "Guest public repo explorer",
      "Community support",
    ],
  },
  {
    id: "developer",
    name: "Developer",
    price: 15,
    pricePPP: true,
    description: "All features unlocked. Pay for engineering power, not AI — bring your own keys for unlimited AI.",
    color: "border-amber-500/40",
    badge: "All Features",
    badgeColor: "bg-amber-500 text-white",
    cta: "Upgrade to Developer",
    ctaHref: "/login?mode=signup&plan=developer",
    features: [
      "Everything in Free, plus:",
      "Unlimited repos tracked",
      "365-day full commit history",
      "Shared workspaces & team seats",
      "20 LLM scans / day (or unlimited with BYOK)",
      "Scheduled scans & email alerts",
      "Slack & Discord notifications",
      "Weekly automated digest emails",
      "PR Queue — bulk AI review of open PRs",
      "PR Description Generator (AI-written)",
      "Test Coverage analysis (Codecov integration)",
      "Webhook automation rules",
      "Custom scan rules & thresholds",
      "SSO domain auto-join",
      "Priority support",
    ],
  },
] as const;

const COMPARE_ROWS = [
  { feature: "Repos tracked",              free: "10",         developer: "Unlimited" },
  { feature: "Commit history",             free: "7 days",     developer: "365 days" },
  { feature: "GitHub OAuth",               free: true,         developer: true },
  { feature: "Code Ownership analysis",    free: true,         developer: true },
  { feature: "DORA Metrics",               free: "Basic",      developer: "Full" },
  { feature: "Eng Insights (DORA+cycle)",  free: true,         developer: true },
  { feature: "OSV / CVE Scanner",          free: true,         developer: true },
  { feature: "PR Review & Commit Inspect", free: true,         developer: true },
  { feature: "AI agent depth",             free: "1",          developer: "12 + debate" },
  { feature: "Daily LLM scans",            free: "5",          developer: "20" },
  { feature: "BYOK (all providers)",       free: true,         developer: true },
  { feature: "BYOK unlimited scans",       free: true,         developer: true },
  { feature: "Private repos via BYOK",     free: true,         developer: true },
  { feature: "Shared workspaces",          free: false,        developer: true },
  { feature: "Scheduled scans",            free: false,        developer: true },
  { feature: "Slack / Discord notifs",     free: false,        developer: true },
  { feature: "Weekly digest emails",       free: false,        developer: true },
  { feature: "PR Queue (bulk AI review)",  free: false,        developer: true },
  { feature: "Webhook automation rules",   free: false,        developer: true },
  { feature: "Custom scan rules",          free: false,        developer: true },
  { feature: "Test Coverage (Codecov)",    free: false,        developer: true },
  { feature: "SSO domain auto-join",       free: false,        developer: true },
];

export interface PricingPageClientProps {
  variant?: "marketing" | "dashboard";
  isAuthenticated?: boolean;
}

export function PricingPageClient({ variant = "marketing", isAuthenticated: _isAuthenticated = false }: PricingPageClientProps) {
  const [showPaymentModal, setShowPaymentModal] = useState(true);
  const isDashboard = variant === "dashboard";

  return (
    <>
      {/* ── Payment notice — bottom-left sticky banner ── */}
      <AnimatePresence>
        {showPaymentModal && (
          <motion.div
            key="payment-banner"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="fixed bottom-5 left-4 z-200 w-[calc(100vw-2rem)] max-w-xs sm:left-5 sm:w-80"
          >
            <div className="overflow-hidden border border-amber-500/25 bg-[#110f0c]/95 shadow-[0_16px_48px_-8px_rgba(0,0,0,0.7)] backdrop-blur-xl">
              <div className="h-0.5 bg-linear-to-r from-amber-500 to-orange-400" />
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="size-8 bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <MaterialIcon name="payments" size={16} className="text-amber-400" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs font-black text-white leading-snug">Payments aren&apos;t live yet</p>
                      <p className="text-[10px] text-white/45 leading-relaxed">
                        To upgrade, message me on LinkedIn — I&apos;ll activate your Developer plan within 24 h.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    title="Dismiss"
                    onClick={() => setShowPaymentModal(false)}
                    className="text-white/25 hover:text-white/60 transition-colors shrink-0 mt-0.5"
                  >
                    <MaterialIcon name="close" size={14} />
                  </button>
                </div>
                <a
                  href="https://www.linkedin.com/in/ashishlekhyani"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 border border-amber-500/30 bg-amber-500/10 px-3 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em] text-amber-300 transition-colors hover:bg-amber-500/20 hover:text-amber-200"
                >
                  <MaterialIcon name="open_in_new" size={12} />
                  Message on LinkedIn
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn("mx-auto w-full", isDashboard ? "max-w-none space-y-10" : "max-w-5xl px-6 py-16 space-y-20")}
      >
        {/* Header */}
        <div className={isDashboard ? "" : "text-center space-y-4"}>
          {isDashboard ? (
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-2">
              <div>
                <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-linear-to-r from-amber-500 to-amber-500">
                  Subscription & Billing
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">Manage your plan and workspace limits.</p>
              </div>
              <div className="flex items-center gap-3 border border-amber-500/20 bg-amber-500/5 px-5 py-3">
                <div className="size-9 bg-amber-500 flex items-center justify-center text-white">
                  <MaterialIcon name="rocket_launch" size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Current Plan</p>
                  <p className="text-sm font-black text-amber-500">Free</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="inline-flex items-center gap-2 border border-amber-500/10 bg-amber-500/5 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-amber-400/70">
                <Zap className="size-3" /> Simple, Honest Pricing
              </div>
              <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground md:text-5xl">
                Pay for features, not AI.
              </h1>
              <p className="text-muted-foreground max-w-2xl mx-auto text-sm leading-relaxed">
                BYOK (Bring Your Own Key) is <strong className="text-foreground">completely free</strong> on every plan — use Groq, Gemini, Cerebras, Anthropic, OpenAI, or any other provider at no extra cost.
                Upgrade to Developer for unlimited repos, team features, and enterprise-grade workflows.
              </p>
              <p className="text-[11px] font-mono text-muted-foreground/50">
                Developer tier pricing is PPP-adjusted — $10/mo from India, $20/mo from USA.
              </p>
            </>
          )}
        </div>

        {/* Plan cards */}
        <div className="grid gap-6 sm:grid-cols-2 max-w-2xl mx-auto">
          {PLANS.map((plan, idx) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={cn(
                "relative flex flex-col border-2 bg-card p-8 transition-all hover:shadow-xl",
                plan.color,
                plan.id === "developer" && "ring-2 ring-amber-500/20 shadow-amber-500/5 shadow-xl"
              )}
            >
              {plan.badge && (
                <span className={cn("absolute -top-3 left-6 px-3 py-1 font-mono text-[9px] font-black tracking-widest uppercase shadow", plan.badgeColor)}>
                  {plan.badge}
                </span>
              )}

              <h3 className="font-heading text-xl font-black uppercase tracking-tight">{plan.name}</h3>

              <div className="mt-3 flex items-baseline gap-1">
                {plan.price === 0 ? (
                  <span className="font-heading text-4xl font-black tracking-tighter">$0</span>
                ) : (
                  <>
                    <span className="font-heading text-4xl font-black tracking-tighter">${plan.price}</span>
                    <span className="text-xs font-bold text-muted-foreground">/mo</span>
                    {"pricePPP" in plan && plan.pricePPP && (
                      <span className="ml-2 text-[9px] font-black px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">PPP</span>
                    )}
                  </>
                )}
              </div>
              {"pricePPP" in plan && plan.pricePPP && (
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">$10 – $20 based on your location</p>
              )}

              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{plan.description}</p>

              <div className="my-5 h-px bg-border/60" />

              <ul className="flex-1 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className={cn("flex items-start gap-2.5 text-xs", f.endsWith(":") && "font-black text-foreground/70 mt-3 first:mt-0")}>
                    {!f.endsWith(":") && <Check className="size-4 text-amber-500 shrink-0 mt-0.5" />}
                    <span className={f.endsWith(":") ? "text-foreground/60" : "text-muted-foreground"}>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.ctaHref}
                className={cn(
                  "mt-6 flex w-full items-center justify-center gap-2 py-2.5 text-xs font-bold uppercase tracking-widest transition-all",
                  plan.id === "developer"
                    ? "btn-gitscope-primary"
                    : "border border-border hover:bg-muted"
                )}
              >
                {plan.cta}
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Feature comparison table */}
        {!isDashboard && (
          <div className="space-y-6">
            <h2 className="font-heading text-2xl font-bold text-center">Full Feature Comparison</h2>
            <div className="overflow-x-auto border border-border">
              <table className="min-w-120 w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="py-4 px-6 text-left font-bold text-xs text-muted-foreground uppercase tracking-widest">Feature</th>
                    <th className="py-4 px-6 text-center font-black text-xs">Free</th>
                    <th className="py-4 px-6 text-center font-black text-xs text-amber-400">Developer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {COMPARE_ROWS.map((row) => (
                    <tr key={row.feature} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-6 text-xs text-foreground/80 font-medium">{row.feature}</td>
                      {(["free", "developer"] as const).map((plan) => {
                        const val = row[plan];
                        return (
                          <td key={plan} className="py-3 px-6 text-center">
                            {typeof val === "boolean" ? (
                              val
                                ? <Check className="size-4 text-amber-500 mx-auto" />
                                : <Minus className="size-4 text-muted-foreground/30 mx-auto" />
                            ) : (
                              <span className="text-xs font-bold">{val}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Dashboard billing history */}
        {isDashboard && (
          <div className="space-y-4">
            <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
              <MaterialIcon name="receipt_long" size={18} className="text-muted-foreground" />
              Billing History
            </h3>
            <div className="glass-panel flex flex-col items-center gap-4 p-8 text-center">
              <MaterialIcon name="receipt_long" size={32} className="text-muted-foreground/30" />
              <div>
                <h4 className="text-sm font-bold">No Billing History</h4>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Upgrade to Developer to unlock all enterprise features and access billing history.
                </p>
              </div>
              <Link href="/login?mode=signup&plan=developer" className="inline-flex items-center gap-2 px-5 py-2.5 btn-gitscope-primary text-xs font-bold">
                Upgrade to Developer
              </Link>
            </div>
          </div>
        )}

        {/* FAQ */}
        {!isDashboard && (
          <div className="max-w-2xl mx-auto space-y-6">
            <h2 className="font-heading text-2xl font-bold text-center">Frequently Asked Questions</h2>
            <div className="space-y-3">
              {[
                { q: "Is BYOK really free on the Free plan?", a: "Yes, completely. You can connect your own Anthropic, OpenAI, Groq, Gemini, Cerebras, Mistral, or DeepSeek API keys on any plan at no extra cost to us. You just pay your provider directly." },
                { q: "What does PPP pricing mean?", a: "Purchasing Power Parity — Developer tier pricing adjusts based on where you live. Someone from India pays around $10/mo, someone from the USA pays around $20/mo. Message me on LinkedIn to get your adjusted price." },
                { q: "Do I need a GitHub account?", a: "Not for basic browsing. Sign in with GitHub OAuth to unlock live analytics, private repos (via BYOK), org data, activity feeds, and higher API rate limits (5,000 req/hr vs. 60 unauthenticated)." },
                { q: "Is my source code stored anywhere?", a: "No. GitScope only reads GitHub metadata (commit counts, PR info, contributor lists). We never clone or store your source code. AI analysis is sent directly from your browser to your chosen AI provider." },
                { q: "What AI providers are supported?", a: "Anthropic Claude, OpenAI GPT-4o, Google Gemini, Groq (fast inference), Cerebras, Mistral, and DeepSeek — all free to configure on any plan with your own API key. GitScope's own server-side AI uses a small budget for users without keys." },
                { q: "How do I upgrade right now?", a: "Payments aren't automated yet — message me on LinkedIn and I'll manually activate your Developer plan within 24 hours. Include your GitScope account email." },
              ].map((faq) => (
                <div key={faq.q} className="border border-border p-5 transition-colors hover:bg-muted/20">
                  <h3 className="text-sm font-bold mb-2">{faq.q}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </>
  );
}
