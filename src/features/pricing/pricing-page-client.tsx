"use client";

import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Check, Minus, Zap } from "lucide-react";

const PLANS = [
  {
    id: "free",
    name: "Explorer",
    price: 0,
    description: "For individual developers exploring open-source repositories.",
    color: "border-border",
    badge: null,
    cta: "Get Started Free",
    ctaHref: "/login?mode=signup",
    features: [
      "5 repos tracked",
      "Commit analytics (30-day history)",
      "Language & contributor breakdown",
      "AI Risk Lite (single-agent)",
      "20 AI analysis calls / hour",
      "Basic search (public GitHub limits)",
      "Trending repo discovery",
      "Guest public repo explorer",
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Professional",
    price: 12,
    description: "For power users who need deep analytics and GitHub integration.",
    color: "border-primary/40",
    badge: "Most Popular",
    badgeColor: "bg-primary text-primary-foreground",
    cta: "Start Free Trial",
    ctaHref: "/login?mode=signup&plan=pro",
    features: [
      "Unlimited repos tracked",
      "Full commit history & pagination",
      "Contributor velocity heatmaps",
      "PR merge frequency analysis",
      "Side-by-side repo comparison",
      "GitHub OAuth (5,000 req/hr)",
      "AI Risk Pro (multi-agent)",
      "Deep Code Impact (security + architecture agents)",
      "80 AI analysis calls / hour",
      "Live activity feed",
      "Organization Pulse",
      "Priority email support",
    ],
  },
  {
    id: "developer",
    name: "Developer",
    price: 19,
    description: "For developers who want unlimited AI analysis using their own API keys.",
    color: "border-emerald-500/40",
    badge: "BYOK",
    badgeColor: "bg-emerald-500 text-white",
    cta: "Start Developer Trial",
    ctaHref: "/login?mode=signup&plan=developer",
    features: [
      "Everything in Professional",
      "Unlimited AI scans (BYOK required)",
      "Bring your own Anthropic / OpenAI / Gemini key",
      "Zero AI cost to GitScope — full plan revenue",
      "Multi-branch repo scanning",
      "SBOM dependency export",
      "80 AI analysis calls / hour",
      "Priority email support",
    ],
  },
  {
    id: "team",
    name: "Team",
    price: 49,
    description: "For engineering teams that need fleet-wide analytics and DORA metrics.",
    color: "border-amber-500/40",
    badge: "Best for Teams",
    badgeColor: "bg-amber-500 text-white",
    cta: "Start Team Trial",
    ctaHref: "/login?mode=signup&plan=team",
    features: [
      "Everything in Professional",
      "Up to 10 team seats",
      "DORA metrics (cycle time, lead time)",
      "Recursive Intelligence Hub",
      "AI PR Risk Predictor (team multi-agent)",
      "Deep Code Impact (4 specialist agents)",
      "240 AI analysis calls / hour per workspace",
      "25 LLM scans / day (or unlimited with BYOK)",
      "Dependency Radar graph",
      "Shared team dashboards",
      "Weekly automated reports",
      "Webhook integrations",
      "Slack notifications",
      "Pay-as-you-go AI overage available",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: null,
    description: "Custom pricing based on your team size and usage. Talk to us and we'll build a plan that fits.",
    color: "border-amber-500/30",
    badge: "Contact Us",
    badgeColor: "bg-amber-500 text-white",
    cta: "Talk to Sales",
    ctaHref: "mailto:acnotros2@gmail.com?subject=GitScope%20Enterprise%20Enquiry",
    features: [
      "Everything in Team",
      "Unlimited seats — pay for what you use",
      "Pay-as-you-go AI usage billing",
      "50 LLM scans / day base (or unlimited BYOK)",
      "GitHub Enterprise Server support",
      "SSO / SAML authentication",
      "Custom metric definitions",
      "Custom AI agent orchestration",
      "Dedicated account manager",
      "On-premise deployment option",
      "99.9% uptime SLA",
      "Audit logs & compliance exports",
    ],
  },
] as const;

const COMPARE_ROWS = [
  { feature: "Repos tracked", explorer: "5", pro: "Unlimited", developer: "Unlimited", team: "Unlimited", enterprise: "Unlimited" },
  { feature: "Commit history", explorer: "30 days", pro: "Full", developer: "Full", team: "Full", enterprise: "Full" },
  { feature: "GitHub OAuth", explorer: false, pro: true, developer: true, team: true, enterprise: true },
  { feature: "Live activity feed", explorer: false, pro: true, developer: true, team: true, enterprise: true },
  { feature: "Organization Pulse", explorer: false, pro: true, developer: true, team: true, enterprise: true },
  { feature: "DORA Metrics", explorer: false, pro: false, developer: false, team: true, enterprise: true },
  { feature: "AI Risk Predictor", explorer: false, pro: false, developer: false, team: true, enterprise: true },
  { feature: "AI agent depth", explorer: "1", pro: "2", developer: "2", team: "4", enterprise: "Custom" },
  { feature: "AI calls / hour", explorer: "20", pro: "80", developer: "80", team: "240", enterprise: "Custom" },
  { feature: "Daily LLM scans", explorer: "Internal AI", pro: "10", developer: "Unlimited BYOK", team: "25", enterprise: "50+" },
  { feature: "BYOK (own API keys)", explorer: false, pro: true, developer: "Required", team: true, enterprise: true },
  { feature: "Pay-as-you-go billing", explorer: false, pro: false, developer: false, team: "Optional", enterprise: true },
  { feature: "Team seats", explorer: "1", pro: "1", developer: "1", team: "10", enterprise: "Unlimited" },
  { feature: "Webhook integrations", explorer: false, pro: false, developer: false, team: true, enterprise: true },
  { feature: "SSO / SAML", explorer: false, pro: false, developer: false, team: false, enterprise: true },
  { feature: "SLA", explorer: false, pro: false, developer: false, team: false, enterprise: "99.9%" },
];

export interface PricingPageClientProps {
  variant?: "marketing" | "dashboard";
  isAuthenticated?: boolean;
}

export function PricingPageClient({ variant = "marketing", isAuthenticated = false }: PricingPageClientProps) {
  const [annual, setAnnual] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(true);
  const isDashboard = variant === "dashboard";

  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const key = "gitscope_payment_notice_shown";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
      }
    } catch { /* sessionStorage blocked */ }
  }, [isAuthenticated]);

  const price = (p: typeof PLANS[number]) => {
    if (p.price === null) return "Custom";
    if (p.price === 0) return "$0";
    return `$${annual ? Math.round(p.price * 0.8) : p.price}`;
  };

  // Enterprise: don't show price — contact sales
  const isEnterprise = (p: typeof PLANS[number]) => p.id === "enterprise";

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
            className="fixed bottom-5 left-4 z-[200] w-[calc(100vw-2rem)] max-w-xs sm:left-5 sm:w-80"
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
                        To upgrade, contact me on LinkedIn — I&apos;ll activate your plan manually within 24 h.
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
      className={cn("mx-auto w-full", isDashboard ? "max-w-none space-y-10" : "max-w-7xl px-6 py-16 space-y-20")}
    >
      {/* Header */}
      <div className={isDashboard ? "" : "text-center space-y-4"}>
        {isDashboard ? (
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-2">
            <div>
              <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-linear-to-r from-amber-500 to-amber-500">
                Subscription & Billing
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">Manage your plan, billing, and workspace limits.</p>
            </div>
            <div className="flex items-center gap-3 border border-amber-500/20 bg-amber-500/5 px-5 py-3">
              <div className="size-9 bg-amber-500 flex items-center justify-center text-white">
                <MaterialIcon name="rocket_launch" size={18} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Current Plan</p>
                <p className="text-sm font-black text-amber-500">Explorer (Free)</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="inline-flex items-center gap-2 border border-primary/10 bg-primary/5 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-primary/70">
              <Zap className="size-3" /> Engineering-Grade Pricing
            </div>
            <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground md:text-5xl">
              Start free. Scale with your team.
            </h1>
            <p className="text-muted-foreground max-w-xl mx-auto">
              All plans include full access to the GitScope dashboard. Upgrade when you need deeper analytics, AI features, or team collaboration.
            </p>
          </>
        )}

        {/* Billing toggle */}
        <div className={cn("flex", isDashboard ? "mt-4" : "justify-center mt-6")}>
          <div className="inline-flex items-center gap-1 border border-border bg-card p-1.5 shadow-sm">
            <button type="button" onClick={() => setAnnual(false)}
              className={cn("px-4 py-2 font-mono text-[10px] font-bold tracking-widest uppercase transition-all",
                !annual ? "bg-amber-500 text-white shadow" : "text-muted-foreground hover:text-foreground"
              )}>
              Monthly
            </button>
            <button type="button" onClick={() => setAnnual(true)}
              className={cn("flex items-center gap-1.5 px-4 py-2 font-mono text-[10px] font-bold tracking-widest uppercase transition-all",
                annual ? "bg-amber-500 text-white shadow" : "text-muted-foreground hover:text-foreground"
              )}>
              Annual
              <span className="bg-emerald-500/20 px-1.5 py-0.5 text-[8px] text-emerald-500 font-black">−20%</span>
            </button>
          </div>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
        {PLANS.map((plan, idx) => (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.07 }}
            className={cn(
              "relative flex flex-col border-2 bg-card p-7 transition-all hover:shadow-xl",
              plan.color,
              plan.badge === "Most Popular" && "ring-2 ring-primary/20 shadow-primary/5 shadow-xl"
            )}
          >
            {plan.badge && (
              <span className={cn("absolute -top-3 left-6 px-3 py-1 font-mono text-[9px] font-black tracking-widest uppercase shadow", plan.badgeColor)}>
                {plan.badge}
              </span>
            )}

            <h3 className="font-heading text-lg font-black uppercase tracking-tight">{plan.name}</h3>

            {isEnterprise(plan) ? (
              <div className="mt-3">
                <p className="font-heading text-2xl font-black tracking-tight text-amber-500">Let&apos;s talk</p>
                <p className="text-[10px] text-muted-foreground mt-1">Pricing tailored to your scale &amp; usage</p>
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-heading text-4xl font-black tracking-tighter">{price(plan)}</span>
                  {plan.price !== null && plan.price > 0 && (
                    <span className="text-xs font-bold text-muted-foreground">/mo</span>
                  )}
                </div>
                {annual && plan.price && plan.price > 0 && (
                  <p className="text-[10px] text-emerald-500 font-bold mt-0.5">Billed annually — save ${plan.price * 12 * 0.2}/yr</p>
                )}
              </>
            )}

            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">{plan.description}</p>

            <div className="my-5 h-px bg-border/60" />

            <ul className="flex-1 space-y-2.5">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-xs">
                  <Check className="size-4 text-primary shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{f}</span>
                </li>
              ))}
            </ul>

            <Link
              href={plan.ctaHref}
              className={cn(
                "mt-6 flex w-full items-center justify-center gap-2 py-2.5 text-xs font-bold uppercase tracking-widest transition-all",
                plan.id === "pro" || plan.id === "developer" || plan.id === "team"
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
            <table className="min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="py-4 px-6 text-left font-bold text-xs text-muted-foreground uppercase tracking-widest">Feature</th>
                  {PLANS.map((p) => (
                    <th key={p.id} className="py-4 px-4 text-center font-black text-xs">{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.feature} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-6 text-xs text-foreground/80 font-medium">{row.feature}</td>
                    {(["explorer", "pro", "developer", "team", "enterprise"] as const).map((plan) => {
                      const val = row[plan];
                      return (
                        <td key={plan} className="py-3 px-4 text-center">
                          {typeof val === "boolean" ? (
                            val
                              ? <Check className="size-4 text-primary mx-auto" />
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
                Upgrade to Professional or Team to unlock advanced analytics and access billing history.
              </p>
            </div>
            <Link href="/login?mode=signup&plan=pro" className="inline-flex items-center gap-2 px-5 py-2.5 btn-gitscope-primary text-xs font-bold">
              Upgrade Now
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
              { q: "Do I need a GitHub account?", a: "Not for basic browsing. Sign in with GitHub OAuth to unlock live analytics, org data, activity feeds, and higher API rate limits (5,000 req/hr vs. 60 unauthenticated)." },
              { q: "Who pays for the GitHub API calls?", a: "By default, each GitHub OAuth user uses their own personal rate limit. Team and Enterprise workspaces can optionally configure shared service tokens and charge usage internally." },
              { q: "Is my code or data stored?", a: "No. GitScope only reads GitHub metadata (commit counts, PR info, contributor lists). We never clone or store your source code." },
              { q: "Can I analyze private repositories?", a: "Yes — if you sign in with GitHub OAuth and your account has access to the repository, GitScope can analyze it using your token." },
              { q: "How does the AI analysis work?", a: "GitScope runs a tiered AI pipeline. Explorer uses a lightweight single-agent pass, Professional uses multi-agent synthesis, and Team/Enterprise add specialist agents (security, architecture, testability, performance) with deeper code context." },
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
