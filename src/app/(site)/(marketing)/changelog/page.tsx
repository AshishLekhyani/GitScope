"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/material-icon";
import { Badge } from "@/components/ui/badge";

const UPDATES = [
  {
    version: "2.4.0",
    date: "March 2026",
    title: "The Intelligence Update",
    items: [
      { title: "Real-time BFCache Optimization", desc: "Engineered a custom navigation guard that prevents UI hydration cracks during rapid back/forward navigation.", icon: "sync" },
      { title: "Universal Command Palette", desc: "Access the entire platform via ⌘K. New shortcuts added for repository comparison and organization pulse.", icon: "terminal" },
      { title: "Enhanced Telemetry", desc: "Precise memory profiling for client-side Recharts components, improving dashboard performance by 40%.", icon: "analytics" },
    ],
    isLatest: true
  },
  {
    version: "2.3.5",
    date: "February 2026",
    title: "Edge Resilience Patch",
    items: [
      { title: "Middleware Hardening", desc: "Implemented Vary-Cookie headers to isolate user session states at the Edge layer.", icon: "security" },
      { title: "Source Explorer v2", desc: "Redesigned code navigation with a faster Monaco-based engine and better syntax highlighting.", icon: "code" },
    ],
    isLatest: false
  },
  {
    version: "2.2.0",
    date: "January 2026",
    title: "The Collaboration Engine",
    items: [
      { title: "Organization Pulse", desc: "A new top-level view for tracking contributor velocity across entire GitHub organizations.", icon: "corporate_fare" },
      { title: "Enterprise Pricing Tier", desc: "Role-based access control and custom benchmarking for large-scale engineering teams.", icon: "payments" },
    ],
    isLatest: false
  }
];

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-20 text-center">
        <Badge variant="outline" className="mb-4 border-indigo-500/30 text-indigo-400 px-4 py-1 rounded-full bg-indigo-500/5">
          SYSTEM UPDATES
        </Badge>
        <h1 className="font-heading text-4xl font-black tracking-tight sm:text-6xl text-white mb-6">
          Intelligence Evolved
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-slate-400">
          Tracking the trajectory of the GitScope ecosystem. From Edge resilience to AI-driven insights.
        </p>
      </div>

      <div className="relative space-y-12">
        {/* Continuous timeline line */}
        <div className="absolute left-0 sm:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-indigo-500/50 via-purple-500/20 to-transparent -translate-x-1/2 hidden sm:block" />

        {UPDATES.map((update, idx) => (
          <motion.div 
            key={update.version}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: idx * 0.1 }}
            className="relative"
          >
            {/* Logic for left/right positioning on desktop */}
            <div className={`flex flex-col sm:flex-row items-start gap-8 ${idx % 2 === 0 ? 'sm:flex-row-reverse' : ''}`}>
              
              {/* Content Card */}
              <div className="flex-1 w-full">
                <div className="p-8 rounded-3xl border border-white/5 bg-[#171f33]/80 shadow-2xl backdrop-blur-xl relative overflow-hidden group">
                   <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                      <MaterialIcon name="rocket_launch" size={120} />
                   </div>
                   
                   <div className="flex items-center gap-3 mb-4">
                      <span className="font-mono text-xs font-black tracking-widest text-indigo-400 bg-indigo-400/10 px-2 py-0.5 rounded">
                        v{update.version}
                      </span>
                      <span className="text-xs text-slate-500 font-bold uppercase tracking-tighter">
                        {update.date}
                      </span>
                   </div>

                   <h2 className="text-2xl font-black text-white mb-6 tracking-tight font-heading">
                      {update.title}
                   </h2>

                   <div className="space-y-6">
                      {update.items.map((item) => (
                        <div key={item.title} className="flex gap-4">
                           <div className="size-10 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                              <MaterialIcon name={item.icon} className="text-indigo-400" size={20} />
                           </div>
                           <div>
                              <h4 className="text-sm font-bold text-white mb-1">{item.title}</h4>
                              <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
                           </div>
                        </div>
                      ))}
                   </div>
                </div>
              </div>

              {/* Timeline Node */}
              <div className="hidden sm:flex items-center justify-center size-12 rounded-full border border-white/10 bg-slate-900 z-10 relative mt-8">
                 <div className={`size-3 rounded-full ${update.isLatest ? 'bg-indigo-500 animate-pulse shadow-[0_0_15px_rgba(99,102,241,1)]' : 'bg-slate-700'}`} />
              </div>

              {/* Spacer for empty side */}
              <div className="flex-1 hidden sm:block" />
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-24 p-12 rounded-3xl bg-indigo-600/10 border border-indigo-500/20 text-center">
         <h3 className="text-2xl font-black text-white mb-3">Staying Ahead</h3>
         <p className="text-slate-400 mb-8 max-w-lg mx-auto">
            GitScope is updated weekly with new telemetry insights and performance optimizations across the entire GitHub spectrum.
         </p>
         <div className="flex justify-center gap-4">
            <Badge variant="secondary" className="px-3 py-1 font-mono text-[10px]">NEXT UPDATE: MARCH 27</Badge>
            <Badge variant="secondary" className="px-3 py-1 font-mono text-[10px]">API STABILITY: 99.98%</Badge>
         </div>
      </div>
    </div>
  );
}
