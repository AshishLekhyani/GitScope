"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";
import Link from "next/link";
import NextImage from "next/image";
import { MaterialIcon } from "@/components/material-icon";
import { Icon } from "@iconify/react";
import { motion, AnimatePresence } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import {
  Search, LogIn, ArrowRight, GitBranch, Users, Zap, Shield,
  Star, ChevronRight, TrendingUp, Activity, Grid3x3
} from "lucide-react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

/* ─── DATA ─────────────────────────────────────────────────────────────────── */

const STATS = [
  { value: 50000, suffix: "+", label: "Repos Analyzed", decimals: 0 },
  { value: 500,   suffix: "M+", label: "Commits Indexed", decimals: 0 },
  { value: 99.9,  suffix: "%",  label: "API Uptime", decimals: 1 },
  { value: 240,   suffix: "ms", label: "Avg Response", decimals: 0 },
];

const MARQUEE_TECHS = [
  { icon: "logos:react",           name: "React" },
  { icon: "logos:nextjs-icon",     name: "Next.js" },
  { icon: "logos:typescript-icon", name: "TypeScript" },
  { icon: "logos:rust",            name: "Rust" },
  { icon: "logos:go",              name: "Go" },
  { icon: "logos:python",          name: "Python" },
  { icon: "logos:docker-icon",     name: "Docker" },
  { icon: "logos:kubernetes",      name: "Kubernetes" },
  { icon: "logos:graphql",         name: "GraphQL" },
  { icon: "logos:postgresql",      name: "PostgreSQL" },
  { icon: "logos:prisma",          name: "Prisma" },
  { icon: "logos:vercel-icon",     name: "Vercel" },
  { icon: "logos:github-icon",     name: "GitHub" },
  { icon: "logos:tailwindcss-icon",name: "Tailwind" },
];

const FEATURE_TABS = [
  {
    id: "compare",
    icon: <GitBranch className="size-4" />,
    label: "Repo Compare",
    headline: "Benchmark Any Two Repos Side-by-Side",
    body: "High-fidelity cross-repository benchmarks. Compare commit velocity, contributor density, language distribution, and health scores across your microservices fleet — in under a second.",
    stats: [
      { label: "Sync Latency", value: "< 240ms", accent: "text-emerald-400" },
      { label: "Protocol",     value: "Enterprise-ready", accent: "text-primary" },
    ],
    href: ROUTES.feature("repo-comparison"),
  },
  {
    id: "clusters",
    icon: <Users className="size-4" />,
    label: "Contributor Clusters",
    headline: "Visualize Knowledge & Collaboration Density",
    body: "Identify knowledge silos, collaboration hotspots, and institutional bottlenecks before they become incidents. Graph-based contributor intelligence that maps exactly who owns what.",
    stats: [
      { label: "Detection",  value: "Real-time",    accent: "text-primary" },
      { label: "Coverage",   value: "100% commits", accent: "text-emerald-400" },
    ],
    href: ROUTES.feature("contributor-insights"),
  },
  {
    id: "heatmap",
    icon: <Grid3x3 className="size-4" />,
    label: "Commit Heatmap",
    headline: "See Exactly When Your Team Ships",
    body: "GitHub-style contribution heatmap across any repo, any time range. Spot burnout patterns, sprint surges, and low-activity windows before they become delivery risks.",
    stats: [
      { label: "Granularity", value: "Per-day",   accent: "text-primary" },
      { label: "Range",       value: "365 days",  accent: "text-tertiary" },
    ],
    href: ROUTES.feature("contributor-heatmap"),
  },
  {
    id: "health",
    icon: <Shield className="size-4" />,
    label: "Code Health",
    headline: "Deep-Scan Every Branch for Structural Risk",
    body: "SAST-level structural analysis without the complexity. Health scoring across complexity, test coverage, dependency hygiene, and PR merge patterns — surfaced as actionable intelligence.",
    stats: [
      { label: "Security Score", value: "A+",                accent: "text-primary" },
      { label: "SOC2",           value: "Compliance-ready",  accent: "text-emerald-400" },
    ],
    href: ROUTES.feature("code-health"),
  },
  {
    id: "ai",
    icon: <Zap className="size-4" />,
    label: "AI Intelligence",
    headline: "Predict Delivery Windows with 92% Confidence",
    body: "Augmented intelligence forecasting trained on your repo's own velocity patterns. Surface delivery risk before it surfaces in standups. DORA metrics, PR risk scoring, and dependency radar.",
    stats: [
      { label: "Confidence", value: "92%",   accent: "text-tertiary" },
      { label: "DORA Tier",  value: "Elite", accent: "text-primary" },
    ],
    href: ROUTES.feature("release-forecasting"),
  },
];

const TESTIMONIALS = [
  {
    quote: "GitScope surfaced a contributor bus-factor risk in our core payments service two weeks before our lead left. That visibility alone was worth the entire year.",
    name: "Ethan Voss",
    role: "VP of Engineering",
    company: "Meridian Systems",
    initials: "EV",
    color: "from-indigo-500/25 to-primary/10",
  },
  {
    quote: "DORA metrics that used to take a full sprint to compile now update live on our engineering dashboard. Our deployment frequency doubled in one quarter.",
    name: "Priya Nair",
    role: "Tech Lead",
    company: "Flux Platform",
    initials: "PN",
    color: "from-emerald-500/20 to-tertiary/10",
  },
  {
    quote: "The PR risk predictor caught a high-complexity merge before it hit main. We used to catch those in post-mortems. Now we catch them in Slack.",
    name: "Jordan Calloway",
    role: "Staff Engineer",
    company: "Archway Labs",
    initials: "JC",
    color: "from-blue-500/20 to-cyan-400/10",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    icon: "login",
    title: "Create an Account",
    body: "Sign up with email, Google, or GitHub OAuth. GitHub OAuth unlocks the full Intelligence Hub — DORA metrics, AI risk, dependency radar.",
  },
  {
    step: "02",
    icon: "travel_explore",
    title: "Search Any Repository",
    body: "Type owner/repo in the search bar. GitScope fetches live data from the GitHub API — no setup, no cloning required.",
  },
  {
    step: "03",
    icon: "psychology",
    title: "Get Deep Insights",
    body: "Commit velocity, contributor clusters, language distribution, PR risk scores, and DORA metrics — in seconds.",
  },
];

/* ─── UTILITY ───────────────────────────────────────────────────────────────── */

function useSpotlight() {
  const ref = useRef<HTMLDivElement>(null);
  const [isLit, setIsLit] = useState(false);

  const handleMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--y", `${e.clientY - rect.top}px`);
  }, []);

  return {
    ref,
    isLit,
    handlers: {
      onMouseMove: handleMove,
      onMouseEnter: () => setIsLit(true),
      onMouseLeave: () => setIsLit(false),
    },
  };
}

/* ─── STAT COUNTER ──────────────────────────────────────────────────────────── */

function StatCounter({ value, suffix, label, decimals = 0 }: {
  value: number; suffix: string; label: string; decimals?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (!ref.current) return;
    const obj = { v: 0 };
    const trigger = ScrollTrigger.create({
      trigger: ref.current,
      start: "top 88%",
      once: true,
      onEnter: () => {
        gsap.to(obj, {
          v: value,
          duration: 2.2,
          ease: "power2.out",
          onUpdate: () => {
            setDisplay(
              decimals > 0 ? obj.v.toFixed(decimals) : Math.round(obj.v).toLocaleString()
            );
          },
        });
      },
    });
    return () => trigger.kill();
  }, [value, decimals]);

  return (
    <div ref={ref} className="flex flex-col items-center gap-2">
      <div className="font-heading text-4xl sm:text-5xl font-black tracking-tight tabular-nums bg-linear-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">
        {display}<span className="text-primary">{suffix}</span>
      </div>
      <div className="font-mono text-[10px] tracking-widest text-muted-foreground/60 uppercase">{label}</div>
    </div>
  );
}

/* ─── FLOATING BADGE ────────────────────────────────────────────────────────── */

function FloatingBadge({ icon, label, value, className, delay = 0 }: {
  icon: React.ReactNode; label: string; value: string; className?: string; delay?: number;
}) {
  return (
    <motion.div
      animate={{ y: [0, -7, 0] }}
      transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay }}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border border-outline-variant/25 bg-surface-container/95 px-3 py-2 shadow-xl backdrop-blur-md",
        className
      )}
    >
      <div className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
        {icon}
      </div>
      <div>
        <p className="font-mono text-[9px] tracking-widest text-muted-foreground/60 uppercase leading-none">{label}</p>
        <p className="font-heading text-sm font-bold text-foreground leading-snug">{value}</p>
      </div>
    </motion.div>
  );
}

/* ─── TERMINAL ──────────────────────────────────────────────────────────────── */

function TerminalWindow() {
  return (
    <div className="relative w-full max-w-[500px]">
      <div className="absolute -inset-6 rounded-3xl bg-primary/8 blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-[#0d1117] card-premium">
        <div className="flex items-center gap-1.5 border-b border-white/5 bg-[#161b22]/80 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="size-2.5 rounded-full bg-[#28ca41]" />
          <div className="ml-auto flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-white/25 uppercase">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400/80" />
            Live Telemetry
          </div>
        </div>

        <div className="space-y-1.5 p-5 font-mono text-[11px] leading-relaxed text-white/45">
          <p><span className="text-[#79c0ff]">$</span> <span className="text-white/75">gitscope auth</span> <span className="text-white/25">-k ***</span></p>
          <p className="flex items-center gap-2"><span className="text-emerald-400">✓</span><span>connected to GitHub API</span></p>
          <p className="pt-1"><span className="text-[#79c0ff]">$</span> <span className="text-white/75">gitscope analyze</span> <span className="text-[#ffa657]">facebook/react</span></p>
          <p className="flex items-center gap-2"><span className="text-emerald-400">✓</span><span>3.4M lines indexed <span className="text-white/25">(840ms)</span></span></p>
          <p>computing velocity <span className="text-emerald-400">[====================]</span> 100%</p>
          <p>building clusters… <span className="animate-pulse text-primary">done</span></p>
          <p className="pt-1 text-primary font-semibold">» rendering dashboard<span className="cursor-blink">▌</span></p>
        </div>

        <div className="grid grid-cols-2 gap-px bg-white/5">
          <div className="bg-[#161b22] p-4">
            <p className="font-mono text-[8px] tracking-widest text-white/25 uppercase">Commit Velocity</p>
            <p className="font-heading text-2xl font-black text-tertiary">98.4%</p>
          </div>
          <div className="bg-[#161b22] p-4">
            <p className="font-mono text-[8px] tracking-widest text-white/25 uppercase">Health Score</p>
            <p className="font-heading text-2xl font-black text-emerald-400">A+</p>
          </div>
        </div>

        <div className="flex items-end gap-[3px] bg-[#0d1117] px-4 pb-4 pt-3 h-14">
          {[30,45,25,60,50,70,80,55,90,75,40,85,65,35,95].map((h, i) => (
            <div
              key={i}
              className="chart-bar flex-1 rounded-[2px] bg-primary/20 hover:bg-primary/50 transition-colors duration-200"
              // eslint-disable-next-line react/forbid-component-props
              style={{ "--h": `${h * 0.42}px` } as React.CSSProperties}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── FEATURE VISUALIZATIONS ────────────────────────────────────────────────── */

function MetricBar({ label, pct, value, colorClass, delay = 0 }: {
  label: string; pct: number; value: string; colorClass: string; delay?: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between font-mono text-[9px] text-foreground/45 uppercase tracking-widest">
        <span>{label}</span>
        <span className={colorClass}>{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-foreground/8 overflow-hidden">
        <div
          className={cn("h-full rounded-full bar-fill-animate", colorClass.replace("text-", "bg-"))}
          // eslint-disable-next-line react/forbid-component-props
          style={{ "--bar-w": `${pct}%`, "--bar-delay": `${delay}ms` } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

function RepoCompareViz() {
  return (
    <div className="rounded-xl border border-white/8 bg-[#0d1117] overflow-hidden w-full">
      <div className="flex divide-x divide-white/6">
        {[
          { name: "facebook/react",     sc: "220k", cc: "15.2k", hc: "A+", s: 85, c: 72, h: 94 },
          { name: "microsoft/vscode",   sc: "160k", cc: "9.8k",  hc: "A",  s: 62, c: 55, h: 89 },
        ].map((repo, i) => (
          <div key={i} className="flex-1 p-4 space-y-3">
            <p className="font-mono text-[9px] tracking-widest text-white/35 uppercase truncate">{repo.name}</p>
            <MetricBar label="Stars"   pct={repo.s} value={repo.sc} colorClass="text-primary"     delay={i * 100} />
            <MetricBar label="Commits" pct={repo.c} value={repo.cc} colorClass="text-tertiary"    delay={i * 100 + 150} />
            <MetricBar label="Health"  pct={repo.h} value={repo.hc} colorClass="text-emerald-400" delay={i * 100 + 300} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ContributorNetworkViz() {
  const nodes = [
    { x: 50, y: 18, r: 7,  color: "#7c8cf8", pulse: true },
    { x: 20, y: 48, r: 5,  color: "#34d399", pulse: false },
    { x: 80, y: 48, r: 5,  color: "#60a5fa", pulse: false },
    { x: 35, y: 78, r: 4,  color: "#7c8cf8", pulse: false },
    { x: 65, y: 78, r: 4,  color: "#34d399", pulse: false },
    { x: 50, y: 53, r: 3.5, color: "#60a5fa", pulse: false },
  ];
  const edges = [[0,1],[0,2],[0,5],[1,3],[2,4],[1,5],[2,5]];

  return (
    <svg viewBox="0 0 100 100" className="w-full h-44">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      {edges.map(([a, b], i) => (
        <line key={i}
          x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          stroke="rgba(124,140,248,0.18)" strokeWidth="0.6"
        />
      ))}
      {nodes.map((n, i) => (
        <g key={i} filter="url(#glow)">
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
  const weeks = 20;
  const days  = 7;

  // Stable seed so grid doesn't re-randomize on every render
  const grid = React.useMemo(() => {
    // Deterministic pseudo-random using a seeded sequence
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };
    return Array.from({ length: weeks }, () =>
      Array.from({ length: days }, () => {
        const v = rand();
        if (v > 0.85) return 4;
        if (v > 0.65) return 3;
        if (v > 0.4)  return 2;
        if (v > 0.2)  return 1;
        return 0;
      })
    );
  }, []);

  const colors = [
    "bg-outline-variant/30",
    "bg-primary/20",
    "bg-primary/45",
    "bg-primary/70",
    "bg-primary",
  ];

  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="inline-flex flex-col gap-1 min-w-max">
        {/* Label row */}
        <div className="flex gap-1 mb-1">
          {Array.from({ length: weeks }, (_, wi) => (
            <div key={wi} className="w-3 flex-shrink-0 flex items-center justify-center">
              {wi % 4 === 0 && (
                <span className="font-mono text-[7px] text-foreground/35">
                  {["Jan","Feb","Mar","Apr","May"][Math.floor(wi / 4)] ?? ""}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Grid: columns = weeks, rows = days */}
        <div className="flex gap-1">
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((level, di) => (
                <div
                  key={di}
                  className={cn(
                    "size-3 rounded-sm transition-all duration-200 hover:ring-1 hover:ring-primary/60 cursor-default flex-shrink-0",
                    colors[level]
                  )}
                  title={`${level} contributions`}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-2 justify-end">
          <span className="font-mono text-[8px] text-foreground/35">Less</span>
          {colors.map((c, i) => (
            <div key={i} className={cn("size-2.5 rounded-sm flex-shrink-0", c)} />
          ))}
          <span className="font-mono text-[8px] text-foreground/35">More</span>
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
          <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(124,140,248,0.1)" strokeWidth="6" />
          <circle cx="50" cy="50" r="38" fill="none"
            stroke="url(#health-grad)" strokeWidth="6"
            strokeDasharray={`${dash} ${circumference - dash}`} strokeLinecap="round"
          />
          <defs>
            <linearGradient id="health-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7c8cf8" />
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
          { label: "Complexity",    pct: 88, colorClass: "text-primary" },
          { label: "Coverage",      pct: 76, colorClass: "text-tertiary" },
          { label: "Dependencies",  pct: 94, colorClass: "text-emerald-400" },
          { label: "PR Hygiene",    pct: 91, colorClass: "text-primary" },
        ].map((m, i) => (
          <MetricBar key={i} label={m.label} pct={m.pct} value={`${m.pct}%`} colorClass={m.colorClass} delay={i * 120} />
        ))}
      </div>
    </div>
  );
}

function DoraViz() {
  const metrics = [
    { label: "Deploy Freq",  value: "Elite",   sub: "Multiple/day", tc: "text-emerald-400", bc: "#34d399", bar: 95 },
    { label: "Lead Time",    value: "< 1hr",   sub: "Median",       tc: "text-primary",     bc: "#7c8cf8", bar: 88 },
    { label: "MTTR",         value: "12min",   sub: "P50 recovery", tc: "text-blue-400",    bc: "#60a5fa", bar: 80 },
    { label: "Change Fail",  value: "1.2%",    sub: "30d window",   tc: "text-emerald-400", bc: "#34d399", bar: 98 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 w-full">
      {metrics.map((m, i) => (
        <div key={i} className="rounded-lg border border-foreground/10 bg-foreground/[0.03] p-3 space-y-1.5">
          <p className="font-mono text-[8px] tracking-widest text-foreground/45 uppercase">{m.label}</p>
          <p className={cn("font-heading text-lg font-black", m.tc)}>{m.value}</p>
          <p className="font-mono text-[9px] text-foreground/35">{m.sub}</p>
          <div className="h-1 rounded-full bg-foreground/8 overflow-hidden">
            <div
              className="h-full rounded-full bar-fill-animate"
              // eslint-disable-next-line react/forbid-component-props
              style={{ "--bar-w": `${m.bar}%`, "--bar-delay": `${i * 100}ms`, "--bar-color": m.bc } as React.CSSProperties}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeatureVisualization({ tabId }: { tabId: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={tabId}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-full"
      >
        {tabId === "compare"  && <RepoCompareViz />}
        {tabId === "clusters" && <ContributorNetworkViz />}
        {tabId === "heatmap"  && <HeatmapViz />}
        {tabId === "health"   && <CodeHealthViz />}
        {tabId === "ai"       && <DoraViz />}
      </motion.div>
    </AnimatePresence>
  );
}

/* ─── TESTIMONIAL CARD ──────────────────────────────────────────────────────── */

function TestimonialCard({ t, className }: { t: typeof TESTIMONIALS[number]; className?: string }) {
  const spotlight = useSpotlight();
  return (
    <div
      ref={spotlight.ref}
      {...spotlight.handlers}
      className={cn(
        "testimonial-card spotlight-card card-premium rounded-2xl p-6 space-y-5",
        spotlight.isLit && "is-lit",
        className
      )}
    >
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, j) => (
          <Star key={j} className="size-3.5 fill-amber-400 text-amber-400" />
        ))}
      </div>
      <blockquote className="text-sm leading-relaxed text-foreground/80">&ldquo;{t.quote}&rdquo;</blockquote>
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br text-[11px] font-black text-foreground",
          t.color
        )}>
          {t.initials}
        </div>
        <div>
          <p className="text-sm font-bold">{t.name}</p>
          <p className="text-xs text-muted-foreground">{t.role} · {t.company}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── FEATURE TABS SECTION ──────────────────────────────────────────────────── */

function FeatureTabsSection() {
  const [active, setActive] = useState(0);
  const spotlight = useSpotlight();
  const tab = FEATURE_TABS[active];
  const sectionRef = useRef<HTMLElement>(null);

  return (
    <section ref={sectionRef} className="py-28 border-t border-outline-variant/10 diagonal-lines">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 max-w-xl">
          <p className="font-mono text-[11px] tracking-widest text-primary uppercase mb-3">Capabilities</p>
          <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-[1.06]">
            Advanced{" "}
            <span className="bg-linear-to-r from-primary via-blue-400 to-tertiary bg-clip-text text-transparent">
              Engineering
            </span>{" "}
            Intelligence
          </h2>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-md">
            Every metric that matters to engineering leadership, surfaced in real-time.
          </p>
        </div>

        {/* Tab pills */}
        <div className="flex flex-wrap gap-2 mb-10">
          {FEATURE_TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2 font-mono text-[11px] tracking-widest uppercase transition-all duration-200",
                i === active
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  : "border border-outline-variant/20 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              )}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Main panel */}
        <div
          ref={spotlight.ref}
          {...spotlight.handlers}
          className={cn(
            "spotlight-card card-premium rounded-3xl border border-outline-variant/10 overflow-hidden",
            spotlight.isLit && "is-lit"
          )}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Left: text */}
            <div className="p-8 sm:p-10 flex flex-col justify-between gap-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab.id}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.28 }}
                  className="space-y-5"
                >
                  <h3 className="font-heading text-2xl sm:text-3xl font-black tracking-tight leading-snug">
                    {tab.headline}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed text-sm sm:text-base">{tab.body}</p>
                  <div className="flex flex-wrap gap-3">
                    {tab.stats.map((s) => (
                      <div key={s.label} className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest/50 px-4 py-2.5">
                        <p className="font-mono text-[9px] tracking-widest text-muted-foreground/50 uppercase">{s.label}</p>
                        <p className={cn("font-heading text-lg font-black", s.accent)}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <Link
                    href={tab.href}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:gap-3 transition-all duration-200"
                  >
                    Explore this feature <ArrowRight className="size-4" />
                  </Link>
                </motion.div>
              </AnimatePresence>

              {/* Step dots */}
              <div className="flex gap-2">
                {FEATURE_TABS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`View ${FEATURE_TABS[i].label} feature`}
                    onClick={() => setActive(i)}
                    className={cn(
                      "rounded-full transition-all duration-300",
                      i === active ? "w-6 h-2 bg-primary" : "w-2 h-2 bg-outline-variant/40 hover:bg-outline-variant"
                    )}
                  />
                ))}
              </div>
            </div>

            {/* Right: visualization */}
            <div className="border-t lg:border-t-0 lg:border-l border-outline-variant/10 bg-surface-container-lowest/30 p-8 sm:p-10 flex items-center justify-center min-h-64">
              <FeatureVisualization tabId={tab.id} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── MAIN ──────────────────────────────────────────────────────────────────── */

export function LandingPage() {
  const headingRef  = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const heroCtaRef  = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const statsRef    = useRef<HTMLElement>(null);
  const howRef      = useRef<HTMLElement>(null);
  const finalCtaRef = useRef<HTMLElement>(null);

  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.08, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tickerFn = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tickerFn);
    gsap.ticker.lagSmoothing(0);

    const ctx = gsap.context(() => {
      // ── Hero: orb + text parallax (scrubbed, via Lenis-aware GSAP ticker) ──
      if (heroRef.current) {
        gsap.to(".hero-orbs", {
          scrollTrigger: { trigger: heroRef.current, start: "top top", end: "bottom top", scrub: 1 },
          y: "35%",
          ease: "none",
        });
        gsap.to(".hero-text-parallax", {
          scrollTrigger: { trigger: heroRef.current, start: "top top", end: "bottom top", scrub: 1 },
          y: "18%",
          ease: "none",
        });
      }

      // ── Hero: word-by-word ──
      const words = headingRef.current?.querySelectorAll(".hero-word");
      if (words?.length) {
        gsap.from(words, { y: 52, opacity: 0, duration: 0.9, stagger: 0.07, ease: "power4.out", delay: 0.1 });
      }
      gsap.from(subtitleRef.current, { y: 28, opacity: 0, duration: 0.8, ease: "power3.out", delay: 0.55 });
      gsap.from(heroCtaRef.current,  { y: 22, opacity: 0, duration: 0.7, ease: "power3.out", delay: 0.72 });
      gsap.from(terminalRef.current, { y: 60, opacity: 0, duration: 1.1, ease: "power3.out", delay: 0.3 });

      // ── Stats ──
      gsap.from(".stat-item", {
        scrollTrigger: { trigger: statsRef.current, start: "top 80%" },
        y: 30, opacity: 0, duration: 0.7, stagger: 0.1, ease: "power3.out",
      });

      // ── Marquee section: reveal ──
      gsap.from(".marquee-section", {
        scrollTrigger: { trigger: ".marquee-section", start: "top 90%" },
        opacity: 0, duration: 0.8, ease: "power2.out",
      });

      // ── How it works: clip-path reveal (Cluma-style) ──
      gsap.from(".how-step", {
        scrollTrigger: { trigger: howRef.current, start: "top 72%" },
        clipPath: "inset(0 0 100% 0)",
        y: 24,
        opacity: 0,
        duration: 0.85,
        stagger: 0.18,
        ease: "power3.out",
      });

      // ── Testimonials: stagger scale-up ──
      gsap.from(".testimonial-item", {
        scrollTrigger: { trigger: ".testimonials-grid", start: "top 78%" },
        scale: 0.92,
        y: 40,
        opacity: 0,
        duration: 0.75,
        stagger: 0.14,
        ease: "power3.out",
      });

      // ── Final CTA: scale + opacity ──
      gsap.from(finalCtaRef.current, {
        scrollTrigger: { trigger: finalCtaRef.current, start: "top 85%" },
        scale: 0.94,
        opacity: 0,
        duration: 1.0,
        ease: "power3.out",
      });
    });

    return () => {
      ctx.revert();
      gsap.ticker.remove(tickerFn);
      lenis.destroy();
    };
  }, []);

  const heroWords: Array<{ text: string; gradient?: boolean }> = [
    { text: "The" },
    { text: "Engineer's" },
    { text: "True", gradient: true },
    { text: "Compass.", gradient: true },
  ];

  return (
    <div className="relative">
      <div className="noise-layer" />

      {/* ═══════════════ HERO ═══════════════ */}
      <section ref={heroRef} className="relative min-h-[calc(100vh-5.5rem)] flex items-center overflow-hidden gradient-mesh">
        <div className="hero-grid absolute inset-0 pointer-events-none" />

        {/* Parallax orbs — translated via GSAP scrub (.hero-orbs) */}
        <div className="hero-orbs pointer-events-none">
          <div className="gradient-orb orb-float absolute -top-48 -right-36 w-[700px] h-[700px] rounded-full bg-indigo-600 opacity-[0.07] blur-[130px]" />
          <div className="gradient-orb orb-float-alt absolute top-1/3 -left-48 w-[500px] h-[500px] rounded-full bg-amber-400 opacity-[0.05] blur-[110px]" />
          <div className="gradient-orb orb-float absolute bottom-0 right-1/3 w-[400px] h-[400px] rounded-full bg-emerald-500 opacity-[0.04] blur-[90px]" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-7xl px-6 py-20 lg:py-0">
          <div className="flex flex-col gap-14 lg:flex-row lg:items-center lg:gap-16">

            {/* Left — parallax upward on scroll via GSAP (.hero-text-parallax) */}
            <div className="hero-text-parallax max-w-xl space-y-7 lg:max-w-[520px]">
              <motion.span
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="inline-flex cursor-default items-center gap-2 rounded-full border border-tertiary/25 bg-tertiary/8 px-3 py-1 font-mono text-[10px] tracking-widest text-tertiary uppercase"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-tertiary" />
                v1.0.0 · Engineering Compass Active
              </motion.span>

              <div className="flex items-center gap-3">
                <NextImage src="/logo.png" width={48} height={48} alt="GitScope"
                  className="size-11 rounded-xl shadow-2xl shadow-primary/25 ring-1 ring-white/10"
                />
                <span className="font-heading text-2xl font-bold tracking-tighter uppercase">GitScope</span>
              </div>

              <h1 ref={headingRef}
                className="font-heading text-[2.8rem] sm:text-5xl lg:text-[3.8rem] font-black tracking-tight leading-[1.04]"
              >
                {heroWords.map((w, i) => (
                  <span key={i} className={cn(
                    "hero-word inline-block mr-[0.22em] last:mr-0",
                    w.gradient && "bg-linear-to-r from-primary via-blue-400 to-tertiary bg-clip-text text-transparent"
                  )}>
                    {w.text}
                  </span>
                ))}
              </h1>

              <p ref={subtitleRef} className="max-w-md text-base sm:text-lg leading-relaxed text-muted-foreground">
                High-fidelity telemetry for open-source codebases. Track commit velocity,
                surface DORA metrics, and dissect contributor clusters — instantly.
              </p>

              <div ref={heroCtaRef} className="flex flex-col sm:flex-row gap-3">
                <Link href="/guest"
                  className={cn(buttonVariants({ size: "lg" }),
                    "btn-gitscope-primary rounded-full px-8 font-bold shadow-xl glow-pulse w-full sm:w-auto justify-center"
                  )}
                >
                  <Search className="mr-2 size-4" />
                  Explore Repositories
                </Link>
                <Link href={ROUTES.login}
                  className={cn(buttonVariants({ variant: "outline", size: "lg" }),
                    "rounded-full px-8 border-white/10 hover:bg-white/5 w-full sm:w-auto justify-center"
                  )}
                >
                  <LogIn className="mr-2 size-4" />
                  Log In
                </Link>
              </div>
            </div>

            {/* Right: terminal + floating badges
                — terminal uses z-10, badges use z-20 so they always appear on top */}
            <div ref={terminalRef} className="hidden lg:flex flex-1 justify-end relative">
              {/* Badges — z-20 keeps them above the terminal (z-10) */}
              <FloatingBadge
                icon={<TrendingUp className="size-3.5" />}
                label="DORA Tier"
                value="Elite"
                delay={0}
                className="absolute -top-8 left-0 z-20"
              />
              <FloatingBadge
                icon={<Activity className="size-3.5" />}
                label="Commits/Day"
                value="247"
                delay={0.6}
                className="absolute top-1/2 -translate-y-1/2 -left-8 z-20"
              />
              <FloatingBadge
                icon={<Star className="size-3.5 fill-amber-400 text-amber-400" />}
                label="Health Score"
                value="A+"
                delay={1.2}
                className="absolute -bottom-6 right-12 z-20"
              />

              <div className="relative z-10">
                <Link href="/guest" className="block hover:scale-[1.015] transition-transform duration-500">
                  <TerminalWindow />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Animated background: floating data-flow SVG */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 w-full h-full opacity-[0.035] dark:opacity-[0.055]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="hex-grid" width="56" height="48.5" patternUnits="userSpaceOnUse" patternTransform="rotate(0)">
              <path
                d="M28 0 L56 16 L56 32.5 L28 48.5 L0 32.5 L0 16 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
                className="text-primary"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hex-grid)" />
        </svg>

        {/* Animated floating ring decorations */}
        <div className="pointer-events-none absolute left-[8%] top-[15%] size-3 rounded-full bg-primary/60 shadow-[0_0_16px_4px] shadow-primary/30">
          <div className="absolute inset-0 animate-ping ping-2-8s rounded-full bg-primary/40" />
        </div>
        <div className="pointer-events-none absolute right-[12%] top-[22%] size-2 rounded-full bg-tertiary/60 shadow-[0_0_12px_3px] shadow-tertiary/25">
          <div className="absolute inset-0 animate-ping ping-3-4s rounded-full bg-tertiary/40" />
        </div>
        <div className="pointer-events-none absolute left-[18%] bottom-[28%] size-2.5 rounded-full bg-blue-400/50 shadow-[0_0_14px_3px] shadow-blue-400/20">
          <div className="absolute inset-0 animate-ping ping-4-1s rounded-full bg-blue-400/35" />
        </div>

        {/* Animated SVG data-flow lines */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 w-full h-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="flow-line-1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="40%" stopColor="rgb(124,140,248)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <linearGradient id="flow-line-2" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="50%" stopColor="rgb(52,211,153)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          {/* Horizontal flow line */}
          <line x1="0" y1="38%" x2="100%" y2="38%" stroke="url(#flow-line-1)" strokeWidth="1">
            <animate attributeName="x1" values="-100%;200%" dur="8s" repeatCount="indefinite" />
            <animate attributeName="x2" values="0%;300%" dur="8s" repeatCount="indefinite" />
          </line>
          {/* Vertical flow line */}
          <line x1="72%" y1="0" x2="72%" y2="100%" stroke="url(#flow-line-2)" strokeWidth="1">
            <animate attributeName="y1" values="-100%;200%" dur="11s" repeatCount="indefinite" />
            <animate attributeName="y2" values="0%;300%" dur="11s" repeatCount="indefinite" />
          </line>
        </svg>

        {/* Bottom fade gradient — smooth transition into stats */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-linear-to-t from-background to-transparent pointer-events-none" />
      </section>

      {/* ═══════════════ STATS ═══════════════ */}
      <section ref={statsRef} className="relative border-y border-outline-variant/10 py-16 bg-background">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
            {STATS.map((s, i) => (
              <div key={s.label} className={cn("stat-item", i > 0 && "border-l border-outline-variant/10 pl-10")}>
                <StatCounter {...s} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ MARQUEE ═══════════════ */}
      <section className="marquee-section border-b border-outline-variant/10 py-10 overflow-hidden bg-background">
        <p className="text-center font-mono text-[10px] tracking-widest text-muted-foreground/40 uppercase mb-8">
          Trusted across every tech stack
        </p>
        <div className="relative">
          <div className="pointer-events-none absolute left-0 top-0 h-full w-28 bg-linear-to-r from-background to-transparent z-10" />
          <div className="pointer-events-none absolute right-0 top-0 h-full w-28 bg-linear-to-l from-background to-transparent z-10" />
          <div className="marquee-track flex gap-14 items-center w-max">
            {[...MARQUEE_TECHS, ...MARQUEE_TECHS].map((tech, i) => (
              <div key={i} className="flex items-center gap-2.5 opacity-30 hover:opacity-90 transition-opacity duration-300 cursor-default">
                <Icon icon={tech.icon} width={20} height={20} />
                <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">{tech.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ FEATURE TABS ═══════════════ */}
      <FeatureTabsSection />

      {/* ═══════════════ HOW IT WORKS — clip-path pinned ═══════════════ */}
      <section ref={howRef} className="relative border-t border-outline-variant/10 py-28 overflow-hidden">
        <div className="gradient-orb absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-indigo-600 opacity-[0.035] blur-[120px] pointer-events-none" />

        <div className="relative mx-auto max-w-7xl px-6">
          <div className="mb-14">
            <p className="font-mono text-[11px] tracking-widest text-primary uppercase mb-3">Process</p>
            <h2 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">How It Works</h2>
            <div className="mt-3 h-[2px] w-14 rounded-full bg-linear-to-r from-primary to-tertiary" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-12 sm:gap-10 relative">
            <div className="absolute hidden sm:block top-[22px] left-[calc(16.66%+1.5rem)] right-[calc(16.66%+1.5rem)] h-px">
              <div className="h-full w-full bg-linear-to-r from-primary/40 via-blue-400/25 to-tertiary/40" />
            </div>

            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="how-step relative space-y-5">
                <div className="relative z-10 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 border border-primary/15">
                  <MaterialIcon name={item.icon} size={22} className="text-primary" />
                </div>
                <div>
                  <span className="font-mono text-[9px] font-black tracking-widest text-primary/40 mb-2 block">{item.step}</span>
                  <h3 className="font-heading text-lg font-bold">{item.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ TESTIMONIALS ═══════════════ */}
      <section className="relative border-t border-outline-variant/10 py-28">
        {/* Decorative floating orb behind testimonials */}
        <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/[0.04] blur-[100px]" />
        <div className="pointer-events-none absolute left-0 bottom-0 w-[300px] h-[300px] rounded-full bg-tertiary/[0.04] blur-[80px]" />

        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-14 text-center">
            <p className="font-mono text-[11px] tracking-widest text-primary uppercase mb-3">Social Proof</p>
            <h2 className="font-heading text-3xl sm:text-4xl font-black tracking-tight">
              Trusted by Engineering Leaders
            </h2>
          </div>
          <div className="testimonials-grid grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <TestimonialCard key={i} t={t} className="testimonial-item" />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ FINAL CTA ═══════════════ */}
      <section ref={finalCtaRef} className="relative py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="gradient-border rounded-3xl">
            <div className="gradient-border-inner rounded-3xl">
              <div className="relative overflow-hidden rounded-3xl gradient-mesh px-8 py-24 text-center">
                <div className="gradient-orb absolute -top-20 -right-20 w-72 h-72 rounded-full bg-indigo-500 opacity-[0.13] blur-[80px] pointer-events-none" />
                <div className="gradient-orb absolute -bottom-16 -left-16 w-64 h-64 rounded-full bg-emerald-400 opacity-[0.09] blur-[70px] pointer-events-none" />

                <p className="relative font-mono text-[11px] tracking-widest text-primary uppercase mb-5">Get Started</p>
                <h2 className="relative font-heading text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight">
                  Architect Your Engineering
                  <br />
                  <span className="bg-linear-to-r from-primary via-blue-400 to-tertiary bg-clip-text text-transparent">
                    Intelligence Network.
                  </span>
                </h2>
                <p className="relative mx-auto mt-6 max-w-md text-base text-muted-foreground leading-relaxed">
                  World-class engineering teams use GitScope to optimize architectural drift
                  and delivery velocity with precision.
                </p>
                <div className="relative mt-10 flex flex-col sm:flex-row justify-center gap-4">
                  <Link href={ROUTES.login}
                    className={cn(buttonVariants({ size: "lg" }),
                      "btn-gitscope-primary rounded-full px-10 font-bold tracking-tight shadow-2xl shadow-primary/20 glow-pulse"
                    )}
                  >
                    Sign Up Free
                    <ChevronRight className="ml-1 size-4" />
                  </Link>
                  <Link href={ROUTES.pricing}
                    className={cn(buttonVariants({ variant: "outline", size: "lg" }),
                      "rounded-full border-primary/20 px-10 font-bold hover:bg-primary/5"
                    )}
                  >
                    View Pricing
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
