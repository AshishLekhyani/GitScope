"use client";

import { useState, useEffect } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface Node {
  id: string;
  type: "repo" | "library";
  group: number;
}

interface Link {
  source: string;
  target: string;
  value: number;
}

interface DependencyData {
  nodes: Node[];
  links: Link[];
}

export function DependencyRadar({ repos }: { repos: string[] }) {
  const [data, setData] = useState<DependencyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done">("idle");
  const [scanResults, setScanResults] = useState<{ package: string; advisories: { id: number; severity: string; title: string; url: string; fixedIn: string }[] }[]>([]);
  const [scanError, setScanError] = useState("");

  useEffect(() => {
    if (repos.length === 0) return;

    const fetchMap = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/user/dependency-map?repos=${encodeURIComponent(repos.join(","))}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchMap();
  }, [repos]);

  const handleSecurityScan = async () => {
    const allDeps = data?.nodes.filter(n => n.type === "library").map(n => n.id) ?? [];
    if (allDeps.length === 0 || scanState === "scanning") return;
    setScanState("scanning");
    setScanError("");
    setScanResults([]);
    try {
      const res = await fetch("/api/user/security-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deps: allDeps }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Scan failed");
      setScanResults(json.vulnerabilities ?? []);
      setScanState("done");
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
      setScanState("idle");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-48 gap-6 animate-pulse bg-surface-container/10 rounded-3xl border border-dashed border-outline-variant/10">
         <div className="size-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
            <MaterialIcon name="scatter_plot" size={32} className="text-indigo-500/30" />
         </div>
         <div className="text-center space-y-2">
            <p className="text-[10px] font-black font-sans uppercase tracking-[0.2em] text-muted-foreground/40">
               Mapping Recursive Ecosystem
            </p>
            <div className="text-xs font-bold text-muted-foreground/20">Traversing package.json & dependency nodes...</div>
         </div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-48 text-center bg-surface-container/10 rounded-3xl border-2 border-dashed border-outline-variant/10 group">
         <MaterialIcon name="hub" size={48} className="text-muted-foreground/10 mb-6 group-hover:scale-110 transition-transform" />
         <h4 className="text-xl font-bold">Dependency Map Unavailable</h4>
         <p className="text-sm text-muted-foreground/60 max-w-sm mx-auto mt-2 italic leading-relaxed">
           No library dependencies detected for the selected repositories. Ensure the repositories contain a standard `package.json` or manifest file.
         </p>
      </div>
    );
  }

  const repoNodes = data.nodes.filter(n => n.type === "repo");
  const filteredLibraries = selectedNode 
    ? data.links.filter(l => l.source === selectedNode).map(l => l.target)
    : data.nodes.filter(n => n.type === "library").slice(0, 15).map(n => n.id);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
      {/* Repo Selection Sidebar */}
      <div className="space-y-4">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 px-2">Workspace Nodes</h4>
        <div className="flex flex-col gap-1">
          {repoNodes.map(node => (
            <button
              key={node.id}
              onClick={() => setSelectedNode(node.id === selectedNode ? null : node.id)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-2xl border transition-all text-left group",
                selectedNode === node.id 
                  ? "bg-indigo-500 border-indigo-500 text-white shadow-lg" 
                  : "bg-surface-container/30 border-outline-variant/10 hover:bg-surface-container-highest/50"
              )}
            >
              <MaterialIcon name="folder_zip" size={20} className={selectedNode === node.id ? "text-white" : "text-indigo-500/50"} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold truncate tracking-tight">{node.id.split("/")[1]}</div>
                <div className="text-[10px] opacity-60 truncate">Impact: **{data.links.filter(l => l.source === node.id).length} libraries**</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Dependency Impact Visualization */}
      <div className="md:col-span-3 bg-surface-container/30 border border-outline-variant/10 rounded-3xl p-8 min-h-[500px] relative overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-8 relative z-10">
          <div>
            <h3 className="text-xl font-bold flex items-center gap-3">
               <MaterialIcon name="radar" size={24} className="text-indigo-500" />
               Impact Blast Radius
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              Visualizing the cascading dependency graph of your selected repositories.
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/5 border border-emerald-500/10 text-[10px] font-black text-emerald-500 uppercase tracking-tighter">
             <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
             Live Node Map
          </div>
        </div>

        {/* Mocking a Graph Visualization with CSS Grid / Framer Motion */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="relative w-full max-w-2xl aspect-square flex items-center justify-center">
            {/* Center Node */}
            <motion.div 
               layout
               className="relative z-20 size-24 rounded-full bg-indigo-500 flex items-center justify-center text-white shadow-[0_0_50px_rgba(99,102,241,0.5)] border-4 border-white dark:border-slate-800"
            >
               <div className="text-center">
                  <MaterialIcon name={selectedNode ? "folder_zip" : "hub"} size={32} />
                  <div className="text-[9px] font-black mt-1 px-2 truncate w-24">
                     {selectedNode ? selectedNode.split("/")[1] : "Workspace"}
                  </div>
               </div>
            </motion.div>

            {/* Orbital Nodes (Libraries) */}
            <AnimatePresence mode="popLayout">
              {filteredLibraries.map((libId, idx) => {
                const angle = (idx / filteredLibraries.length) * 2 * Math.PI;
                const radius = 180;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;

                const npmUrl = `https://www.npmjs.com/package/${libId}`;
                return (
                  <motion.a
                    key={libId}
                    href={npmUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                    animate={{ opacity: 1, scale: 1, x, y }}
                    exit={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                    transition={{ type: "spring", stiffness: 100, damping: 15, delay: idx * 0.05 }}
                    className="absolute z-10 group cursor-pointer"
                    title={`View ${libId} on npm`}
                  >
                    {/* Link Line */}
                    <div
                      className="absolute left-1/2 top-1/2 -z-10 origin-left h-px bg-gradient-to-r from-indigo-500/50 to-transparent opacity-30"
                      style={{
                        transform: `rotate(${angle + Math.PI}rad)`,
                        width: `${radius}px`
                      }}
                    />

                    <div className="flex flex-col items-center gap-2">
                       <div className="size-10 rounded-xl bg-surface-container border border-outline-variant/20 shadow-xl flex items-center justify-center group-hover:scale-110 group-hover:bg-indigo-500 transition-all duration-300 group-hover:text-white">
                          <MaterialIcon name="package_2" size={18} />
                       </div>
                       <div className="text-[9px] font-bold text-muted-foreground bg-surface-container/80 backdrop-blur px-2 py-0.5 rounded-full border border-outline-variant/10 whitespace-nowrap shadow-sm group-hover:text-indigo-500 group-hover:border-indigo-500/30 transition-colors">
                          {libId} ↗
                       </div>
                    </div>
                  </motion.a>
                );
              })}
            </AnimatePresence>
            
            {/* Background Orbits */}
            <div className="absolute inset-0 border border-outline-variant/5 rounded-full scale-[0.6] pointer-events-none" />
            <div className="absolute inset-0 border border-outline-variant/5 rounded-full scale-[1] pointer-events-none" />
            <div className="absolute inset-0 border border-outline-variant/5 rounded-full scale-[1.4] pointer-events-none" />
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-outline-variant/10 pt-6 px-2">
           <div className="flex items-center gap-4">
              <div className="flex -space-x-2">
                 {repoNodes.slice(0, 3).map(r => (
                    <div key={r.id} className="size-6 rounded-full border-2 border-background bg-slate-200 flex items-center justify-center text-[8px] font-black uppercase">
                       {r.id.split("/")[1][0]}
                    </div>
                 ))}
                 {repoNodes.length > 3 && (
                    <div className="size-6 rounded-full border-2 border-background bg-slate-800 text-white flex items-center justify-center text-[8px] font-black">
                       +{repoNodes.length - 3}
                    </div>
                 )}
              </div>
              <p className="text-[10px] text-muted-foreground font-bold italic">
                 Analyzing {data.links.length} cross-repository connections.
              </p>
           </div>
           
           <button
             type="button"
             onClick={handleSecurityScan}
             disabled={scanState === "scanning" || !data || data.nodes.filter(n => n.type === "library").length === 0}
             className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-indigo-600 font-black text-[10px] uppercase tracking-widest shadow-xl hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
           >
              {scanState === "scanning" ? "Scanning…" : "Run Security Simulation"}
              <MaterialIcon name={scanState === "scanning" ? "hourglass_top" : "bolt"} size={14} />
           </button>
        </div>
      </div>

      {/* Security Scan Results */}
      {(scanState === "scanning" || scanState === "done" || scanError) && (
        <div className="mt-6 rounded-3xl border border-outline-variant/10 bg-surface-container/30 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold flex items-center gap-2">
              <MaterialIcon name="security" size={18} className="text-amber-500" />
              Security Vulnerability Report
            </h4>
            {scanState === "done" && (
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                {scanResults.length === 0 ? "No vulnerabilities found" : `${scanResults.length} vulnerable package${scanResults.length > 1 ? "s" : ""} detected`}
              </span>
            )}
          </div>

          {scanState === "scanning" && (
            <div className="flex items-center gap-3 text-muted-foreground/60 animate-pulse py-4">
              <div className="size-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
              <span className="text-xs font-bold">Querying npm advisory database…</span>
            </div>
          )}

          {scanError && (
            <p className="text-xs text-destructive font-medium">{scanError}</p>
          )}

          {scanState === "done" && scanResults.length === 0 && (
            <div className="flex items-center gap-3 py-4">
              <MaterialIcon name="verified_user" size={24} className="text-emerald-500" />
              <div>
                <p className="text-sm font-bold text-emerald-500">All clear</p>
                <p className="text-xs text-muted-foreground">No known vulnerabilities found in your npm dependencies.</p>
              </div>
            </div>
          )}

          {scanState === "done" && scanResults.length > 0 && (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {scanResults.map((vuln) => (
                <div key={vuln.package} className="rounded-2xl border border-outline-variant/10 bg-surface-container/50 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-foreground">{vuln.package}</span>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                      vuln.advisories[0]?.severity === "critical" ? "bg-red-500/10 text-red-500" :
                      vuln.advisories[0]?.severity === "high" ? "bg-orange-500/10 text-orange-500" :
                      "bg-amber-500/10 text-amber-500"
                    }`}>
                      {vuln.advisories[0]?.severity ?? "moderate"}
                    </span>
                  </div>
                  {vuln.advisories.slice(0, 2).map((adv) => (
                    <div key={adv.id} className="text-xs text-muted-foreground space-y-1">
                      <p className="font-medium">{adv.title}</p>
                      <p className="text-[10px]">{adv.fixedIn}</p>
                      <a href={adv.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline">
                        View advisory ↗
                      </a>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
