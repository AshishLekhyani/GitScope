import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, GitBranch } from "lucide-react";

export const metadata: Metadata = {
  title: "Changelog — GitScope",
  description:
    "Full version history for GitScope. See every new feature, improvement, and fix across all releases from v1.0.0 to the latest.",
};

type ChangeKind = "new" | "improvement" | "fix" | "breaking";

interface ChangeItem {
  kind: ChangeKind;
  text: string;
}

interface Release {
  version: string;
  label?: string;
  date: string;
  title: string;
  changes: ChangeItem[];
}

const KIND_META: Record<ChangeKind, { label: string; dot: string; badge: string }> = {
  new: {
    label: "New",
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  improvement: {
    label: "Improved",
    dot: "bg-blue-500",
    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  fix: {
    label: "Fixed",
    dot: "bg-amber-500",
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  breaking: {
    label: "Breaking",
    dot: "bg-red-500",
    badge: "bg-red-500/10 text-red-400 border-red-500/20",
  },
};

const RELEASES: Release[] = [
  {
    version: "2.4.0",
    label: "Latest",
    date: "April 2026",
    title: "Intelligence Hub & PR Risk Predictor",
    changes: [
      { kind: "new", text: "Intelligence Hub — unified AI-powered dashboard surfacing anomalies, bottlenecks, and team health signals across all connected repos." },
      { kind: "new", text: "PR Risk Predictor — machine-learning model estimates merge-conflict probability, review time, and deployment impact before a PR lands." },
      { kind: "new", text: "Dependency Radar v2 — interactive graph view of cross-repo dependency chains with vulnerability overlay from GitHub Advisory Database." },
      { kind: "improvement", text: "Velocity Chart now renders streaming percentile bands for p50/p75/p95 cycle times, with org-level aggregation mode." },
      { kind: "improvement", text: "Command Palette (⌘K) extended with repo comparison, org pulse shortcuts, and fuzzy author search." },
      { kind: "fix", text: "Guest Mode walkthrough no longer crashes on mobile Safari when navigating between demo repos rapidly." },
      { kind: "fix", text: "Activity Log timestamps now correctly display in the viewer's local timezone rather than UTC." },
    ],
  },
  {
    version: "2.3.0",
    date: "March 2026",
    title: "Organization Pulse & Settings Overhaul",
    changes: [
      { kind: "new", text: "Organization Pulse — top-level view aggregating contributor velocity, bus-factor scores, and stale-branch counts across all org repos." },
      { kind: "new", text: "Settings tabs redesigned with dedicated sections for Profile, Notifications, Billing, Integrations, and Danger Zone." },
      { kind: "new", text: "Password management flow added for email/password accounts (change password, session revocation)." },
      { kind: "improvement", text: "Repo Comparison now supports up to 5 repos side-by-side with exportable CSV snapshots." },
      { kind: "improvement", text: "Dark glassmorphism theme applied consistently across all marketing and app pages." },
      { kind: "fix", text: "Hydration mismatch on the dashboard home page resolved by moving client-only date formatting into a useEffect." },
    ],
  },
  {
    version: "2.2.0",
    date: "February 2026",
    title: "Repo Comparison & Activity Log",
    changes: [
      { kind: "new", text: "Repo Comparison page — diff two repositories on stars, forks, commit frequency, language breakdown, and contributor overlap." },
      { kind: "new", text: "Activity Log — chronological feed of commits, PR events, issue activity, and release deployments with full-text search." },
      { kind: "improvement", text: "Velocity Chart baseline shifted from calendar-week to rolling 7-day window for smoother trend lines." },
      { kind: "improvement", text: "API response caching layer added; dashboard load time reduced by ~35% on repeat visits." },
      { kind: "fix", text: "Fixed edge case where repos with zero commits in the selected date range caused a divide-by-zero in cycle-time calculation." },
    ],
  },
  {
    version: "2.1.0",
    date: "January 2026",
    title: "Velocity Chart & Guest Mode",
    changes: [
      { kind: "new", text: "Velocity Chart — DORA-aligned lead time, deployment frequency, change failure rate, and MTTR visualised over configurable rolling windows." },
      { kind: "new", text: "Guest Mode — unauthenticated walkthrough of public repo analytics with pre-loaded demo data; no account required." },
      { kind: "improvement", text: "Search results now rank repos by relevance score rather than raw star count, incorporating recency and activity signals." },
      { kind: "fix", text: "Auth middleware no longer incorrectly redirects users on edge runtimes when Prisma session lookup times out." },
    ],
  },
  {
    version: "2.0.0",
    date: "December 2025",
    title: "Pro & Enterprise Tiers — General Availability",
    changes: [
      { kind: "new", text: "Pro tier unlocked: unlimited repo tracking, Dependency Radar, PR Risk Predictor, and priority support." },
      { kind: "new", text: "Enterprise tier: SSO via SAML, role-based access control, audit logs, and custom SLA." },
      { kind: "new", text: "Billing portal powered by Stripe with monthly/annual toggle and seat management." },
      { kind: "breaking", text: "Free tier now limited to 3 tracked repositories and 30-day history. Existing users grandfathered for 90 days." },
      { kind: "breaking", text: "Legacy `/api/v1/` endpoints removed. Migrate to `/api/v2/` — see migration guide in docs." },
      { kind: "improvement", text: "Authentication rewritten to use NextAuth v5 with server-session cookies; removes client-side JWT exposure." },
    ],
  },
  {
    version: "1.5.0",
    date: "October 2025",
    title: "Dependency Radar & AI Summaries",
    changes: [
      { kind: "new", text: "Dependency Radar (beta) — scans package.json / requirements.txt / Cargo.toml across tracked repos and flags outdated or vulnerable packages." },
      { kind: "new", text: "AI-generated repo summaries powered by Claude: one-paragraph plain-English overview of repo purpose, tech stack, and recent trajectory." },
      { kind: "improvement", text: "Repository detail page loads 2× faster thanks to selective server components and React cache() for GitHub API calls." },
      { kind: "fix", text: "Corrected contributor de-duplication bug where users with multiple commit emails were counted more than once." },
    ],
  },
  {
    version: "1.2.0",
    date: "August 2025",
    title: "Search, Stars Trend & Dark Mode",
    changes: [
      { kind: "new", text: "Global search with instant results for repositories, authors, and topics — powered by GitHub Search API with local result caching." },
      { kind: "new", text: "Stars trend sparkline added to every repo card, showing 6-month trajectory at a glance." },
      { kind: "improvement", text: "Dark mode now system-default; toggle persisted in localStorage with no flash-of-wrong-theme." },
      { kind: "fix", text: "Pagination in the trending repos list no longer resets scroll position to top on each page change." },
    ],
  },
  {
    version: "1.0.0",
    date: "June 2025",
    title: "Initial Launch",
    changes: [
      { kind: "new", text: "Public launch of GitScope — GitHub analytics dashboard for developers and engineering teams." },
      { kind: "new", text: "Repository explorer with language breakdown, contributor list, commit frequency heatmap, and stars/forks counters." },
      { kind: "new", text: "OAuth authentication via GitHub and Google." },
      { kind: "new", text: "Basic trending repos feed filtered by language and time window (daily / weekly / monthly)." },
    ],
  },
];

function KindBadge({ kind }: { kind: ChangeKind }) {
  const meta = KIND_META[kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${meta.badge}`}
    >
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
      {/* Header */}
      <div className="mb-16 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-indigo-400">
          <GitBranch className="size-3" />
          Version History
        </div>
        <h1 className="font-heading text-4xl font-black tracking-tight text-white sm:text-5xl">
          Changelog
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-slate-400">
          Every release, every improvement. GitScope ships continuously — here is the full record
          from day one to today.
        </p>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-2.75 top-3 bottom-3 w-px bg-linear-to-b from-indigo-500/60 via-indigo-500/20 to-transparent sm:left-5.75" />

        <div className="space-y-12">
          {RELEASES.map((release) => (
            <div key={release.version} className="relative flex gap-6 sm:gap-10">
              {/* Node */}
              <div className="relative shrink-0">
                <div
                  className={`relative z-10 flex size-6 items-center justify-center rounded-full border sm:size-12 ${
                    release.label === "Latest"
                      ? "border-indigo-500/50 bg-indigo-600/20"
                      : "border-white/10 bg-slate-900"
                  }`}
                >
                  <span
                    className={`size-2 rounded-full sm:size-3 ${
                      release.label === "Latest"
                        ? "animate-pulse bg-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.8)]"
                        : "bg-slate-600"
                    }`}
                  />
                </div>
              </div>

              {/* Card */}
              <div className="flex-1 pb-2">
                <div className="rounded-2xl border border-white/5 bg-[#171f33]/80 p-6 backdrop-blur-xl sm:p-8">
                  {/* Version header */}
                  <div className="mb-5 flex flex-wrap items-center gap-3">
                    <span className="rounded-md bg-indigo-500/10 px-2.5 py-1 font-mono text-xs font-black tracking-wider text-indigo-400">
                      v{release.version}
                    </span>
                    {release.label && (
                      <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400 border border-emerald-500/20">
                        {release.label}
                      </span>
                    )}
                    <span className="text-xs font-medium text-slate-500">{release.date}</span>
                  </div>

                  <h2 className="mb-5 font-heading text-xl font-black tracking-tight text-white">
                    {release.title}
                  </h2>

                  <ul className="space-y-3">
                    {release.changes.map((change, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <KindBadge kind={change.kind} />
                        <span className="text-sm leading-relaxed text-slate-300">{change.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer CTA */}
      <div className="mt-20 rounded-2xl border border-indigo-500/20 bg-indigo-600/5 p-10 text-center">
        <h3 className="mb-2 font-heading text-xl font-black text-white">
          Always evolving
        </h3>
        <p className="mb-6 text-sm text-slate-400">
          GitScope ships weekly. Follow the GitHub repository or subscribe to release notifications
          to stay current.
        </p>
        <Link
          href="https://github.com/gitscope"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-indigo-500"
        >
          Watch on GitHub
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
