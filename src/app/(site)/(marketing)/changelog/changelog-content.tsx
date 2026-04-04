"use client";

import Link from "next/link";
import { ArrowRight, GitBranch } from "lucide-react";
import { useVersionTracking } from "@/hooks/use-version-tracking";
import { useEffect } from "react";

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
    version: "1.0.1.0",
    date: "April 2026",
    title: "Production Release Patch 1",
    changes: [
      { kind: "fix", text: "Resolved Safari mobile navigation crashes in Guest Mode demo walkthrough" },
      { kind: "fix", text: "Fixed timezone display issues in Activity Log for international users across all timezones" },
    ],
  },
  {
    version: "1.0.0.0",
    label: "Latest",
    date: "April 2026",
    title: "v1.0 Production Release — Enterprise Ready",
    changes: [
      { kind: "new", text: "Intelligence Hub v1.0 — AI-powered dashboard with real-time anomaly detection, predictive analytics, and automated insights across all repositories" },
      { kind: "new", text: "PR Risk Predictor — Machine learning model analyzing merge probability, estimated review time, deployment impact scoring, and conflict prediction" },
      { kind: "new", text: "Dependency Radar v3 — Multi-language package analysis supporting Node.js, Python, Go, Rust with CVE database integration and automated security alerts" },
      { kind: "new", text: "Enterprise Security Suite — Complete security implementation including CSRF protection with HMAC-SHA256 tokens, IP-based rate limiting with exponential backoff, comprehensive audit logging with 34 event types, and AES-256-GCM encryption for all sensitive data" },
      { kind: "new", text: "Multi-Provider Authentication — Support for GitHub OAuth, Google OAuth, and email/password authentication with email verification, password reset flows, and session management" },
      { kind: "new", text: "AI-Powered Code Analysis — Integration with Anthropic Claude API for repository summaries, code health scoring, and automated documentation generation" },
      { kind: "new", text: "Advanced Analytics Dashboard — Comprehensive metrics including DORA metrics (deployment frequency, lead time, change failure rate, MTTR), velocity tracking, and team performance indicators" },
      { kind: "improvement", text: "Performance optimizations achieving 50% faster page load times through server components, intelligent caching, and database query optimization" },
      { kind: "improvement", text: "Enhanced Command Palette 2.0 with fuzzy search, keyboard shortcuts for all major features, and quick navigation between repositories" },
      { kind: "improvement", text: "Responsive design improvements ensuring optimal experience across desktop, tablet, and mobile devices" },
    ],
  },
  {
    version: "0.9.4.0",
    date: "March 2026",
    title: "Organization Pulse Patch 4",
    changes: [
      { kind: "fix", text: "Fixed React hydration mismatch on dashboard home page by moving client-only date formatting into useEffect hooks" },
      { kind: "fix", text: "Corrected Edge Runtime timeout handling in authentication middleware" },
    ],
  },
  {
    version: "0.9.3.0",
    date: "March 2026",
    title: "Organization Pulse Patch 3",
    changes: [
      { kind: "fix", text: "Fixed contributor deduplication logic for users with multiple email addresses" },
      { kind: "fix", text: "Corrected GitHub API rate limit calculations for accurate quota reporting" },
    ],
  },
  {
    version: "0.9.2.0",
    date: "March 2026",
    title: "Organization Pulse Patch 2",
    changes: [
      { kind: "improvement", text: "Database query optimization reducing API latency by 40% through intelligent indexing and connection pooling" },
      { kind: "improvement", text: "Dark glassmorphism theme applied consistently across all marketing pages, dashboard, and settings interfaces" },
    ],
  },
  {
    version: "0.9.1.0",
    date: "March 2026",
    title: "Organization Pulse Patch 1",
    changes: [
      { kind: "improvement", text: "Repository Comparison Tool now supports side-by-side comparison of up to 5 repositories with exportable CSV snapshots for reporting" },
    ],
  },
  {
    version: "0.9.0.0",
    date: "March 2026",
    title: "Organization Pulse & Team Collaboration",
    changes: [
      { kind: "new", text: "Organization Pulse — Comprehensive organization-level analytics aggregating contributor velocity, bus-factor risk scores, stale branch identification, and cross-repository health metrics" },
      { kind: "new", text: "Settings v2 — Completely redesigned settings interface with dedicated sections for Profile management, Notification preferences, Billing and subscription management, Integrations configuration, and Danger Zone for account actions" },
      { kind: "new", text: "Password Management — Secure password change flow with current password verification, session revocation capabilities, and email notifications for security events" },
      { kind: "new", text: "Team Collaboration Features — Shared bookmarks, annotated repository collections, and team workspace functionality for collaborative analysis" },
    ],
  },
  {
    version: "0.8.2.0",
    date: "February 2026",
    title: "DORA Metrics Patch 2",
    changes: [
      { kind: "fix", text: "Fixed edge case divide-by-zero error in cycle-time calculation for repositories with no commits in selected date range" },
      { kind: "fix", text: "Resolved pagination scroll position reset issue in trending repositories list" },
      { kind: "fix", text: "Corrected search result caching invalidation for real-time accuracy" },
    ],
  },
  {
    version: "0.8.1.0",
    date: "February 2026",
    title: "DORA Metrics Patch 1",
    changes: [
      { kind: "improvement", text: "Search relevance algorithm improved to rank repositories by relevance score incorporating recency, activity signals, and engagement metrics rather than raw star count" },
      { kind: "improvement", text: "API response caching layer implemented reducing dashboard load time by ~35% on repeat visits" },
    ],
  },
  {
    version: "0.8.0.0",
    date: "February 2026",
    title: "DORA Metrics & Activity Logging",
    changes: [
      { kind: "new", text: "DORA Metrics Dashboard — Complete implementation of DevOps Research and Assessment metrics including deployment frequency visualization, lead time for changes tracking, change failure rate analysis, and mean time to recovery (MTTR) calculations" },
      { kind: "new", text: "Activity Log — Comprehensive chronological feed of all repository activities including commits, pull requests, issues, releases, and deployments with full-text search capabilities" },
      { kind: "new", text: "Repository Comparison Tool — Side-by-side comparison of repositories on stars, forks, commit frequency, language breakdown, contributor overlap, and health scores" },
      { kind: "new", text: "Velocity Chart v2 — Enhanced velocity tracking with rolling 7-day windows replacing calendar-week baselines for smoother, more accurate trend analysis" },
    ],
  },
  {
    version: "0.7.2.0",
    date: "January 2026",
    title: "Guest Mode Patch 2",
    changes: [
      { kind: "fix", text: "Fixed authentication middleware timeout handling for Edge Runtime environments" },
      { kind: "fix", text: "Corrected session token validation for guest-to-authenticated user transitions" },
    ],
  },
  {
    version: "0.7.1.0",
    date: "January 2026",
    title: "Guest Mode Patch 1",
    changes: [
      { kind: "improvement", text: "Reduced API rate limits for guest users with intelligent caching to optimize resource usage" },
      { kind: "improvement", text: "Simplified onboarding flow with progressive feature disclosure for new users" },
    ],
  },
  {
    version: "0.7.0.0",
    date: "January 2026",
    title: "Guest Mode & Public Access",
    changes: [
      { kind: "new", text: "Guest Mode — Unauthenticated access allowing users to explore public repository analytics with pre-loaded demo datasets without requiring account creation" },
      { kind: "new", text: "Public Repository Search — Full search functionality available without login requirement for discovering and analyzing public repositories" },
      { kind: "new", text: "Anonymous Usage Analytics — Privacy-respecting analytics to understand user behavior and improve the platform experience" },
    ],
  },
  {
    version: "0.6.2.0",
    date: "December 2025",
    title: "AI Summaries Patch 2",
    changes: [
      { kind: "fix", text: "Fixed contributor deduplication bug where users with multiple commit email addresses were counted multiple times" },
      { kind: "fix", text: "Corrected language detection algorithm for repositories with mixed file types" },
    ],
  },
  {
    version: "0.6.1.0",
    date: "December 2025",
    title: "AI Summaries Patch 1",
    changes: [
      { kind: "improvement", text: "Server Components architecture migration achieving 2× faster page load times through selective rendering and reduced client-side JavaScript" },
      { kind: "improvement", text: "React cache() implementation for GitHub API call optimization and reduced redundant requests" },
      { kind: "improvement", text: "Prisma query optimization with connection pooling for database performance" },
    ],
  },
  {
    version: "0.6.0.0",
    date: "December 2025",
    title: "AI Summaries & Dependency Analysis",
    changes: [
      { kind: "new", text: "AI Repository Summaries — Integration with Anthropic Claude API to generate plain-English repository overviews including project purpose, technology stack identification, and recent development trajectory analysis" },
      { kind: "new", text: "Dependency Radar v1 — Initial implementation scanning package.json, requirements.txt, and Cargo.toml files to identify outdated packages and security vulnerabilities" },
      { kind: "new", text: "Security Advisories Integration — Connection to GitHub Advisory Database for real-time vulnerability notifications" },
    ],
  },
  {
    version: "0.5.2.0",
    date: "November 2025",
    title: "Global Search Patch 2",
    changes: [
      { kind: "fix", text: "Fixed pagination scroll position preservation when navigating trending repositories" },
      { kind: "fix", text: "Corrected search result caching invalidation for real-time accuracy" },
    ],
  },
  {
    version: "0.5.1.0",
    date: "November 2025",
    title: "Global Search Patch 1",
    changes: [
      { kind: "improvement", text: "Dark mode set as system default with localStorage persistence and no flash-of-wrong-theme on page load" },
      { kind: "improvement", text: "Search result ranking algorithm incorporating recency and activity signals" },
    ],
  },
  {
    version: "0.5.0.0",
    date: "November 2025",
    title: "Global Search & Trend Visualization",
    changes: [
      { kind: "new", text: "Global Search — Instant search results for repositories, authors, and topics powered by GitHub Search API with local result caching for performance" },
      { kind: "new", text: "Stars Trend Sparklines — Mini 6-month trajectory charts on every repository card showing star growth patterns at a glance" },
      { kind: "new", text: "Trending Repositories — Curated feed of trending repositories filterable by programming language and time window (daily, weekly, monthly)" },
      { kind: "new", text: "Command Palette (⌘K) — Quick navigation tool for power users to jump between features, repositories, and settings" },
    ],
  },
  {
    version: "0.4.3.0",
    date: "October 2025",
    title: "Enhanced Analytics Patch 3",
    changes: [
      { kind: "fix", text: "Fixed repository language detection for edge cases with uncommon file extensions" },
      { kind: "fix", text: "Corrected star count fetching for repositories with high star counts" },
    ],
  },
  {
    version: "0.4.2.0",
    date: "October 2025",
    title: "Enhanced Analytics Patch 2",
    changes: [
      { kind: "improvement", text: "Loading state optimizations with skeleton screens for better perceived performance" },
    ],
  },
  {
    version: "0.4.1.0",
    date: "October 2025",
    title: "Enhanced Analytics Patch 1",
    changes: [
      { kind: "improvement", text: "Repository card redesign with improved information hierarchy and quick actions" },
      { kind: "improvement", text: "Navigation enhancements with breadcrumb trails and contextual menus" },
    ],
  },
  {
    version: "0.4.0.0",
    date: "October 2025",
    title: "Enhanced Repository Analytics",
    changes: [
      { kind: "new", text: "Contributor Insights — Detailed contributor analytics including commit heatmaps, contribution percentages, and activity timelines" },
      { kind: "new", text: "Commit Frequency Analysis — Visualization of commit patterns over time with daily, weekly, and monthly aggregations" },
      { kind: "new", text: "Language Distribution Charts — Interactive breakdown of repository languages by file count and lines of code" },
    ],
  },
  {
    version: "0.3.2.0",
    date: "September 2025",
    title: "Authentication Patch 2",
    changes: [
      { kind: "fix", text: "Fixed OAuth callback handling for various GitHub account configurations" },
      { kind: "fix", text: "Corrected session cookie settings for cross-domain compatibility" },
    ],
  },
  {
    version: "0.3.1.0",
    date: "September 2025",
    title: "Authentication Patch 1",
    changes: [
      { kind: "improvement", text: "Database schema design with Prisma ORM for type-safe database operations" },
      { kind: "improvement", text: "API route structure optimization for scalability" },
    ],
  },
  {
    version: "0.3.0.0",
    date: "September 2025",
    title: "User Authentication & Personalization",
    changes: [
      { kind: "new", text: "GitHub OAuth Authentication — Secure sign-in via GitHub with automatic profile synchronization" },
      { kind: "new", text: "User Dashboard — Personalized home page with recent activity, saved repositories, and quick access to favorite features" },
      { kind: "new", text: "User Preferences System — Persistent settings for theme, notifications, and default views" },
      { kind: "new", text: "Session Management — Secure session handling with configurable expiration and automatic renewal" },
    ],
  },
  {
    version: "0.2.2.0",
    date: "August 2025",
    title: "UI Foundation Patch 2",
    changes: [
      { kind: "fix", text: "Fixed CSS variable hydration issues in server-side rendering" },
      { kind: "fix", text: "Corrected Tailwind configuration for custom color palette" },
    ],
  },
  {
    version: "0.2.1.0",
    date: "August 2025",
    title: "UI Foundation Patch 1",
    changes: [
      { kind: "improvement", text: "Animation framework setup with Framer Motion for smooth page transitions" },
      { kind: "improvement", text: "Color system implementation with CSS variables for theme flexibility" },
    ],
  },
  {
    version: "0.2.0.0",
    date: "August 2025",
    title: "UI/UX Foundation & Design System",
    changes: [
      { kind: "new", text: "Dark Mode Glassmorphism Design — Complete visual design system with glass-like translucent elements, subtle gradients, and modern aesthetics" },
      { kind: "new", text: "Component Library — Reusable UI components built with Tailwind CSS and shadcn/ui for consistency" },
      { kind: "new", text: "Responsive Layout Foundation — Mobile-first design approach ensuring optimal experience across all device sizes" },
      { kind: "new", text: "Typography System — Custom font stack with Inter and JetBrains Mono for optimal readability" },
    ],
  },
  {
    version: "0.1.2.0",
    date: "July 2025",
    title: "Initial Prototype Patch 2",
    changes: [
      { kind: "fix", text: "Initial bug fixes for API response parsing" },
      { kind: "fix", text: "Corrected environment variable loading for different deployment targets" },
    ],
  },
  {
    version: "0.1.1.0",
    date: "July 2025",
    title: "Initial Prototype Patch 1",
    changes: [
      { kind: "improvement", text: "Development environment configuration with hot reload and debugging tools" },
      { kind: "improvement", text: "Basic error handling and logging infrastructure" },
    ],
  },
  {
    version: "0.1.0.0",
    date: "July 2025",
    title: "Initial Prototype & Foundation",
    changes: [
      { kind: "new", text: "Basic Repository Explorer — Initial implementation of repository detail pages with basic metadata display" },
      { kind: "new", text: "GitHub API Integration — Connection to GitHub REST API for fetching repository data, stars, forks, and basic statistics" },
      { kind: "new", text: "Project Foundation — Next.js 14 setup with App Router, TypeScript configuration, and development tooling" },
      { kind: "new", text: "Database Setup — PostgreSQL database with initial schema for user data and repository caching" },
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

export function ChangelogContent() {
  const { markAsSeen } = useVersionTracking();

  // Mark as seen when user views the changelog
  useEffect(() => {
    markAsSeen();
  }, [markAsSeen]);

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
          from v0.1.0.0 to v1.0.0.0.
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
          href="https://github.com/AshishLekhyani/GitScope"
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
