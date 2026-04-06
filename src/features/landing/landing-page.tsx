"use client";

import { buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";
import { motion } from "framer-motion";
import { Search, LogIn } from "lucide-react";
import Link from "next/link";
import NextImage from "next/image";
import { MaterialIcon } from "@/components/material-icon";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Register GSAP plugins
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

/* ---------- tiny reusable pieces ---------- */
function VersionBadge() {
  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="inline-flex cursor-default items-center gap-2 rounded-full border border-tertiary/30 bg-tertiary/10 px-3 py-1 font-mono text-[10px] tracking-widest text-tertiary uppercase">
          <span className="size-1.5 rounded-full bg-tertiary" />
          v1.0.0 · Engineering Compass Active
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>GitScope v1.0.0 — all systems operational</p>
      </TooltipContent>
    </Tooltip>
  );
}

function TerminalPreview() {
  return (
    <Tooltip>
      <TooltipTrigger>
        <Link
          href="/guest"
          className="block"
        >
          <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-outline-variant/20 bg-[#0d1117] shadow-2xl transition-transform hover:scale-[1.02]">
            <div className="flex items-center gap-1.5 border-b border-outline-variant/10 bg-[#161b22] px-3 py-2">
              <span className="size-2.5 rounded-full bg-red-400/60" />
              <span className="size-2.5 rounded-full bg-yellow-400/60" />
              <span className="size-2.5 rounded-full bg-green-400/60" />
              <span className="ml-auto flex items-center gap-2 font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                Live Telemetry
                <motion.span 
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="ml-1 h-3 w-1 bg-primary/40"
                />
              </span>
            </div>
            
            <div className="p-5 font-mono text-xs text-muted-foreground w-full space-y-2 bg-[#0d1117] leading-relaxed">
              <p><span className="text-secondary">gitscope</span> auth -k ***</p>
              <p><span className="text-emerald-400">success</span> securely connected to github API</p>
              <p><span className="text-secondary">gitscope</span> analyze open-source/facebook-react</p>
              <p><span className="text-emerald-400">success</span> 3.4M lines of code indexed (840ms)</p>
              <p>computing commit velocity [====================] 100%</p>
              <p>building knowledge clusters... <span className="animate-pulse text-primary">done</span></p>
              <p className="mt-4"><span className="text-primary font-bold">»</span> rendering dashboard elements</p>
            </div>

            <div className="grid grid-cols-2 gap-px bg-outline-variant/10">
              <div className="bg-[#161b22] p-4">
                <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                  System Velocity
                </p>
                <p className="font-heading text-2xl font-bold text-tertiary">
                  98.4%
                </p>
              </div>
              <div className="bg-[#161b22] p-4">
                <p className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                  Health Score
                </p>
                <p className="font-heading text-2xl font-bold text-emerald-400">
                  A+
                </p>
              </div>
            </div>
            <div className="flex items-end gap-1 bg-[#0d1117] px-4 pb-4 pt-3 h-15">
              {[30, 45, 25, 60, 50, 70, 80, 55, 90, 75, 40, 85, 65, 35, 95].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-primary/40 hover:bg-primary transition-colors cursor-pointer"
                  style={{ height: `${h * 0.5}px` }}
                />
              ))}
            </div>
          </div>
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        <p>Click to view a live dashboard demo →</p>
      </TooltipContent>
    </Tooltip>
  );
}

/* ---------- feature card data ---------- */
const features = [
  {
    icon: "⇆",
    title: "Repository Benchmarking",
    tooltip: "Side-by-side performance analysis of any two GitHub repositories",
    href: ROUTES.feature("repo-comparison"),
    body: "Perform high-fidelity cross-repository benchmarks to synchronize engineering standards across microservices.",
    stat1Label: "Protocol Efficiency",
    stat1Value: "Enterprise Ready",
    stat2Label: "Fleet Health",
    stat2Value: "Verified",
  },
  {
    icon: "✦",
    title: "Contributor Clusters",
    tooltip: "Visualize knowledge density and collaboration clusters within engineering teams",
    href: ROUTES.feature("contributor-insights"),
    body: "Identify knowledge silos and collaboration patterns. Prevent bottlenecks in your institutional knowledge architecture.",
  },
  {
    icon: "🛡",
    title: "Code Health Analysis",
    tooltip: "Deep-scan for structural vulnerabilities and pattern inconsistencies",
    href: ROUTES.feature("code-health"),
    body: "Deep-scan structural integrity and health distribution on every branch and merge request.",
    stat1Label: "Security Fleet",
    stat1Value: "SOC2 Compliance Ready",
  },
  {
    icon: "⟡",
    title: "AI Release Forecasting",
    tooltip: "Predictive ship dates based on complexity drifts and historical velocity",
    href: ROUTES.feature("release-forecasting"),
    body: "Augmented intelligence forecasting predicts delivery windows based on complex architectural drift.",
    stat1Label: "Enterprise Analytics",
    stat1Value: "High Confidence",
  },
];


/* ---------- main ---------- */
export function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const howItWorksRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const ctx = gsap.context(() => {
      // Features section - staggered card animations
      gsap.from(".feature-card", {
        scrollTrigger: {
          trigger: featuresRef.current,
          start: "top 80%",
          toggleActions: "play none none reverse"
        },
        y: 60,
        opacity: 0,
        duration: 0.8,
        stagger: 0.15,
        ease: "power3.out"
      });

      // How it works - slide in from left
      gsap.from(".how-it-works-step", {
        scrollTrigger: {
          trigger: howItWorksRef.current,
          start: "top 75%",
          toggleActions: "play none none reverse"
        },
        x: -40,
        opacity: 0,
        duration: 0.7,
        stagger: 0.2,
        ease: "power2.out"
      });

      // CTA section - scale in
      gsap.from(ctaRef.current, {
        scrollTrigger: {
          trigger: ctaRef.current,
          start: "top 85%",
          toggleActions: "play none none reverse"
        },
        scale: 0.9,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out"
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="relative z-10 mx-auto max-w-7xl px-6">
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 touch-pan-y bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(192,193,255,0.12),transparent)]" />

      {/* ───── HERO ───── */}
          <motion.section
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col gap-10 pt-8 pb-16 sm:pt-12 sm:pb-20 lg:flex-row lg:items-center lg:gap-16 lg:pt-20 lg:pb-28 min-h-[calc(100vh-8rem)] lg:min-h-0"
          >
            <div className="max-w-xl space-y-4 sm:space-y-6 lg:max-w-lg">
              <VersionBadge />
              <div className="flex items-center gap-3 sm:gap-4 mb-2">
                <NextImage 
                  src="/logo.png" 
                  width={48} 
                  height={48} 
                  alt="GitScope Logo" 
                  className="size-10 sm:size-12 rounded-xl shadow-2xl shadow-primary/20 ring-1 ring-white/10"
                />
                <span className="font-heading text-xl sm:text-2xl font-bold tracking-tighter text-foreground uppercase">GitScope</span>
              </div>
              <h1 className="font-heading text-3xl sm:text-4xl leading-[1.08] font-bold tracking-tight text-foreground md:text-5xl lg:text-6xl">
                The Engineer&apos;s
                <br />
                <span className="bg-linear-to-r from-tertiary to-emerald-300 bg-clip-text text-transparent">
                  True Compass.
                </span>
              </h1>
              <p className="text-muted-foreground max-w-md text-sm sm:text-base leading-relaxed md:text-lg">
                GitScope provides high-fidelity telemetry to understand complex open-source
                codebases. Gain deep architectural insights, track commit velocity, and
                dissect repository metrics instantly.
              </p>
              <div className="flex flex-col sm:flex-row flex-wrap gap-3">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href="/guest"
                        className={cn(
                          buttonVariants({ size: "lg" }),
                          "btn-gitscope-primary rounded-full px-6 sm:px-8 font-bold shadow-2xl shadow-primary/20 w-full sm:w-auto justify-center"
                        )}
                      >
                        <Search className="mr-2 size-4" />
                        Explore Repositories
                      </Link>
                    }
                  />
                  <TooltipContent>
                    Search open source telemetry
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href={ROUTES.login}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "lg" }),
                          "rounded-full px-6 sm:px-8 border-white/10 hover:bg-white/5 w-full sm:w-auto justify-center"
                        )}
                      >
                        <LogIn className="mr-2 size-4" />
                        Log In Now
                      </Link>
                    }
                  />
                  <TooltipContent>
                    Authenticate with your enterprise ID
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.1 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="hidden lg:block"
            >
              <TerminalPreview />
            </motion.div>
          </motion.section>

          {/* ───── FEATURES BENTO ───── */}
          <section ref={featuresRef} className="pb-24">
            <h2 className="font-heading text-xl sm:text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              Advanced Engineering Intelligence
            </h2>
            <div className="mt-1 h-1 w-10 rounded-full bg-primary" />

            <div className="mt-8 sm:mt-10 grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 touch-pan-y touch-pan-x overflow-x-auto sm:overflow-visible pb-4 sm:pb-0 snap-x snap-mandatory scrollbar-hide">
              {/* Repo Comparison — tall left */}
              <div className="feature-card row-span-1 sm:row-span-2 snap-start shrink-0 sm:shrink w-[85vw] sm:w-auto">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href={features[0].href}
                        className="card-royal flex flex-col justify-between p-4 sm:p-6 h-full min-h-50 sm:min-h-0"
                      />
                    }
                  >
                  <div>
                    <span className="text-xl">{features[0].icon}</span>
                    <h3 className="font-heading mt-3 text-base sm:text-lg font-bold text-foreground">
                      {features[0].title}
                    </h3>
                    <p className="text-muted-foreground mt-2 text-xs sm:text-sm leading-relaxed max-w-[200px]">
                      Benchmark any two public repositories side-by-side with high-fidelity metrics.
                    </p>
                  </div>
                  <div className="mt-4 sm:mt-6 space-y-2 rounded-lg bg-surface-container-lowest/40 p-2 sm:p-3 font-mono text-[9px] border border-white/5">
                    <div className="flex justify-between text-muted-foreground/60 tracking-widest">
                      <span>SYNC STATUS</span>
                      <span className="text-emerald-400">OPERATIONAL</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground/60">
                      <span>DATA LATENCY</span>
                      <span>{"<"} 240ms</span>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{features[0].tooltip}</TooltipContent>
                </Tooltip>
              </div>

              {/* Network Graphing */}
              <div className="feature-card snap-start shrink-0 sm:shrink w-[85vw] sm:w-auto">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href={features[1].href}
                        className="card-royal p-4 sm:p-6 block h-full"
                      />
                    }
                  >
                  <span className="text-xl">{features[1].icon}</span>
                  <h3 className="font-heading mt-3 text-base sm:text-lg font-bold text-foreground">
                    {features[1].title}
                  </h3>
                  <p className="text-muted-foreground mt-2 text-xs sm:text-sm leading-relaxed">
                    {features[1].body}
                  </p>
                </TooltipTrigger>
                <TooltipContent>{features[1].tooltip}</TooltipContent>
                </Tooltip>
              </div>

              {/* heatmap visual */}
              <div className="feature-card snap-start shrink-0 sm:shrink w-[85vw] sm:w-auto">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href={ROUTES.feature("contributor-heatmap")}
                        className="card-royal flex items-center justify-center p-4 sm:p-6 h-full min-h-35 sm:min-h-0"
                      />
                    }
                  >
                  <div className="grid grid-cols-8 gap-1">
                    {Array.from({ length: 40 }).map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "size-2.5 sm:size-3 rounded-sm",
                          i % 3 === 0
                            ? "bg-tertiary/70"
                            : i % 5 === 0
                              ? "bg-primary/40"
                              : "bg-surface-container-high"
                        )}
                      />
                    ))}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  View contributor heatmaps — click to try
                </TooltipContent>
                </Tooltip>
              </div>

              {/* Static Analysis */}
              <div className="feature-card snap-start shrink-0 sm:shrink w-[85vw] sm:w-auto">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href={features[2].href}
                        className="card-royal p-4 sm:p-6 block h-full"
                      />
                    }
                  >
                  <span className="text-xl">{features[2].icon}</span>
                  <h3 className="font-heading mt-3 text-base sm:text-lg font-bold text-foreground">
                    {features[2].title}
                  </h3>
                  <p className="text-muted-foreground mt-2 text-xs sm:text-sm leading-relaxed">
                    {features[2].body}
                  </p>
                  <div className="mt-3 sm:mt-4 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    <span className="font-heading text-base sm:text-lg font-bold text-primary">
                      A+
                    </span>
                    <span className="uppercase tracking-wider text-[9px] sm:text-[10px]">
                      Fleet Security Score Verified
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{features[2].tooltip}</TooltipContent>
                </Tooltip>
              </div>

              {/* Release Prediction */}
              <div className="feature-card snap-start shrink-0 sm:shrink w-[85vw] sm:w-auto">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href={features[3].href}
                        className="card-royal p-4 sm:p-6 block h-full"
                      />
                    }
                  >
                  <span className="text-xl">{features[3].icon}</span>
                  <h3 className="font-heading mt-3 text-base sm:text-lg font-bold text-foreground">
                    {features[3].title}
                  </h3>
                  <p className="text-muted-foreground mt-2 text-xs sm:text-sm leading-relaxed">
                    {features[3].body}
                  </p>
                  <div className="mt-3 sm:mt-4 flex items-center gap-2">
                    <span className="size-2 rounded-full bg-tertiary" />
                    <span className="font-mono text-[9px] sm:text-[10px] text-tertiary">
                      92% Confidence Interval
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{features[3].tooltip}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </section>

          {/* ── HOW IT WORKS ── */}
          <section ref={howItWorksRef} className="pb-24">
            <h2 className="font-heading text-xl sm:text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              How It Works
            </h2>
            <div className="mt-1 h-1 w-10 rounded-full bg-primary" />
            <div className="mt-8 sm:mt-10 flex gap-4 sm:gap-8 overflow-x-auto sm:grid sm:grid-cols-3 touch-pan-y touch-pan-x snap-x snap-mandatory scrollbar-hide pb-4 sm:pb-0">
              {[
                {
                  step: "01",
                  icon: "login",
                  title: "Create an Account",
                  body: "Sign up with email, Google, or GitHub. Connecting GitHub unlocks the full Intelligence Hub — AI metrics, PR risk, dependency radar.",
                },
                {
                  step: "02",
                  icon: "travel_explore",
                  title: "Search Any Repo",
                  body: "Type owner/repo in the search bar. GitScope fetches live data from the GitHub API — no setup, no cloning needed.",
                },
                {
                  step: "03",
                  icon: "psychology",
                  title: "Get Deep Insights",
                  body: "Analyze commit velocity, contributor clusters, language distribution, PR risk scores, and DORA metrics in seconds.",
                },
              ].map((item) => (
                <div key={item.step} className="how-it-works-step relative space-y-3 sm:space-y-4 snap-start shrink-0 w-[80vw] sm:w-auto sm:shrink">
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-[10px] font-black text-primary/40 tracking-widest">{item.step}</span>
                    <div className="h-px flex-1 bg-outline-variant/20" />
                  </div>
                  <div className="flex size-10 sm:size-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/10">
                    <MaterialIcon name={item.icon} size={20} className="sm:hidden text-primary" />
                    <MaterialIcon name={item.icon} size={24} className="hidden sm:block text-primary" />
                  </div>
                  <h3 className="font-heading text-base sm:text-lg font-bold text-foreground">{item.title}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section
            ref={ctaRef}
            className="mb-20 overflow-hidden rounded-2xl border border-primary/10 bg-linear-to-br from-primary/5 via-secondary/5 to-primary/10 px-4 py-12 sm:px-8 sm:py-16 text-center shadow-royal dark:from-indigo-900/80 dark:via-primary-container/60 dark:to-indigo-950/80"
          >
            <h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tighter text-foreground md:text-5xl dark:text-white">
              Architect Your Engineering
              <br />
              <span className="bg-linear-to-r from-primary to-emerald-400 bg-clip-text text-transparent dark:from-indigo-300 dark:to-emerald-300">
                Intelligence Network.
              </span>
            </h2>
            <p className="mx-auto mt-4 sm:mt-6 max-w-xl text-sm sm:text-base font-medium leading-relaxed text-muted-foreground dark:text-indigo-100/60">
              World-class teams use GitScope to optimize architectural drift and delivery velocity with precision.
            </p>
            <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row flex-wrap justify-center gap-3 sm:gap-4">
              <Link
                href={ROUTES.login}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "btn-gitscope-primary rounded-full px-6 sm:px-10 font-bold tracking-tight shadow-xl w-full sm:w-auto justify-center"
                )}
              >
                Sign Up Now
              </Link>
              <Link
                href={ROUTES.pricing}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "rounded-full border-primary/20 px-6 sm:px-10 font-bold transition-all hover:bg-primary/5 dark:border-white/20 dark:text-white dark:hover:bg-white/10 w-full sm:w-auto justify-center"
                )}
              >
                View Enterprise Pricing
              </Link>
            </div>
          </section>
        </div>
  );
}
