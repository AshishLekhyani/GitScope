"use client";

import { MaterialIcon } from "@/components/material-icon";
import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import Link from "next/link";

interface LogEntry {
  id: string;
  title: string;
  category: "Methodology" | "Updates" | "Analysis";
  date: string;
  readTime: string;
  abstract: string;
  icon: string;
  accent: string;
}

const entries: LogEntry[] = [
  {
    id: "architectural-drift",
    title: "Measuring Systemic Architectural Drift",
    category: "Methodology",
    date: "March 2026",
    readTime: "8 min",
    abstract: "How we utilize telemetry to identify structural erosion in microservices before they manifest as deployment failures.",
    icon: "architecture",
    accent: "text-primary",
  },
  {
    id: "telemetry-sovereignty",
    title: "The Case for Telemetry Sovereignty",
    category: "Analysis",
    date: "February 2026",
    readTime: "12 min",
    abstract: "Why modern engineering organizations are moving away from cached metrics toward real-time ecosystem signals.",
    icon: "security",
    accent: "text-tertiary",
  },
  {
    id: "v2-4-0-release",
    title: "GitScope v2.4.0: Cluster Visualization",
    category: "Updates",
    date: "January 2026",
    readTime: "5 min",
    abstract: "Introducing Knowledge Clusters—a proprietary graphing engine to visualize institutional knowledge density.",
    icon: "auto_graph",
    accent: "text-emerald-400",
  },
  {
    id: "contributor-velocity",
    title: "Normalizing Contributor Velocity",
    category: "Methodology",
    date: "December 2025",
    readTime: "10 min",
    abstract: "Moving beyond simple commit counts to measure sustained engineering throughput and team health.",
    icon: "speed",
    accent: "text-blue-400",
  },
];

export function BlogPageClient() {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-7xl px-6 py-12"
    >
      <div className="mb-12">
        <div className="flex items-center gap-2 mb-3">
          <span className="h-px w-8 bg-primary" />
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary">Intelligence Stream</span>
        </div>
        <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground md:text-5xl">
          The Engineer&apos;s Log
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
          Technical dispatches on telemetry methodology, architectural analysis, 
          and the future of engineering intelligence.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        {entries.map((entry, idx) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: idx * 0.1 }}
            className="card-royal group relative overflow-hidden p-8"
          >
            {/* Background highlight */}
            <div className="absolute top-0 right-0 -mr-16 -mt-16 size-48 rounded-full bg-primary/5 blur-3xl transition-all group-hover:bg-primary/10" />

            <div className="relative z-10">
              <div className="flex items-start justify-between">
                <div className={cn("flex size-12 items-center justify-center rounded-xl bg-surface-container-high border border-white/5", entry.accent)}>
                  <MaterialIcon name={entry.icon} size={24} />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-primary">
                    {entry.category}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 font-mono tracking-tight">
                    {entry.date} · {entry.readTime}
                  </span>
                </div>
              </div>

              <h2 className="mt-8 font-heading text-2xl font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
                {entry.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground/80">
                {entry.abstract}
              </p>

              <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-6">
                <Link 
                  href={ROUTES.docs} 
                  className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-all"
                >
                  Protocol Data
                  <MaterialIcon name="arrow_forward" size={14} />
                </Link>
                <div className="flex gap-2">
                   <div className="size-1.5 rounded-full bg-white/10" />
                   <div className="size-1.5 rounded-full bg-white/10" />
                   <div className="size-1.5 rounded-full bg-white/20" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Newsletter */}
      <div className="mt-20 rounded-3xl bg-[#0b1326] border border-white/5 p-8 md:p-12 text-center relative overflow-hidden">
         <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(192,193,255,0.05),transparent)]" />
         <div className="relative z-10 max-w-xl mx-auto">
            <h2 className="font-heading text-2xl font-bold text-white mb-4">
               Subscribe to Architectural Telemetry
            </h2>
            <p className="text-sm text-indigo-100/60 mb-8 leading-relaxed">
               Get monthly high-fidelity reports on ecosystem health and platform updates delivered directly to your tactical relay. No noise, just architecture.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
               <input 
                  type="email" 
                  placeholder="name@company.com"
                  className="flex-1 rounded-full bg-white/5 border border-white/10 px-6 py-3 text-sm text-white focus:ring-2 focus:ring-primary/50 outline-none"
               />
               <button className="btn-gitscope-primary rounded-full px-8 py-3 text-xs font-bold uppercase tracking-widest shadow-xl">
                  Connect Relay
               </button>
            </div>
            <p className="mt-6 text-[10px] text-muted-foreground/40 tracking-widest uppercase">
               Secured via SOC2 Certified Encryption
            </p>
         </div>
      </div>
    </motion.div>
  );
}
