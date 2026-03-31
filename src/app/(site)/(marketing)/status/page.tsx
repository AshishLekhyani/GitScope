"use client";

import { Clock, Activity, ShieldCheck, Zap } from "lucide-react";
import { MaterialIcon } from "@/components/material-icon";
import { motion } from "framer-motion";

export default function StatusPage() {
  const systems = [
    { name: "Universal Search Index", status: "Operational", uptime: "99.98%", latency: "142ms", icon: "search" },
    { name: "GitHub OAuth Protocol", status: "Operational", uptime: "100%", latency: "89ms", icon: "lock" },
    { name: "Repository Telemetry v3", status: "Operational", uptime: "99.95%", latency: "210ms", icon: "analytics" },
    { name: "Edge Middleware Router", status: "Operational", uptime: "100%", latency: "12ms", icon: "hub" },
    { name: "Benchmarking Engine", status: "Degraded", uptime: "98.4%", latency: "1.2s", icon: "speed" },
    { name: "Organization Insights", status: "Operational", uptime: "99.99%", latency: "156ms", icon: "corporate_fare" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-16 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
           <div className="flex items-center gap-2 mb-4 bg-emerald-500/10 border border-emerald-500/20 w-fit px-3 py-1 rounded-full">
              <div className="size-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,1)]" />
              <span className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">Global Systems Healthy</span>
           </div>
           <h1 className="font-heading text-4xl font-black tracking-tight sm:text-6xl text-white">System Health</h1>
           <p className="mt-4 text-slate-400 max-w-xl">Real-time diagnostics from the GitScope global intelligence network.</p>
        </div>
        <div className="text-right font-mono text-[10px] text-slate-500 uppercase tracking-[0.2em] space-y-1">
           <p>Last Pulse: Just Now</p>
           <p>Version: 2.4.0-Stable</p>
        </div>
      </div>

      {/* Main Status Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-12">
        {systems.map((s, i) => (
          <motion.div 
            key={i} 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="p-6 rounded-2xl border border-white/5 bg-[#171f33]/80 shadow-xl backdrop-blur-md hover:border-white/10 transition-all group"
          >
            <div className="flex items-start justify-between mb-6">
              <div className="size-10 rounded-xl bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                 <MaterialIcon name={s.icon} size={20} className="text-slate-400" />
              </div>
              <div className="text-right">
                 <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Status</p>
                 <span className={`text-[10px] font-bold px-2 py-0.5 rounded leading-none ${s.status === 'Operational' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                   {s.status}
                 </span>
              </div>
            </div>
            
            <h3 className="text-sm font-bold text-white mb-6">{s.name}</h3>
            
            <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-4">
               <div>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-tighter mb-1 select-none">Uptime (90d)</p>
                  <p className="text-sm font-mono text-slate-300">{s.uptime}</p>
               </div>
               <div>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-tighter mb-1 select-none">Avg Latency</p>
                  <p className="text-sm font-mono text-slate-300">{s.latency}</p>
               </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
         <div className="p-8 rounded-3xl border border-white/5 bg-slate-900/40">
            <h4 className="font-heading text-lg font-black text-white mb-6 uppercase tracking-wider flex items-center gap-2">
               <Clock className="size-5 text-indigo-400" /> Planned Maintenance
            </h4>
            <div className="space-y-4">
               <div className="flex gap-4 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
                  <div className="shrink-0 p-2 rounded-lg bg-indigo-500/20 text-indigo-400 h-fit">
                     <Zap className="size-4" />
                  </div>
                  <div>
                     <p className="text-sm font-bold text-white mb-1 tracking-tight">Database Migration (Primary Cluster)</p>
                     <p className="text-xs text-slate-400 mb-2 leading-relaxed">Optimization of query indexes to improve historical repo lookup performance.</p>
                     <p className="text-[9px] font-mono text-indigo-400/60 uppercase">Scheduled: March 24, 02:00 UTC</p>
                  </div>
               </div>
               <p className="text-[10px] text-slate-500 px-2 italic">Expect minor degredation (max 2m) during DNS switch.</p>
            </div>
         </div>

         <div className="p-8 rounded-3xl border border-white/5 bg-slate-900/40">
            <h4 className="font-heading text-lg font-black text-white mb-6 uppercase tracking-wider flex items-center gap-2">
               <Activity className="size-5 text-emerald-400" /> Incident Log
            </h4>
            <div className="space-y-6">
               <div className="relative pl-6 before:absolute before:left-0 before:top-2 before:bottom-0 before:w-px before:bg-white/10">
                  <div className="absolute left-[-4px] top-1.5 size-2 rounded-full bg-slate-700" />
                  <p className="text-xs font-bold text-slate-300 mb-1">Historical Search Lag</p>
                  <p className="text-[10px] text-slate-500 mb-2">Issue resolved. API rate-limiting thresholds were miscalibrated for high-velocity orgs.</p>
                  <span className="text-[9px] font-mono text-slate-600 uppercase">Resolved 4h 12m ago</span>
               </div>
               <div className="relative pl-6">
                  <div className="absolute left-[-4px] top-1.5 size-2 rounded-full bg-slate-700 opacity-20" />
                  <p className="text-xs font-bold text-slate-700">No further incidents reported</p>
               </div>
            </div>
         </div>
      </div>

      <div className="mt-16 flex flex-col items-center p-12 border-t border-white/5">
         <ShieldCheck className="size-12 text-slate-800 mb-4" />
         <p className="text-xs text-slate-500 text-center max-w-sm leading-relaxed">
            GitScope telemetry values are independently verified across 14 global nodes. <br/> 
            Data refreshed every 60 seconds.
         </p>
      </div>
    </div>
  );
}

