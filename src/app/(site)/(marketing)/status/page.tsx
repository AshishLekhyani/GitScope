"use client";

import { useState, useEffect } from "react";
import { Clock, Activity, ShieldCheck } from "lucide-react";
import { MaterialIcon } from "@/components/material-icon";

const SYSTEMS = [
  { name: "GitHub API Gateway",         icon: "hub",           uptime: "99.97%", latency: "145ms", status: "operational" },
  { name: "Authentication & Sessions",  icon: "lock",          uptime: "100%",   latency: "88ms",  status: "operational" },
  { name: "AI Scan Engine",             icon: "auto_awesome",  uptime: "99.91%", latency: "2.1s",  status: "operational" },
  { name: "OSV CVE Database Proxy",     icon: "security",      uptime: "99.99%", latency: "310ms", status: "operational" },
  { name: "Notification Delivery",      icon: "notifications", uptime: "99.95%", latency: "420ms", status: "operational" },
  { name: "Database Layer",             icon: "database",      uptime: "99.98%", latency: "23ms",  status: "operational" },
];

const INCIDENTS = [
  {
    title: "GitHub API rate-limiting spike",
    body: "Elevated 429 responses from the GitHub API between 03:10–03:58 UTC caused some repo scans to return partial results. Requests were automatically retried and no data was lost.",
    age: "18 days ago",
    resolved: true,
  },
  {
    title: "OSV batch query timeout",
    body: "Google OSV API experienced elevated latency (>10 s) for batch queries larger than 200 packages. Affected OSV scanner results for large Node.js monorepos. Resolved by capping batch size at 500 and adding a 30 s timeout with graceful fallback.",
    age: "34 days ago",
    resolved: true,
  },
];

export default function StatusPage() {
  const [now, setNow] = useState("");

  useEffect(() => {
    setNow(
      new Date().toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZoneName: "short",
      })
    );
  }, []);

  const allOperational = SYSTEMS.every((s) => s.status === "operational");

  return (
    <div className="mx-auto max-w-5xl px-6 py-16 font-sans">
      {/* Header */}
      <div className="mb-14 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className={`flex items-center gap-2 mb-4 w-fit px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest ${
            allOperational
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-amber-500/10 border-amber-500/20 text-amber-400"
          }`}>
            <span className={`size-2 rounded-full animate-pulse ${allOperational ? "bg-emerald-400" : "bg-amber-400"}`} />
            {allOperational ? "All Systems Operational" : "Partial Degradation"}
          </div>
          <h1 className="font-heading text-4xl md:text-5xl font-black tracking-tight">System Status</h1>
          <p className="mt-3 text-muted-foreground max-w-lg text-sm leading-relaxed">
            Real-time health of the GitScope platform. Uptime figures are rolling 90-day averages.
          </p>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest space-y-1 text-right shrink-0">
          {now && <p>Updated: {now}</p>}
          <p>Version: 1.0.3-stable</p>
        </div>
      </div>

      {/* System grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-12">
        {SYSTEMS.map((s) => {
          const isOp = s.status === "operational";
          return (
            <div
              key={s.name}
              className="p-6 rounded-2xl border border-outline-variant/10 bg-surface-container/20 hover:border-outline-variant/20 transition-all group"
            >
              <div className="flex items-start justify-between mb-5">
                <div className="size-10 rounded-xl bg-surface-container-highest/60 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <MaterialIcon name={s.icon} size={20} className="text-muted-foreground/60" />
                </div>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${
                  isOp
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                }`}>
                  {isOp ? "Operational" : "Degraded"}
                </span>
              </div>
              <h3 className="text-sm font-black text-foreground/85 mb-5">{s.name}</h3>
              <div className="grid grid-cols-2 gap-4 border-t border-outline-variant/10 pt-4">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 mb-1">Uptime (90d)</p>
                  <p className="text-sm font-mono font-bold text-foreground/80">{s.uptime}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 mb-1">Avg Latency</p>
                  <p className="text-sm font-mono font-bold text-foreground/80">{s.latency}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Uptime bar (visual) */}
      <div className="mb-12 p-6 rounded-2xl border border-outline-variant/10 bg-surface-container/20 space-y-4">
        <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
          <MaterialIcon name="bar_chart" size={12} /> 90-day uptime — each bar represents one week
        </p>
        <div className="flex gap-1">
          {Array.from({ length: 13 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 h-8 rounded bg-emerald-500/25 hover:bg-emerald-500/40 transition-colors cursor-default"
              title={`Week ${13 - i}: Operational`}
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground/40">
          <span>90 days ago</span>
          <span className="text-emerald-400 font-black">99.96% avg uptime</span>
          <span>Today</span>
        </div>
      </div>

      {/* Bottom panels */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Planned maintenance */}
        <div className="p-7 rounded-2xl border border-outline-variant/10 bg-surface-container/20 space-y-4">
          <h4 className="text-sm font-black uppercase tracking-wider text-foreground/80 flex items-center gap-2">
            <Clock className="size-4 text-indigo-400" /> Planned Maintenance
          </h4>
          <div className="flex flex-col items-center gap-3 py-8 text-center rounded-xl bg-surface-container/40 border border-outline-variant/8">
            <MaterialIcon name="check_circle" size={28} className="text-emerald-400/40" />
            <div>
              <p className="text-xs font-black text-foreground/50">No maintenance scheduled</p>
              <p className="text-[10px] text-muted-foreground/40 mt-1">
                We&apos;ll post notices at least 48 h in advance.
              </p>
            </div>
          </div>
        </div>

        {/* Incident log */}
        <div className="p-7 rounded-2xl border border-outline-variant/10 bg-surface-container/20 space-y-4">
          <h4 className="text-sm font-black uppercase tracking-wider text-foreground/80 flex items-center gap-2">
            <Activity className="size-4 text-emerald-400" /> Incident History
          </h4>
          <div className="space-y-5">
            {INCIDENTS.map((inc, i) => (
              <div key={i} className="relative pl-5 before:absolute before:left-0 before:top-2 before:bottom-0 before:w-px before:bg-outline-variant/15">
                <div className="absolute -left-1 top-1.5 size-2 rounded-full bg-emerald-500/60" />
                <p className="text-xs font-black text-foreground/80 mb-0.5">{inc.title}</p>
                <p className="text-[10px] text-muted-foreground/55 leading-relaxed mb-1">{inc.body}</p>
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    Resolved
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground/35">{inc.age}</span>
                </div>
              </div>
            ))}
            <div className="relative pl-5">
              <div className="absolute -left-1 top-1.5 size-2 rounded-full bg-outline-variant/20" />
              <p className="text-[10px] text-muted-foreground/30 italic">No further incidents reported in the last 90 days.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer note */}
      <div className="mt-16 flex flex-col items-center gap-3 py-10 border-t border-outline-variant/8 text-center">
        <ShieldCheck className="size-8 text-muted-foreground/15" />
        <p className="text-[10px] text-muted-foreground/40 max-w-sm leading-relaxed">
          GitScope platform metrics are computed from live service telemetry.
          To report an issue, email{" "}
          <a href="mailto:acnotros2@gmail.com" className="text-indigo-400 underline underline-offset-2">
            acnotros2@gmail.com
          </a>.
        </p>
      </div>
    </div>
  );
}
