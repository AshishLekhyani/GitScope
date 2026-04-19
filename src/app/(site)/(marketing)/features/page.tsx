"use client";

import { useLayoutEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Shield,
  BarChart3,
  ArrowRight,
  Code2,
  GitPullRequest,
  Bell,
  Search,
  Zap,
  BookOpen,
  Activity,
  CheckSquare,
  TrendingUp,
  Users,
  TestTube2,
  GitMerge,
  Lock,
  Building2,
} from "lucide-react";
import { ROUTES } from "@/constants/routes";
import type { Metadata } from "next";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const CORE_FEATURES = [
  {
    icon: <Shield className="size-7 text-rose-400" />,
    title: "AI Repo Health Scan",
    desc: "0–100 health score powered by Claude — covering security vulnerabilities, code quality, dependency freshness, documentation density, and maintenance cadence. Findings are ranked Critical → Low with concrete remediation steps.",
    tag: "Intelligence Hub",
    tagColor: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  },
  {
    icon: <Search className="size-7 text-amber-400" />,
    title: "OSV CVE Scanner",
    desc: "Scans your repository's dependencies against Google's Open Source Vulnerability database. Returns every CVE with CVSS score, affected version range, and fixed version — for npm, PyPI, and Go modules.",
    tag: "Security",
    tagColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
  {
    icon: <GitPullRequest className="size-7 text-indigo-400" />,
    title: "PR Description Generator",
    desc: "Paste a diff and get a professional pull request description in seconds. Choose your tone: Concise summary, Detailed with rationale, or Conventional Commits format with type/scope/breaking-change sections.",
    tag: "AI Writing",
    tagColor: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
  },
  {
    icon: <BookOpen className="size-7 text-emerald-400" />,
    title: "README & Changelog Generator",
    desc: "Auto-generate a structured README from repo metadata, or produce a changelog from your recent commits in Keep-a-Changelog, Conventional Commits, or narrative prose format.",
    tag: "AI Writing",
    tagColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  {
    icon: <BarChart3 className="size-7 text-cyan-400" />,
    title: "Repository Analytics",
    desc: "Stars, forks, open issues, language breakdown, contributor heatmaps, commit frequency charts, DORA metrics, and side-by-side comparison of up to 3 repos — all from live GitHub data, no stale snapshots.",
    tag: "Analytics",
    tagColor: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  },
  {
    icon: <TrendingUp className="size-7 text-violet-400" />,
    title: "Stack Trending",
    desc: "Real-time trending repository feed filterable by programming language. Language preference persists across sessions. Spot what's gaining momentum in TypeScript, Python, Rust, Go, or any ecosystem before it hits HN.",
    tag: "Discovery",
    tagColor: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  },
  {
    icon: <Bell className="size-7 text-blue-400" />,
    title: "Slack & Discord Alerts",
    desc: "Connect a webhook in Settings and GitScope pushes real-time scan alerts to your channel when a repo's health drops. Works with both Slack and Discord — no bot installation, just a webhook URL.",
    tag: "Notifications",
    tagColor: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  },
  {
    icon: <Activity className="size-7 text-orange-400" />,
    title: "Weekly Digest Email",
    desc: "Opt-in to a Monday morning fleet health summary delivered to your inbox — average health score, week-over-week delta, top 3 repos, and your at-risk projects (score < 50) in one glance.",
    tag: "Notifications",
    tagColor: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  },
  {
    icon: <CheckSquare className="size-7 text-teal-400" />,
    title: "Action Items & Issue Creation",
    desc: "Save any scan finding as an Action Item that persists across sessions. Track it to completion or escalate to a GitHub Issue with one click — pre-filled with the finding title, severity, and repo context.",
    tag: "Workflow",
    tagColor: "text-teal-400 bg-teal-500/10 border-teal-500/20",
  },
  {
    icon: <Users className="size-7 text-violet-400" />,
    title: "Code Ownership Maps",
    desc: "See exactly who owns what. Per-contributor commit percentage, additions/deletions, a stacked ownership bar across your top 8 contributors, and a Bus Factor score — the minimum number of developers who control 80% of the codebase.",
    tag: "Ownership",
    tagColor: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  },
  {
    icon: <GitMerge className="size-7 text-cyan-400" />,
    title: "CI/CD Status Dashboard",
    desc: "Live GitHub Actions workflow runs per repo — pass rate, run streak (color-coded dots), average build duration, and per-workflow breakdown. Spot flaky pipelines before they block your team.",
    tag: "CI/CD",
    tagColor: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  },
  {
    icon: <TestTube2 className="size-7 text-green-400" />,
    title: "Test Coverage Reporting",
    desc: "Coverage percentage pulled from Codecov's public API, displayed as a ring gauge with an A+–F grade, trend chart across your last 10 commits, and automatic detection of Jest, Vitest, pytest, coverage.py, and Go test configs.",
    tag: "Quality",
    tagColor: "text-green-400 bg-green-500/10 border-green-500/20",
  },
  {
    icon: <GitPullRequest className="size-7 text-rose-400" />,
    title: "PR Queue — Bulk AI Review",
    desc: "Load all open PRs for any repo in one click. Select any subset and run AI security + quality reviews in parallel. Results appear inline — verdict (Approve / Request Changes / Discuss), risk level, and top findings per PR.",
    tag: "PR Review",
    tagColor: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  },
  {
    icon: <Building2 className="size-7 text-indigo-400" />,
    title: "Shared Team Workspaces",
    desc: "On the Organizations page, click any org to open a Shared Workspace — aggregated scan history across all team members for every repo in that org. See fleet health, critical repo count, and per-repo scores at a glance.",
    tag: "Team",
    tagColor: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
  },
  {
    icon: <Lock className="size-7 text-amber-400" />,
    title: "Private Repo Analysis",
    desc: "Connect GitHub via OAuth once and every scan — AI health, OSV CVE, PR review, code ownership, CI/CD — runs against your private repositories using your OAuth token. No personal access tokens required.",
    tag: "Access",
    tagColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Search any repository",
    body: "Enter any public GitHub repo (e.g. vercel/next.js) into the search bar. You get full analytics instantly — no setup, no configuration.",
  },
  {
    step: "02",
    title: "Run an AI scan",
    body: "Go to Intelligence Hub, paste the repo name, and hit Scan. GitScope runs the health check, OSV CVE lookup, and AI analysis in parallel.",
  },
  {
    step: "03",
    title: "Act on findings",
    body: "Save critical findings as Action Items, create GitHub Issues directly, or share results with your team via Slack/Discord.",
  },
  {
    step: "04",
    title: "Stay updated automatically",
    body: "Set up scheduled scans (daily/weekly/monthly) and the weekly digest email. GitScope watches your repos so you don't have to.",
  },
];

export default function FeaturesPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.from(".hero-text", {
        y: 50, opacity: 0, duration: 0.9, ease: "power4.out", stagger: 0.12,
      });
      gsap.utils.toArray<HTMLElement>(".feature-card").forEach((card, i) => {
        gsap.from(card, {
          scrollTrigger: { trigger: card, start: "top 92%", toggleActions: "play none none none" },
          y: 40, opacity: 0, duration: 0.7, ease: "power3.out", delay: (i % 3) * 0.07,
        });
      });
      gsap.from(".step-item", {
        scrollTrigger: { trigger: ".how-section", start: "top 80%" },
        x: -30, opacity: 0, stagger: 0.15, duration: 0.7, ease: "power3.out",
      });
      gsap.from(".cta-block", {
        scrollTrigger: { trigger: ".cta-block", start: "top 85%" },
        y: 50, opacity: 0, scale: 0.97, duration: 0.9, ease: "power3.out",
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="relative min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* Hero */}
      <section className="relative pt-28 pb-20 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-500/5 blur-[120px] rounded-full" />
        </div>
        <div className="relative z-10 max-w-4xl mx-auto">
          <div className="hero-text inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/5 text-indigo-400 text-xs font-bold uppercase tracking-widest mb-8">
            <Zap className="size-3" />
            GitHub Intelligence Platform
          </div>
          <h1 className="hero-text font-heading text-5xl md:text-7xl font-black tracking-tight mb-6">
            Everything you need to<br />
            <span className="text-indigo-400">understand any codebase</span>
          </h1>
          <p className="hero-text text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            AI-powered health scans, CVE detection, PR generation, contributor analytics, Slack/Discord alerts — all in one platform, for any public GitHub repo.
          </p>
          <div className="hero-text flex flex-wrap items-center justify-center gap-4">
            <Link
              href={ROUTES.signup}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-colors shadow-lg shadow-indigo-500/20"
            >
              Start for free
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/guest"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl border border-border hover:bg-muted transition-colors font-semibold text-sm"
            >
              Try without signing in
            </Link>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-indigo-400 mb-3">Capabilities</p>
            <h2 className="font-heading text-4xl md:text-5xl font-black tracking-tight">
              The full feature set
            </h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto text-sm leading-relaxed">
              Every tool in GitScope is built around one principle: give you the signal, not the noise.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {CORE_FEATURES.map((f, i) => (
              <div
                key={i}
                className="feature-card group relative p-7 rounded-2xl border border-border bg-card hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/5 transition-all duration-300 overflow-hidden"
              >
                <div className="absolute -bottom-16 -right-16 size-48 bg-indigo-500/3 blur-[80px] rounded-full group-hover:bg-indigo-500/8 transition-colors" />
                <div className="relative z-10">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="p-2.5 rounded-xl bg-muted/60 border border-border">
                      {f.icon}
                    </div>
                    <span className={`mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${f.tagColor}`}>
                      {f.tag}
                    </span>
                  </div>
                  <h3 className="font-heading text-lg font-black mb-2 group-hover:text-indigo-400 transition-colors">
                    {f.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="how-section py-20 px-6 bg-muted/20 dark:bg-muted/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-indigo-400 mb-3">Workflow</p>
            <h2 className="font-heading text-4xl font-black tracking-tight">How it works</h2>
          </div>
          <div className="grid gap-6 sm:gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((s, i) => (
              <div key={i} className="step-item flex flex-col gap-4">
                <span className="font-mono text-4xl font-black text-indigo-500/20">{s.step}</span>
                <h3 className="font-heading text-lg font-black">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Keyboard shortcuts callout */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto rounded-2xl border border-border bg-card p-10 flex flex-col md:flex-row items-center gap-8">
          <div className="flex-1">
            <p className="text-xs font-black uppercase tracking-widest text-indigo-400 mb-2">Power users</p>
            <h3 className="font-heading text-2xl font-black mb-3">Fully keyboard-driven</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Press <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-xs">⌘K</kbd> to open the command palette, <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-xs">T</kbd> to toggle theme, <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-xs">F</kbd> for fullscreen, and <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-xs">G→O</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-xs">G→E</kbd> to jump between views — no mouse required.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 shrink-0 text-[11px] font-mono w-full sm:w-auto">
            {[
              ["⌘K", "Command palette"],
              ["/", "Focus search"],
              ["T", "Toggle theme"],
              ["F", "Fullscreen"],
              ["G → O", "Overview"],
              ["G → E", "Search"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <kbd className="px-2 py-1 rounded-md bg-muted border border-border font-mono text-[10px] font-bold shrink-0">{key}</kbd>
                <span className="text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6">
        <div className="cta-block max-w-4xl mx-auto rounded-3xl bg-linear-to-br from-indigo-600 to-indigo-900 p-12 md:p-20 text-center text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.07)_0%,_transparent_70%)]" />
          <div className="relative z-10">
            <h2 className="font-heading text-4xl md:text-5xl font-black mb-5 tracking-tight">
              Start analyzing in 30 seconds
            </h2>
            <p className="text-indigo-100/80 text-base mb-10 max-w-xl mx-auto leading-relaxed">
              No credit card. No install. Search any public GitHub repository and get full analytics immediately.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                href={ROUTES.signup}
                className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-indigo-900 font-black hover:bg-indigo-50 transition-colors shadow-xl"
              >
                Create free account
                <Code2 className="size-4" />
              </Link>
              <Link
                href="/guest"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-xl border border-white/20 text-white font-bold hover:bg-white/10 transition-colors text-sm"
              >
                Try as guest
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
