"use client";

import { motion } from "framer-motion";
import { useParams } from "next/navigation";
import { Network, Zap, ShieldCheck, Code2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------- Deterministic seeded PRNG (avoids SSR/client hydration mismatch) ---------- */
function seeded(i: number): number {
  const x = Math.sin(i + 1) * 10000;
  return x - Math.floor(x);
}

// Precomputed so the same values render on server and client
const HEATMAP_CELLS = Array.from({ length: 24 * 7 }, (_, i) => {
  const r = seeded(i);
  return r > 0.7 ? "bg-primary" : r > 0.5 ? "bg-primary/40" : r > 0.3 ? "bg-primary/10" : "bg-muted";
});

const FORECAST_BARS = Array.from({ length: 40 }, (_, i) => ({
  h: 20 + Math.sin(i * 0.5) * 40 + seeded(i + 200) * 20,
}));

/* ---------- Mock Visual Fragments ---------- */

function ComparisonMock() {
  return (
    <div className="space-y-8 p-12">
      <div className="flex items-center justify-between border-b border-border pb-8">
        <h2 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          Fleet Standard Benchmarking
        </h2>
        <div className="flex gap-4">
          <div className="bg-surface-container px-3 py-1.5 rounded-lg border border-primary/20 text-[10px] font-mono font-bold uppercase tracking-widest text-primary flex items-center gap-2">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            Live Benchmarking
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            <div className="size-2 rounded-full bg-primary" />
            Primary Repo: architecture-core-v3
          </div>
          <div className="h-[200px] flex items-end gap-1.5">
            {[40, 60, 45, 80, 55, 90, 75, 40, 85, 30, 65, 95].map((h, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{ duration: 1, delay: i * 0.05 }}
                className="flex-1 bg-primary/40 rounded-t-lg"
              />
            ))}
          </div>
          <div className="mt-6 flex justify-between text-[10px] font-mono font-bold uppercase text-muted-foreground border-t border-border pt-4">
            <span>Engineering Velocity</span>
            <span className="text-primary font-bold">+14.2%</span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            <div className="size-2 rounded-full bg-emerald-400" />
            Comparison: legacy-monolith-backup
          </div>
          <div className="h-[200px] flex items-end gap-1.5">
            {[80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25].map((h, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{ duration: 1, delay: i * 0.05 }}
                className="flex-1 bg-emerald-400/40 rounded-t-lg"
              />
            ))}
          </div>
          <div className="mt-6 flex justify-between text-[10px] font-mono font-bold uppercase text-muted-foreground border-t border-border pt-4">
            <span>Engineering Velocity</span>
            <span className="text-emerald-400 font-bold">-4.5%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ClustersMock() {
  return (
    <div className="space-y-8 p-12 flex flex-col items-center">
      <div className="text-center mb-8">
        <h2 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          Knowledge Cluster Topology
        </h2>
        <p className="text-muted-foreground mt-2 font-mono text-xs uppercase tracking-widest">
          Spatial collaboration density across engineering units
        </p>
      </div>

      <div className="relative size-[500px] rounded-full border border-border bg-surface-container shadow-inner flex items-center justify-center">
        {/* Mock network nodes */}
        <motion.div 
          animate={{ scale: [1, 1.05, 1], rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
          className="relative size-full"
        >
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
            <motion.div
              key={i}
              className="absolute left-1/2 top-1/2 size-12 rounded-2xl border border-primary/20 bg-primary/10 backdrop-blur-md shadow-lg flex items-center justify-center"
              style={{
                transform: `rotate(${angle}deg) translate(200px) rotate(-${angle}deg)`,
              }}
              whileHover={{ scale: 1.2, backgroundColor: "rgba(192, 193, 255, 0.3)" }}
            >
              <Users className="size-5 text-primary" />
            </motion.div>
          ))}
          {/* Edges simulated with svg */}
          <svg className="absolute inset-0 size-full pointer-events-none opacity-20">
            <circle cx="250" cy="250" r="200" fill="none" stroke="currentColor" strokeDasharray="5 5" />
            <line x1="250" y1="50" x2="250" y2="450" stroke="currentColor" />
            <line x1="50" y1="250" x2="450" y2="250" stroke="currentColor" />
          </svg>
        </motion.div>

        <div className="absolute size-24 rounded-full border border-primary/40 bg-primary/20 backdrop-blur-xl shadow-[0_0_40px_rgba(75,77,216,0.3)] flex items-center justify-center z-10">
          <Network className="size-10 text-primary animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function HeatmapMock() {
  return (
    <div className="p-12 space-y-10">
      <div className="flex items-end justify-between border-b border-border pb-8">
        <div>
          <h2 className="font-heading text-3xl font-bold tracking-tight text-foreground">
            Temporal Commit Density
          </h2>
          <p className="text-muted-foreground mt-2">Analysis of repository lifecycle peaks and structural gaps</p>
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map(l => (
            <div key={l} className={cn("size-3 rounded shadow-sm border border-border", 
              l === 1 ? "bg-primary/10" : l === 2 ? "bg-primary/30" : l === 3 ? "bg-primary/60" : "bg-primary") } />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-4">
        <div className="flex flex-col justify-between py-2 font-mono text-[9px] font-bold uppercase text-muted-foreground tracking-widest">
          <span>Mon</span>
          <span>Wed</span>
          <span>Fri</span>
        </div>
        <div className="grid grid-cols-24 gap-1.5 auto-rows-fr h-[200px]">
          {HEATMAP_CELLS.map((cls, i) => (
            <motion.div
              key={i}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.005 }}
              className={cn(
                "rounded-sm border border-border shadow-inner transition-colors hover:border-primary/50 cursor-default",
                cls
              )}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {[
          { label: "Cycle Velocity", value: "98.4%", icon: Zap },
          { label: "Temporal Gaps", value: "Zero Identified", icon: ShieldCheck },
          { label: "Active Nodes", value: "14.2k", icon: Code2 },
        ].map((stat, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 transition-all hover:bg-muted/50">
            <div className="flex items-center gap-3 mb-2">
              <stat.icon className="size-4 text-primary" />
              <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{stat.label}</span>
            </div>
            <div className="font-heading text-xl font-bold text-foreground">{stat.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthMock() {
  return (
    <div className="p-12 space-y-10">
      <div className="text-center space-y-2 mb-10">
        <h2 className="font-heading text-4xl font-bold tracking-tight text-foreground">
          System Structural Integrity
        </h2>
        <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Advanced code health indexing // SOC2-Compliance Ready</p>
      </div>

      <div className="mx-auto max-w-2xl space-y-6">
        {[
          { label: "Architectural Drift", score: 94, status: "Optimal" },
          { label: "Cyclomatic Complexity", score: 88, status: "A-" },
          { label: "Dependency Hygiene", score: 91, status: "High" },
          { label: "Pattern Consistency", score: 76, status: "Warning" },
        ].map((item, i) => (
          <div key={i} className="space-y-3">
            <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-wider">
              <span className="text-foreground">{item.label}</span>
              <span className={cn(item.score > 80 ? "text-primary" : "text-amber-500")}>{item.status} ({item.score}%)</span>
            </div>
            <div className="h-2 rounded-full bg-muted border border-border overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${item.score}%` }}
                transition={{ duration: 1.5, delay: i * 0.1, ease: "circOut" }}
                className={cn(
                  "h-full rounded-full transition-all",
                  item.score > 80 ? "bg-primary shadow-[0_0_10px_rgba(75,77,216,0.5)]" : "bg-amber-500 shadow-[0_0_10px_rgba(251,191,36,0.3)]"
                )}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ForecastingMock() {
  return (
    <div className="p-12 space-y-12 h-full flex flex-col justify-center">
      <div className="space-y-4">
        <h2 className="font-heading text-4xl font-bold tracking-tight text-foreground underline decoration-primary underline-offset-[12px]">
          AI Delivery Forecasting
        </h2>
        <p className="text-muted-foreground max-w-xl">
          Predictive ship windows calculated via historic velocity distribution and current complexity drift.
        </p>
      </div>

      <div className="relative rounded-2xl border border-border bg-card p-8 overflow-hidden shadow-sm">
         <div className="absolute inset-x-0 bottom-0 top-1/2 bg-linear-to-t from-primary/5 to-transparent" />
         
         <div className="relative z-10 flex items-end gap-1 h-[240px] border-b border-border">
            {FORECAST_BARS.map(({ h }, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{ duration: 1, delay: i * 0.02 }}
                className={cn("flex-1", i > 30 ? "bg-amber-400/40 opacity-50" : "bg-primary/40")}
              />
            ))}
            <div className="absolute left-[75%] top-0 bottom-0 w-px bg-amber-400/50 dashed-line flex flex-col items-center">
               <div className="bg-amber-400 text-background px-2 py-0.5 rounded text-[8px] font-bold font-mono tracking-tighter uppercase mb-2">Predicted drift</div>
            </div>
         </div>

         <div className="mt-8 flex items-center justify-between">
            <div className="flex gap-10">
               <div>
                  <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Forecast Model</p>
                  <p className="font-heading text-xl font-bold text-foreground">v1.0 Orion AI</p>
               </div>
               <div>
                  <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Target Window</p>
                  <p className="font-heading text-xl font-bold text-amber-500">Q4-2026 // Sept 12</p>
               </div>
            </div>
            <div className="flex flex-col items-end">
               <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Confidence Interval</p>
               <p className="font-heading text-3xl font-bold text-primary">92.4%</p>
            </div>
         </div>
      </div>
    </div>
  );
}

/* ---------- Main Renderer ---------- */

export default function DemoDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const renderContent = () => {
    switch (slug) {
      case "repo-comparison": return <ComparisonMock />;
      case "contributor-insights": return <ClustersMock />;
      case "contributor-heatmap": return <HeatmapMock />;
      case "code-health": return <HealthMock />;
      case "release-forecasting": return <ForecastingMock />;
      default: return (
        <div className="p-12 text-center space-y-6">
          <h2 className="text-3xl font-bold">Protocol Offline</h2>
          <p className="text-muted-foreground">The requested simulation simulation does not exist or is currently restricted.</p>
        </div>
      );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="size-full"
    >
      {renderContent()}
    </motion.div>
  );
}
