"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";
import Link from "next/link";
import { MaterialIcon } from "@/components/material-icon";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { GitBranch, Users, Zap, Shield, Star, Grid3x3, ArrowRight, Search, LogIn, ChevronRight } from "lucide-react";
import { useTheme } from "next-themes";
import type Lenis from "lenis";

/* ─── DATA ─────────────────────────────────────────────────────────────────── */

const STATS = [
  { value: "50K+",  label: "Repos Analyzed" },
  { value: "500M+", label: "Commits Indexed" },
  { value: "99.9%", label: "API Uptime" },
  { value: "240ms", label: "Avg Response" },
];

const MARQUEE_TECHS = [
  { icon: "logos:react",            name: "React" },
  { icon: "logos:nextjs-icon",      name: "Next.js" },
  { icon: "logos:typescript-icon",  name: "TypeScript" },
  { icon: "logos:rust",             name: "Rust" },
  { icon: "logos:go",               name: "Go" },
  { icon: "logos:python",           name: "Python" },
  { icon: "logos:docker-icon",      name: "Docker" },
  { icon: "logos:kubernetes",       name: "Kubernetes" },
  { icon: "logos:graphql",          name: "GraphQL" },
  { icon: "logos:postgresql",       name: "PostgreSQL" },
  { icon: "logos:prisma",           name: "Prisma" },
  { icon: "logos:vercel-icon",      name: "Vercel" },
  { icon: "logos:github-icon",      name: "GitHub" },
  { icon: "logos:tailwindcss-icon", name: "Tailwind" },
];

const TICKER_ITEMS = [
  { text: "COMMITS PER SECOND", val: "14.2" },
  { text: "ACTIVE TEAMS", val: "2,481" },
  { text: "REPOS INDEXED", val: "50K+" },
  { text: "PR MEDIAN REVIEW", val: "34 MIN" },
  { text: "GITHUB API v4" },
  { text: "DORA ELITE TEAMS SUPPORTED" },
  { text: "WEEKLY DIGEST ENABLED" },
  { text: "GITHUB STARS", val: "★ 12.4K" },
];

const FEATURE_TABS = [
  {
    id: "compare",
    icon: <GitBranch className="size-3.5" />,
    label: "Repo Compare",
    headline: "Benchmark Any Two Repos Side-by-Side",
    body: "High-fidelity cross-repository benchmarks. Compare commit velocity, contributor density, language distribution, and health scores across your microservices fleet — in under a second.",
    stats: [
      { label: "Sync Latency", value: "< 240ms" },
      { label: "Protocol",     value: "Enterprise-ready" },
    ],
    href: ROUTES.feature("repo-comparison"),
  },
  {
    id: "clusters",
    icon: <Users className="size-3.5" />,
    label: "Contributor Clusters",
    headline: "Visualize Knowledge & Collaboration Density",
    body: "Identify knowledge silos, collaboration hotspots, and institutional bottlenecks before they become incidents. Graph-based contributor intelligence that maps exactly who owns what.",
    stats: [
      { label: "Detection",  value: "Real-time" },
      { label: "Coverage",   value: "100% commits" },
    ],
    href: ROUTES.feature("contributor-insights"),
  },
  {
    id: "heatmap",
    icon: <Grid3x3 className="size-3.5" />,
    label: "Commit Heatmap",
    headline: "See Exactly When Your Team Ships",
    body: "GitHub-style contribution heatmap across any repo, any time range. Spot burnout patterns, sprint surges, and low-activity windows before they become delivery risks.",
    stats: [
      { label: "Granularity", value: "Per-day" },
      { label: "Range",       value: "365 days" },
    ],
    href: ROUTES.feature("contributor-heatmap"),
  },
  {
    id: "health",
    icon: <Shield className="size-3.5" />,
    label: "Code Health",
    headline: "Deep-Scan Every Branch for Structural Risk",
    body: "SAST-level structural analysis without the complexity. Health scoring across complexity, test coverage, dependency hygiene, and PR merge patterns — surfaced as actionable intelligence.",
    stats: [
      { label: "Security Score", value: "A+" },
      { label: "SOC2",           value: "Compliance-ready" },
    ],
    href: ROUTES.feature("code-health"),
  },
  {
    id: "ai",
    icon: <Zap className="size-3.5" />,
    label: "AI Intelligence",
    headline: "Predict Delivery Windows with 92% Confidence",
    body: "Augmented intelligence forecasting trained on your repo's own velocity patterns. Surface delivery risk before it surfaces in standups. DORA metrics, PR risk scoring, and dependency radar.",
    stats: [
      { label: "Confidence", value: "92%" },
      { label: "DORA Tier",  value: "Elite" },
    ],
    href: ROUTES.feature("release-forecasting"),
  },
];

const TESTIMONIALS = [
  {
    quote: "GitScope surfaced a contributor bus-factor risk in our core payments service two weeks before our lead left. That visibility alone was worth the entire year.",
    name: "Ethan Voss", role: "VP of Engineering", company: "Meridian Systems", initials: "EV",
  },
  {
    quote: "DORA metrics that used to take a full sprint to compile now update live on our engineering dashboard. Our deployment frequency doubled in one quarter.",
    name: "Priya Nair", role: "Tech Lead", company: "Flux Platform", initials: "PN",
  },
  {
    quote: "The PR risk predictor caught a high-complexity merge before it hit main. We used to catch those in post-mortems. Now we catch them in Slack.",
    name: "Jordan Calloway", role: "Staff Engineer", company: "Archway Labs", initials: "JC",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01", icon: "login",
    title: "Create an Account",
    body: "Sign up with email, Google, or GitHub OAuth. GitHub OAuth unlocks the full Intelligence Hub — DORA metrics, AI risk, dependency radar.",
  },
  {
    step: "02", icon: "travel_explore",
    title: "Search Any Repository",
    body: "Type owner/repo in the search bar. GitScope fetches live data from the GitHub API — no setup, no cloning required.",
  },
  {
    step: "03", icon: "psychology",
    title: "Get Deep Insights",
    body: "Commit velocity, contributor clusters, language distribution, PR risk scores, and DORA metrics — in seconds.",
  },
];

const ASCII_LINES = [
  "┌── repo/acme-core ──────────────────────────────────┐",
  "│  branches 47    contributors 22    open prs 12     │",
  "│                                                    │",
  "│  commits/day  ▁▁▂▃▃▅▇█▇▅▆▇▇█▇▅▆▇█▇▆▆▇▇█▇▆▇█▇▇▆   │",
  "│  review time  ▅▅▃▂▂▃▃▂▁▁▂▂▁▁▂▁▁▂▂▃▂▁▁▂▁▁▁▁▂▂▁▁   │",
  "│  incidents    ·······!·····························│",
  "│                                                    │",
  "│  ▸ #4821  feat: streaming review comments  @kd    │",
  "│  ▸ #4822  fix: flaky test on windows       @mari  │",
  "│  ▸ #4823  refactor: extract scheduler      @theo  │",
  "└────────────────────────────────────────────────────┘",
];

/* ─── LIVE CLOCK ─────────────────────────────────────────────────────────── */
function useClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toISOString().substring(11, 19) + " UTC");
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // bfcache restores can resurrect stale animation/runtime state on this heavy page.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);
  return time;
}

function GitScopeLogo({ className = "size-6" }: { className?: string }) {
  return (
    <span className={cn("relative block shrink-0 overflow-hidden", className)}>
      <img
        src="/logo.png"
        alt="GitScope"
        className="hidden size-full object-contain dark:block"
      />
      <img
        src="/logo-light.png"
        alt="GitScope"
        className="block size-full object-contain dark:hidden"
        onError={(event) => {
          event.currentTarget.src = "/logo.png";
        }}
      />
    </span>
  );
}

/* ─── LIVE BARS ──────────────────────────────────────────────────────────── */
const BARS_SEED = [42,68,35,80,55,72,28,90,61,45,77,33,85,50,38,92,47,65,29,83,57,71,44,88];
function LiveBars() {
  const [bars, setBars] = useState<number[]>(BARS_SEED);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    setBars(Array.from({ length: 24 }, () => 20 + Math.random() * 80));
    const id = setInterval(() => setBars((p) => [...p.slice(1), 20 + Math.random() * 80]), 900);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-end gap-[3px] h-full" suppressHydrationWarning>
      {bars.map((h, i) => (
        <div
          key={i}
          style={{ height: `${h}%` }}
          className={cn("flex-1", mounted ? "transition-all duration-700" : "",
            i === bars.length - 1 ? "bg-amber-500" : "bg-foreground/20")}
        />
      ))}
    </div>
  );
}

/* ─── THEME TOGGLE ───────────────────────────────────────────────────────── */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-20 h-7" />;
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      {resolvedTheme === "dark" ? "◑" : "◐"} Theme
    </button>
  );
}

/* ─── METRIC BAR ─────────────────────────────────────────────────────────── */
function MetricBar({ label, pct, value, colorClass }: {
  label: string; pct: number; value: string; colorClass: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between font-mono text-[9px] text-foreground/40 uppercase tracking-widest">
        <span>{label}</span>
        <span className={colorClass}>{value}</span>
      </div>
      <div className="h-1.5 rounded-none bg-foreground/8 overflow-hidden">
        <div className={cn("h-full rounded-none bar-fill-animate", colorClass.replace("text-", "bg-"))}
          style={{ "--bar-w": `${pct}%` } as React.CSSProperties} />
      </div>
    </div>
  );
}

/* ─── FEATURE VISUALIZATIONS ─────────────────────────────────────────────── */
function RepoCompareViz() {
  return (
    <div className="w-full border border-border/50 bg-surface-container-lowest overflow-hidden">
      <div className="flex divide-x divide-border/40">
        {[
          { name: "facebook/react",   sc: "220k", cc: "15.2k", hc: "A+", s: 85, c: 72, h: 94 },
          { name: "microsoft/vscode", sc: "160k", cc: "9.8k",  hc: "A",  s: 62, c: 55, h: 89 },
        ].map((repo, i) => (
          <div key={i} className="flex-1 p-4 space-y-3">
            <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase truncate">{repo.name}</p>
            <MetricBar label="Stars"   pct={repo.s} value={repo.sc} colorClass="text-primary" />
            <MetricBar label="Commits" pct={repo.c} value={repo.cc} colorClass="text-tertiary" />
            <MetricBar label="Health"  pct={repo.h} value={repo.hc} colorClass="text-emerald-500" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ContributorNetworkViz() {
  const nodes = [
    { x: 50, y: 18, r: 7,   color: "#f59e0b", pulse: true },
    { x: 20, y: 48, r: 5,   color: "#34d399", pulse: false },
    { x: 80, y: 48, r: 5,   color: "#fbbf24", pulse: false },
    { x: 35, y: 78, r: 4,   color: "#f59e0b", pulse: false },
    { x: 65, y: 78, r: 4,   color: "#34d399", pulse: false },
    { x: 50, y: 53, r: 3.5, color: "#fbbf24", pulse: false },
  ];
  const edges = [[0,1],[0,2],[0,5],[1,3],[2,4],[1,5],[2,5]];
  return (
    <svg viewBox="0 0 100 100" className="w-full h-44">
      {edges.map(([a, b], i) => (
        <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          stroke="rgba(245,158,11,0.2)" strokeWidth="0.6" />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          {n.pulse && (
            <circle cx={n.x} cy={n.y} r={n.r * 2.2} fill={n.color} opacity="0.12">
              <animate attributeName="r" values={`${n.r};${n.r * 2.5};${n.r}`} dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.12;0;0.12" dur="2.5s" repeatCount="indefinite" />
            </circle>
          )}
          <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} opacity="0.9" />
        </g>
      ))}
    </svg>
  );
}

function HeatmapViz() {
  const weeks = 20; const days = 7;
  const grid = React.useMemo(() => {
    let seed = 42;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };
    return Array.from({ length: weeks }, () =>
      Array.from({ length: days }, () => {
        const v = rand();
        return v > 0.85 ? 4 : v > 0.65 ? 3 : v > 0.4 ? 2 : v > 0.2 ? 1 : 0;
      })
    );
  }, []);
  const colors = ["bg-foreground/8","bg-primary/20","bg-primary/40","bg-primary/65","bg-primary"];
  return (
    <div className="w-full overflow-x-auto scrollbar-none">
      <div className="inline-flex flex-col gap-1 min-w-max">
        <div className="flex gap-1 mb-1">
          {Array.from({ length: weeks }, (_, wi) => (
            <div key={wi} className="w-3 flex-shrink-0 flex items-center justify-center">
              {wi % 4 === 0 && <span className="font-mono text-[7px] text-foreground/30">{["Jan","Feb","Mar","Apr","May"][Math.floor(wi / 4)] ?? ""}</span>}
            </div>
          ))}
        </div>
        <div className="flex gap-1">
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((level, di) => (
                <div key={di} className={cn("size-3 transition-all hover:ring-1 hover:ring-primary/60 cursor-default flex-shrink-0", colors[level])} />
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-2 justify-end">
          <span className="font-mono text-[8px] text-foreground/30">Less</span>
          {colors.map((c, i) => <div key={i} className={cn("size-2.5 flex-shrink-0", c)} />)}
          <span className="font-mono text-[8px] text-foreground/30">More</span>
        </div>
      </div>
    </div>
  );
}

function CodeHealthViz() {
  const score = 94;
  const circumference = 2 * Math.PI * 38;
  const dash = (score / 100) * circumference;
  return (
    <div className="flex items-center gap-6 w-full">
      <div className="relative shrink-0">
        <svg width="96" height="96" viewBox="0 0 100 100" className="-rotate-90">
          <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(245,158,11,0.12)" strokeWidth="6" />
          <circle cx="50" cy="50" r="38" fill="none" stroke="url(#health-grad)" strokeWidth="6"
            strokeDasharray={`${dash} ${circumference - dash}`} strokeLinecap="round" />
          <defs>
            <linearGradient id="health-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#34d399" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-heading text-2xl font-black">{score}%</span>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {[
          { label: "Complexity",   pct: 88, colorClass: "text-primary" },
          { label: "Coverage",     pct: 76, colorClass: "text-tertiary" },
          { label: "Dependencies", pct: 94, colorClass: "text-emerald-500" },
          { label: "PR Hygiene",   pct: 91, colorClass: "text-primary" },
        ].map((m, i) => (
          <MetricBar key={i} label={m.label} pct={m.pct} value={`${m.pct}%`} colorClass={m.colorClass} />
        ))}
      </div>
    </div>
  );
}

function DoraViz() {
  const metrics = [
    { label: "Deploy Freq",  value: "Elite",  sub: "Multiple/day",  tc: "text-emerald-500", bar: 95 },
    { label: "Lead Time",    value: "< 1hr",  sub: "Median",        tc: "text-primary",     bar: 88 },
    { label: "MTTR",         value: "12min",  sub: "P50 recovery",  tc: "text-amber-400",   bar: 80 },
    { label: "Change Fail",  value: "1.2%",   sub: "30d window",    tc: "text-emerald-500", bar: 98 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 w-full">
      {metrics.map((m, i) => (
        <div key={i} className="border border-border/50 bg-surface-container p-3 space-y-1.5">
          <p className="font-mono text-[8px] tracking-widest text-muted-foreground uppercase">{m.label}</p>
          <p className={cn("font-heading text-lg font-black", m.tc)}>{m.value}</p>
          <p className="font-mono text-[9px] text-muted-foreground">{m.sub}</p>
          <div className="h-1 bg-foreground/8 overflow-hidden">
            <div className="h-full bar-fill-animate bg-primary"
              style={{ "--bar-w": `${m.bar}%`, "--bar-delay": `${i * 100}ms` } as React.CSSProperties} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeatureViz({ tabId }: { tabId: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div key={tabId} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="w-full">
        {tabId === "compare"  && <RepoCompareViz />}
        {tabId === "clusters" && <ContributorNetworkViz />}
        {tabId === "heatmap"  && <HeatmapViz />}
        {tabId === "health"   && <CodeHealthViz />}
        {tabId === "ai"       && <DoraViz />}
      </motion.div>
    </AnimatePresence>
  );
}

/* ─── TICKER MARQUEE ─────────────────────────────────────────────────────── */
function Ticker() {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="overflow-hidden border-t border-b border-border bg-surface-container-low">
      <div className="flex gap-10 whitespace-nowrap py-2.5" style={{ animation: "marquee-lp 44s linear infinite" }}>
        {items.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-2.5 font-mono text-[11px] tracking-widest uppercase text-muted-foreground">
            <span className="text-primary">►</span>
            {item.text}
            {item.val && <span className="text-foreground font-semibold">{item.val}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── DASHBOARD MOCKUP ───────────────────────────────────────────────────── */
const MOCK_COMMITS = [
  { hash: "a3f2b1", msg: "feat: streaming review comments", author: "kd",    time: "2m ago",  added: 142, removed: 18  },
  { hash: "b9c4d2", msg: "fix: flaky snapshot test on CI",  author: "mari",  time: "14m ago", added: 8,   removed: 31  },
  { hash: "c1e5f3", msg: "refactor: extract job scheduler", author: "theo",  time: "1h ago",  added: 287, removed: 204 },
  { hash: "d8a6g4", msg: "chore: bump deps to latest",      author: "riya",  time: "3h ago",  added: 24,  removed: 19  },
];
const MOCK_LANGS = [
  { name: "TypeScript", pct: 64, color: "bg-primary" },
  { name: "Rust",       pct: 19, color: "bg-amber-600" },
  { name: "Go",         pct: 11, color: "bg-amber-300" },
  { name: "Other",      pct: 6,  color: "bg-foreground/20" },
];
const MOCK_BARS = [28,35,42,38,55,67,72,58,44,63,77,82,68,71,88,74,65,80,91,76,84,93,78,86];

function DashboardMockup({ clock }: { clock: string }) {
  return (
    <div className="flex h-full min-h-[520px] text-[11px] font-mono select-none">
      {/* ── Sidebar ── */}
      <div className="w-[52px] shrink-0 bg-foreground/[0.04] border-r border-border flex flex-col items-center py-3 gap-1">
        <GitScopeLogo className="mb-3 size-7" />
        {[
          { icon: "dashboard",       active: false },
          { icon: "manage_search",   active: true  },
          { icon: "commit",          active: false },
          { icon: "group",           active: false },
          { icon: "shield",          active: false },
          { icon: "psychology",      active: false },
        ].map(({ icon, active }) => (
          <div key={icon}
            className={cn("w-8 h-8 grid place-items-center transition-colors",
              active ? "bg-primary/15 text-primary" : "text-foreground/30 hover:text-foreground/60"
            )}>
            <MaterialIcon name={icon} size={16} />
          </div>
        ))}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/60 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-foreground/70 tracking-wide">vercel / <span className="text-foreground font-semibold">next.js</span></span>
          </div>
          <div className="flex items-center gap-3 text-foreground/40">
            <span className="tabular-nums">{clock || "--:--:--"}</span>
            <span className="hidden sm:block border border-primary/40 text-primary px-2 py-0.5">LIVE</span>
          </div>
        </div>

        {/* Stat cards row */}
        <div className="grid grid-cols-4 gap-px bg-border border-b border-border shrink-0">
          {[
            { label: "Stars",        val: "126K",  delta: "+2.1K" },
            { label: "Commits",      val: "18.4K", delta: "+43"   },
            { label: "Health",       val: "A+",    delta: "94%"   },
            { label: "DORA",         val: "Elite", delta: "↑"     },
          ].map((c) => (
            <div key={c.label} className="bg-background/50 px-3 py-2.5">
              <div className="text-foreground/40 uppercase tracking-[0.08em] text-[9px] mb-1">{c.label}</div>
              <div className="font-bold text-[15px] leading-none text-foreground tabular-nums">{c.val}</div>
              <div className="text-primary text-[9px] mt-1">{c.delta}</div>
            </div>
          ))}
        </div>

        {/* Body: chart + commits */}
        <div className="flex-1 grid grid-cols-[1fr_1px_40%] overflow-hidden">
          {/* Left: commit chart + languages */}
          <div className="flex flex-col overflow-hidden">
            {/* Bar chart */}
            <div className="px-4 pt-3 pb-2 border-b border-border">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-foreground/50 uppercase tracking-widest text-[9px]">Commits · 24h</span>
                <span className="text-foreground font-bold tabular-nums text-[13px]">43<span className="text-primary text-[9px] ml-1">/hr</span></span>
              </div>
              <div className="flex items-end gap-[2px] h-[52px]">
                {MOCK_BARS.map((h, i) => (
                  <div key={i} style={{ height: `${h}%` }}
                    className={cn("flex-1 min-w-[2px] transition-all duration-500",
                      i === MOCK_BARS.length - 1 ? "bg-primary" : "bg-primary/25"
                    )} />
                ))}
              </div>
            </div>

            {/* Language breakdown */}
            <div className="px-4 py-3 border-b border-border">
              <div className="text-foreground/40 uppercase tracking-[0.08em] text-[9px] mb-2.5">Languages</div>
              <div className="flex h-1.5 rounded-none overflow-hidden gap-px mb-2.5">
                {MOCK_LANGS.map((l) => (
                  <div key={l.name} style={{ width: `${l.pct}%` }} className={cn("h-full", l.color)} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {MOCK_LANGS.map((l) => (
                  <span key={l.name} className="flex items-center gap-1 text-[9px] text-foreground/50">
                    <span className={cn("w-1.5 h-1.5 inline-block", l.color)} />
                    {l.name} <span className="text-foreground/30">{l.pct}%</span>
                  </span>
                ))}
              </div>
            </div>

            {/* DORA mini */}
            <div className="px-4 py-3 flex gap-3 flex-wrap">
              {[
                { label: "Deploy Freq",  val: "Multi/day", tc: "text-emerald-400" },
                { label: "Lead Time",    val: "< 1hr",     tc: "text-primary" },
                { label: "MTTR",         val: "12 min",    tc: "text-amber-300" },
                { label: "Fail Rate",    val: "1.2%",      tc: "text-emerald-400" },
              ].map((d) => (
                <div key={d.label} className="flex-1 min-w-[60px] border border-border px-2 py-1.5">
                  <div className="text-[8px] text-foreground/30 uppercase mb-0.5">{d.label}</div>
                  <div className={cn("font-bold text-[11px]", d.tc)}>{d.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="bg-border" />

          {/* Right: recent commits */}
          <div className="overflow-hidden flex flex-col">
            <div className="px-3 pt-3 pb-2 text-foreground/40 uppercase tracking-[0.08em] text-[9px] border-b border-border shrink-0">
              Recent Commits
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-border/60">
              {MOCK_COMMITS.map((c) => (
                <div key={c.hash} className="px-3 py-2 hover:bg-primary/5 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-primary text-[9px] tabular-nums font-bold">{c.hash}</span>
                    <span className="text-foreground/30 text-[9px]">{c.time}</span>
                  </div>
                  <p className="text-foreground/70 leading-snug text-[10px] truncate">{c.msg}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-foreground/30 text-[9px]">@{c.author}</span>
                    <span className="text-emerald-500 text-[9px]">+{c.added}</span>
                    <span className="text-red-400 text-[9px]">−{c.removed}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── ANIMATION VARIANTS ────────────────────────────────────────────────── */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const stagger = (delay = 0) => ({
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE, delay } },
});

/* ─── ANIMATED SECTION WRAPPER ──────────────────────────────────────────── */
function Reveal({ children, className, delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px 0px" });
  return (
    <motion.div
      ref={ref}
      initial={false}
      animate={inView ? "visible" : "visible"}
      variants={stagger(delay)}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ─── HOW IT WORKS STEP ─────────────────────────────────────────────────── */
function HowItWorksStep({ item, index }: { item: { step: string; icon: string; title: string; body: string }; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px 0px" });
  
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -30 }}
      animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
      transition={{ duration: 0.55, delay: index * 0.12, ease: EASE }}
      className="p-8 md:px-12 flex items-start gap-6 group"
    >
      <div className="flex flex-col items-center gap-3 shrink-0">
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={{ duration: 0.4, delay: index * 0.12 + 0.15, ease: EASE }}
          className="font-bold tabular-nums text-foreground/15"
          style={{ fontFamily: "var(--font-space-grotesk)", fontSize: "36px" }}
        >
          {item.step}
        </motion.span>
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={inView ? { scale: 1, opacity: 1 } : { scale: 0.8, opacity: 0 }}
          transition={{ duration: 0.4, delay: index * 0.12 + 0.22, ease: EASE }}
          className="flex size-9 items-center justify-center border border-border bg-surface-container group-hover:border-primary/40 group-hover:bg-primary/5 transition-colors duration-300"
        >
          <MaterialIcon name={item.icon} size={18} className="text-primary" />
        </motion.div>
      </div>
      <div className="pt-1">
        <h3 className="font-bold text-[17px] text-foreground mb-2" style={{ fontFamily: "var(--font-space-grotesk)" }}>{item.title}</h3>
        <p className="font-mono text-[12px] text-muted-foreground leading-relaxed">{item.body}</p>
      </div>
    </motion.div>
  );
}

/* ─── COUNT-UP STAT ─────────────────────────────────────────────────────── */
function CountUpStat({ value, label }: { value: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px 0px" });
  const [displayed, setDisplayed] = useState(value);

  useEffect(() => {
    if (!inView) return;
    setDisplayed("0");
    const numeric = parseFloat(value.replace(/[^0-9.]/g, ""));
    const suffix = value.replace(/[0-9.]/g, "");
    if (isNaN(numeric)) { setDisplayed(value); return; }
    const duration = 1400;
    const steps = 60;
    const step = duration / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      const progress = current / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      const val = numeric * eased;
      const formatted = val >= 1000 ? (val / 1000).toFixed(1).replace(/\.0$/, "") + (suffix.includes("M") ? "M" : "K") : val.toFixed(val < 10 ? 1 : 0);
      setDisplayed(formatted + suffix.replace(/[0-9KM]/g, ""));
      if (current >= steps) { setDisplayed(value); clearInterval(timer); }
    }, step);
    return () => clearInterval(timer);
  }, [inView, value]);

  return (
    <motion.div
      ref={ref}
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="py-10 px-8 flex flex-col items-center gap-2"
    >
      <div className="font-black tracking-tight tabular-nums text-foreground"
        style={{ fontFamily: "var(--font-space-grotesk)", fontSize: "clamp(28px,3.5vw,44px)" }}>
        {displayed}
      </div>
      <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">{label}</div>
    </motion.div>
  );
}

/* ─── MAIN ───────────────────────────────────────────────────────────────── */
export function LandingPage() {
  const clock = useClock();
  const [activeTab, setActiveTab] = useState(0);

  /* Lenis smooth scroll */
  useEffect(() => {
    let lenisInstance: Lenis | null = null;
    let rafId: number | null = null;
    let disposed = false;
    import("lenis").then(({ default: LenisClass }) => {
      if (disposed) return;
      lenisInstance = new LenisClass({
        duration: 1.15,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
      });
      function raf(time: number) {
        if (disposed) return;
        lenisInstance?.raf(time);
        rafId = requestAnimationFrame(raf);
      }
      rafId = requestAnimationFrame(raf);
    });
    return () => {
      disposed = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      lenisInstance?.destroy();
      // Defensive cleanup in case a stale Lenis class leaks after bfcache restore.
      document.documentElement.classList.remove("lenis", "lenis-smooth", "lenis-stopped");
      document.body.classList.remove("lenis", "lenis-smooth", "lenis-stopped");
    };
  }, []);

  const tab = FEATURE_TABS[activeTab];

  return (
    <>
      <style>{`
        @keyframes marquee-lp {
          from { transform: translateX(0) }
          to   { transform: translateX(-50%) }
        }
        @keyframes marquee-tech {
          from { transform: translateX(0) }
          to   { transform: translateX(-50%) }
        }
        .font-serif-italic {
          font-family: var(--font-instrument-serif), ui-serif, Georgia, serif;
          font-style: italic;
        }
        .bar-fill-animate {
          width: var(--bar-w, 0%);
          transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
        }
      `}</style>

      {/* ═══ TOP CHROME ════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6 lg:grid lg:grid-cols-[220px_1fr_220px]">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <GitScopeLogo className="size-6" />
            <span className="font-mono font-bold text-[13px] tracking-[0.06em]">
              GIT<span className="text-primary">SCOPE</span><span className="text-primary">.</span>
            </span>
          </div>

          {/* Nav */}
          <nav className="hidden justify-center gap-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground md:flex">
            {[["Product", "/"], ["Docs", "/docs"], ["Pricing", "/pricing"], ["Blog", "/blog"], ["Changelog", "/changelog"]].map(([label, href]) => (
              <Link key={label} href={href} className="border-b-2 border-transparent px-3 py-2 transition-colors hover:border-primary hover:bg-accent hover:text-foreground">{label}</Link>
            ))}
          </nav>

          {/* Right */}
          <div className="flex justify-end items-center gap-2">
            <ThemeToggle />
            <Link href={ROUTES.login}
              className="hidden bg-foreground px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-background transition-colors hover:bg-foreground/80 sm:inline-flex">
              Get access →
            </Link>
          </div>
        </div>
      </header>

      {/* ═══ HERO ══════════════════════════════════════════════════════════ */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 lg:grid-cols-2 lg:min-h-[calc(100vh-57px-40px)]">

          {/* Left: Headline */}
          <div className="flex min-h-0 flex-col justify-between border-b border-border p-8 md:p-14 lg:min-h-105 lg:border-b-0 lg:border-r">
            <div>
              {/* Status pill */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
                className="flex flex-wrap gap-2.5 mb-8"
              >
                <span className="inline-flex items-center gap-2 border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]" />
                  v1.0.0 · Shipping weekly
                </span>
                <span className="inline-flex items-center gap-2 border border-primary/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-primary">
                  {"// 50,000+ repos indexed"}
                </span>
              </motion.div>

              {/* Big headline — staggered word reveal */}
              <h1 className="leading-[0.88] tracking-[-0.04em]" style={{ fontFamily: "var(--font-space-grotesk), system-ui, sans-serif" }}>
                {["See Your", "Codebase"].map((word, i) => (
                  <motion.span
                    key={word}
                    className="block text-[clamp(48px,7.5vw,120px)] font-bold text-foreground uppercase overflow-hidden"
                    initial={{ opacity: 0, y: 60 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.75, delay: 0.2 + i * 0.12, ease: EASE }}
                  >
                    {word}
                  </motion.span>
                ))}
                <motion.span
                  className="block text-[clamp(52px,8vw,128px)] font-normal text-primary font-serif-italic leading-[0.9]"
                  initial={{ opacity: 0, y: 60 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.85, delay: 0.44, ease: EASE }}
                >
                  Breathe.
                </motion.span>
              </h1>
            </div>

            {/* Description + CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.65, ease: EASE }}
              className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-10"
            >
              <p className="font-mono text-[13px] leading-relaxed text-muted-foreground">
                High-fidelity telemetry for open-source codebases. Track commit velocity,
                surface <strong className="text-foreground">DORA metrics</strong>, dissect contributor clusters,
                run <strong className="text-foreground">AI security scans</strong> — instantly.
              </p>
              <div className="flex flex-col gap-3">
                <Link href="/guest"
                  className="inline-flex items-center justify-between gap-2 bg-primary text-primary-foreground hover:bg-primary/90 border border-primary px-5 py-3.5 font-mono text-[12px] uppercase tracking-[0.05em] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(199,122,18,0.5)]">
                  <span className="flex items-center gap-2"><Search className="size-3.5" /> Explore Repositories</span>
                  <span>→</span>
                </Link>
                <Link href={ROUTES.login}
                  className="inline-flex items-center justify-between gap-2 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 px-5 py-3.5 font-mono text-[12px] uppercase tracking-[0.05em] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(0,0,0,0.08)] dark:hover:shadow-[4px_4px_0_rgba(255,255,255,0.08)]">
                  <span className="flex items-center gap-2"><LogIn className="size-3.5" /> Sign in</span>
                  <span>→</span>
                </Link>
                <p className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-[0.06em]">No card required · 14-day trial</p>
              </div>
            </motion.div>
          </div>

          {/* Right: ASCII terminal panel */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.85, delay: 0.25, ease: EASE }}
            className="flex flex-col p-8 md:p-10 bg-surface-container-low gap-5"
          >
            <div className="flex justify-between items-center font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                live://gitscope.sh/demo
              </span>
              <span className="tabular-nums">{clock || "--:--:-- UTC"}</span>
            </div>

            {/* ASCII terminal */}
            <pre className="font-mono text-[11px] leading-[1.45] text-muted-foreground overflow-x-auto whitespace-pre bg-surface-container border border-border p-4">
              {ASCII_LINES.join("\n")}
            </pre>

            {/* 4-stat grid */}
            <div className="grid grid-cols-4 gap-px bg-border border border-border">
              {[
                { label: "Throughput",  val: "2.4",  unit: "×" },
                { label: "Review P99",  val: "3h42", unit: "" },
                { label: "Deploys·7d",  val: "128",  unit: "" },
                { label: "Change fail", val: "2.1",  unit: "%" },
              ].map((s) => (
                <div key={s.label} className="bg-surface-container-low p-3">
                  <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground mb-1">{s.label}</div>
                  <div className="tabular-nums font-bold text-2xl leading-none text-foreground" style={{ fontFamily: "var(--font-space-grotesk)" }}>
                    {s.val}<span className="text-primary">{s.unit}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Live bars */}
            <div className="flex flex-col gap-2 flex-1 min-h-20">
              <div className="flex justify-between items-baseline">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">commits / hr</span>
                <span className="font-bold text-xl text-foreground tabular-nums" style={{ fontFamily: "var(--font-space-grotesk)" }}>43</span>
              </div>
              <div className="flex-1">
                <LiveBars />
              </div>
            </div>
          </motion.div>
        </div>

        {/* Ticker strip */}
        <Ticker />
      </section>

      {/* ═══ STATS ═════════════════════════════════════════════════════════ */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-350 grid grid-cols-2 md:grid-cols-4 divide-x divide-border">
          {STATS.map((s) => (
            <CountUpStat key={s.label} value={s.value} label={s.label} />
          ))}
        </div>
      </section>


      {/* ═══ FEATURE TABS ══════════════════════════════════════════════════ */}
      <section className="border-b border-border">
        {/* Section header */}
        <div className="mx-auto max-w-350 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-8 items-end px-8 pt-14 pb-8 border-b border-border">
          <div>
            <p className="font-mono text-[10px] tracking-widest text-primary uppercase mb-3">§ 01 &nbsp; Capabilities</p>
            <h2 className="font-bold tracking-tight leading-none text-foreground"
              style={{ fontFamily: "var(--font-space-grotesk)", fontSize: "clamp(28px,4.5vw,60px)", letterSpacing: "-0.03em" }}>
              Advanced Engineering<br />
              <span className="font-normal font-serif-italic text-primary">Intelligence.</span>
            </h2>
          </div>
          <p className="font-mono text-[13px] text-muted-foreground leading-relaxed max-w-sm">
            Every metric that matters to engineering leadership, surfaced in real-time.
          </p>
        </div>

        {/* Tab pills */}
        <div className="mx-auto max-w-350 flex flex-wrap gap-2 px-8 pt-6">
          {FEATURE_TABS.map((t, i) => (
            <button key={t.id} type="button" onClick={() => setActiveTab(i)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 font-mono text-[11px] tracking-widest uppercase transition-all duration-200 border",
                i === activeTab
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              )}>
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Main panel */}
        <div className="mx-auto max-w-350 px-8 pb-14 pt-6">
          <div className="border border-border grid grid-cols-1 lg:grid-cols-2">
            {/* Left: text */}
            <div className="p-8 md:p-10 flex flex-col justify-between gap-8 border-b lg:border-b-0 lg:border-r border-border">
              <AnimatePresence mode="wait">
                <motion.div key={tab.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.25 }} className="space-y-5">
                  <h3 className="font-bold leading-snug text-foreground"
                    style={{ fontFamily: "var(--font-space-grotesk)", fontSize: "clamp(20px,2.5vw,30px)", letterSpacing: "-0.02em" }}>
                    {tab.headline}
                  </h3>
                  <p className="font-mono text-[13px] text-muted-foreground leading-relaxed">{tab.body}</p>
                  <div className="flex flex-wrap gap-3">
                    {tab.stats.map((s) => (
                      <div key={s.label} className="border border-border bg-surface-container px-4 py-2.5">
                        <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">{s.label}</p>
                        <p className="font-bold text-lg text-primary mt-0.5" style={{ fontFamily: "var(--font-space-grotesk)" }}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <Link href={tab.href} className="inline-flex items-center gap-2 font-mono text-[12px] text-primary hover:gap-3 transition-all uppercase tracking-wide">
                    Explore this feature <ArrowRight className="size-3.5" />
                  </Link>
                </motion.div>
              </AnimatePresence>

              {/* Step dots */}
              <div className="flex gap-2">
                {FEATURE_TABS.map((_, i) => (
                  <button key={i} type="button" aria-label={`View ${FEATURE_TABS[i].label}`}
                    onClick={() => setActiveTab(i)}
                    className={cn("transition-all duration-300", i === activeTab ? "w-6 h-2 bg-primary" : "w-2 h-2 bg-border hover:bg-foreground/30")} />
                ))}
              </div>
            </div>

            {/* Right: visualization */}
            <div className="bg-surface-container-low p-8 md:p-10 flex items-center justify-center min-h-64">
              <FeatureViz tabId={tab.id} />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ══════════════════════════════════════════════════ */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-350 grid grid-cols-1 md:grid-cols-[280px_1fr] divide-y md:divide-y-0 md:divide-x divide-border">
          <Reveal className="p-8 md:p-12 flex flex-col justify-center">
            <p className="font-mono text-[10px] tracking-widest text-primary uppercase mb-4">§ 02 &nbsp; Process</p>
            <h2 className="font-bold leading-[1.05] text-foreground"
              style={{ fontFamily: "var(--font-space-grotesk)", fontSize: "clamp(24px,3.5vw,48px)", letterSpacing: "-0.03em" }}>
              From zero<br />to insight in<br /><span className="text-primary font-serif-italic font-normal">90 seconds.</span>
            </h2>
          </Reveal>
          <div className="grid grid-cols-1 divide-y divide-border">
            {HOW_IT_WORKS.map((item, i) => (
              <HowItWorksStep key={item.step} item={item} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TESTIMONIALS ══════════════════════════════════════════════════ */}
      <section className="border-b border-border bg-surface-container-low">
        <div className="mx-auto max-w-350">
          <div className="px-8 py-8 border-b border-border">
            <p className="font-mono text-[10px] tracking-widest text-primary uppercase">§ 03 &nbsp; Social proof</p>
            <h2 className="font-bold mt-2 text-foreground"
              style={{ fontFamily: "var(--font-space-grotesk)", fontSize: "clamp(22px,3vw,40px)", letterSpacing: "-0.03em" }}>
              Trusted by Engineering Leaders
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="p-8 md:p-10 flex flex-col justify-between gap-8">
                <div className="flex gap-0.5 mb-1">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} className="size-3.5 fill-primary text-primary" />
                  ))}
                </div>
                <blockquote className="font-mono text-[13px] leading-relaxed text-muted-foreground flex-1">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center border border-primary/30 bg-primary/10 font-mono text-[11px] font-black text-primary">
                    {t.initials}
                  </div>
                  <div>
                    <p className="font-bold text-sm text-foreground" style={{ fontFamily: "var(--font-space-grotesk)" }}>{t.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-wide">{t.role} · {t.company}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═════════════════════════════════════════════════════ */}
      <section className="bg-foreground text-background border-b border-border">
        <div className="mx-auto max-w-350 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-background/10">
          <div className="p-10 md:p-16 flex flex-col justify-between gap-10">
            <div>
              <p className="font-mono text-[10px] tracking-widest uppercase mb-5 opacity-50">§ 04 &nbsp; Get started</p>
              <h2 className="font-bold leading-none"
                style={{ fontFamily: "var(--font-space-grotesk)", fontSize: "clamp(32px,5vw,72px)", letterSpacing: "-0.04em" }}>
                Architect your<br />Engineering<br />
                <span className="font-normal font-serif-italic" style={{ color: "var(--primary)" }}>Intelligence.</span>
              </h2>
            </div>
            <div className="flex flex-col gap-3 max-w-xs">
              <Link href={ROUTES.signup}
                className="inline-flex items-center justify-between gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-4 font-mono text-[12px] uppercase tracking-[0.05em] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(245,158,11,0.5)]">
                Sign Up Free <span>→</span>
              </Link>
              <Link href={ROUTES.pricing}
                className="inline-flex items-center justify-between gap-2 border border-background/20 text-background/60 hover:text-background hover:border-background/40 px-5 py-4 font-mono text-[12px] uppercase tracking-[0.05em] transition-colors">
                View Pricing <ChevronRight className="size-4" />
              </Link>
            </div>
          </div>

          {/* Status rail */}
          <div className="grid grid-cols-1 divide-y divide-background/10">
            {[
              { label: "All systems", val: "Operational", dot: true },
              { label: "Region", val: "us-east-1 / eu-west-2" },
              { label: "API latency", val: "38ms" },
              { label: "GitHub API", val: "v4 · GraphQL" },
            ].map((row) => (
              <div key={row.label} className="px-10 py-6 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em]">
                <span className="opacity-40">{row.label}</span>
                <span className="flex items-center gap-2 opacity-80">
                  {row.dot && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                  {row.val}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ════════════════════════════════════════════════════════ */}
      <footer className="bg-background border-t border-border">
        <div className="mx-auto max-w-350 grid grid-cols-2 md:grid-cols-4 gap-8 p-8 md:p-12 border-b border-border">
          {[
            { heading: "Product",  links: [["Features", "/features"], ["Pricing", "/pricing"], ["Changelog", "/changelog"], ["Status", "/status"]] },
            { heading: "Docs",     links: [["API Reference", "/api-reference"], ["Documentation", "/docs"], ["Blog", "/blog"]] },
            { heading: "Legal",    links: [["Privacy", "/privacy"], ["Terms", "/terms"], ["Security", "/security"]] },
            { heading: "Connect",  links: [["GitHub", "https://github.com/AshishLekhyani"], ["LinkedIn", "https://linkedin.com/in/ashishlekhyani"], ["Contact", "mailto:alekhyanisbi@gmail.com"], ["About", "/"]] },
          ].map((col) => (
            <div key={col.heading}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">{col.heading}</div>
              <ul className="space-y-2.5">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith("http") || href.startsWith("mailto:") ? (
                      <a
                        href={href}
                        className="font-mono text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                        target={href.startsWith("http") ? "_blank" : undefined}
                        rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                      >
                        {label}
                      </a>
                    ) : (
                      <Link
                        href={href}
                        className="font-mono text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mx-auto max-w-350 px-8 md:px-12 py-5 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          <span>GITSCOPE © 2026</span>
          <span className="hidden md:block">Set in Space Grotesk &amp; JetBrains Mono</span>
          <span className="hidden md:block">Built for engineers.</span>
        </div>
      </footer>
    </>
  );
}
