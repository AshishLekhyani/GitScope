"use client";

import { useState, useEffect } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DepNode {
  id: string;
  type: "repo" | "library";
  group: number;
}

interface DepLink {
  source: string;
  target: string;
  value: number;
}

interface DependencyData {
  nodes: DepNode[];
  links: DepLink[];
}

interface Advisory {
  id: number;
  severity: string;
  title: string;
  url: string;
  fixedIn: string;
}

interface VulnResult {
  package: string;
  advisories: Advisory[];
}

type AIState = "idle" | "loading" | "done" | "error";

interface DepAnalysis {
  riskSummary: string;
  supplyChainRisk: "low" | "medium" | "high" | "critical";
  topVulns: { pkg: string; action: string; urgency: "immediate" | "soon" | "planned" }[];
  hygiene: { recommendation: string; impact: string }[];
  licenseNote: string;
}

// ── Severity helpers ──────────────────────────────────────────────────────────

const SEV_STYLE: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  critical: { bg: "bg-red-500/10",    border: "border-red-500/25",    text: "text-red-400",    dot: "bg-red-400" },
  high:     { bg: "bg-orange-500/10", border: "border-orange-500/25", text: "text-orange-400", dot: "bg-orange-400" },
  moderate: { bg: "bg-amber-500/10",  border: "border-amber-500/25",  text: "text-amber-400",  dot: "bg-amber-400" },
  low:      { bg: "bg-surface-container/40", border: "border-outline-variant/20", text: "text-muted-foreground/60", dot: "bg-muted-foreground/40" },
};

function sevStyle(s: string) {
  return SEV_STYLE[s?.toLowerCase()] ?? SEV_STYLE.low;
}

// ── Risk score bar ────────────────────────────────────────────────────────────

function RiskBar({ count, max, color }: { count: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((count / max) * 100, 100) : 0;
  return (
    <div className="h-1 w-full rounded-full bg-surface-container-highest overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// ── Supply chain risk indicator ───────────────────────────────────────────────

function SupplyChainBadge({ risk }: { risk: DepAnalysis["supplyChainRisk"] }) {
  const map = {
    low:      { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25", icon: "verified_user", label: "Low Risk" },
    medium:   { color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/25",   icon: "shield",         label: "Medium Risk" },
    high:     { color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/25",  icon: "warning",        label: "High Risk" },
    critical: { color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/25",     icon: "gpp_bad",        label: "Critical Risk" },
  };
  const m = map[risk];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-wider", m.bg, m.border, m.color)}>
      <MaterialIcon name={m.icon} size={13} />
      {m.label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DependencyRadar({ repos }: { repos: string[] }) {
  const [data, setData] = useState<DependencyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done">("idle");
  const [scanResults, setScanResults] = useState<VulnResult[]>([]);
  const [scanError, setScanError] = useState("");
  const [aiState, setAiState] = useState<AIState>("idle");
  const [analysis, setAnalysis] = useState<DepAnalysis | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [expandedVuln, setExpandedVuln] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"deps" | "vulns" | "ai">("deps");

  useEffect(() => {
    if (repos.length === 0) return;
    setLoading(true);
    fetch(`/api/user/dependency-map?repos=${encodeURIComponent(repos.join(","))}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) { setData(d); setSelectedRepo(repos[0]); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [repos]);

  const handleSecurityScan = async () => {
    const allDeps = data?.nodes.filter((n) => n.type === "library").map((n) => n.id) ?? [];
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
      setActiveView("vulns");
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
      setScanState("idle");
    }
  };

  const fetchAIAnalysis = async () => {
    const primaryRepo = repos[0];
    if (!primaryRepo || aiState === "loading") return;
    setAiState("loading");
    setAnalysis(null);
    setAiError(null);

    const totalDeps   = data?.nodes.filter((n) => n.type === "library").length ?? 0;
    const vulnDetails = scanResults.length > 0
      ? scanResults.slice(0, 10).map((r) =>
          `${r.package}: ${r.advisories[0]?.severity ?? "unknown"} — ${r.advisories[0]?.title ?? "no title"} (fix: ${r.advisories[0]?.fixedIn ?? "unknown"})`
        ).join("\n")
      : "Security scan not yet run";

    const depList = data?.nodes.filter((n) => n.type === "library").slice(0, 30).map((n) => n.id).join(", ") ?? "";

    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: primaryRepo,
          question: `You are a supply chain security and dependency hygiene expert. Analyze this repository's dependency posture and return ONLY a JSON object (no markdown):

Repository: ${primaryRepo}
Total dependencies: ${totalDeps}
Dependency list (sample): ${depList}

Vulnerability scan results:
${vulnDetails}

Return this exact JSON:
{
  "riskSummary": "<2-3 sentence summary of the overall dependency risk posture — be specific about the repo's situation>",
  "supplyChainRisk": "<low|medium|high|critical based on vuln count, severity, and dep footprint>",
  "topVulns": [
    {
      "pkg": "<package name>",
      "action": "<specific concrete action: exact upgrade command or removal strategy>",
      "urgency": "<immediate|soon|planned>"
    }
  ],
  "hygiene": [
    {
      "recommendation": "<specific dependency hygiene improvement — name packages or patterns>",
      "impact": "<what risk or cost this eliminates>"
    }
  ],
  "licenseNote": "<note about any license risks or compliance considerations based on the package list>"
}

Include up to 5 topVulns (from most to least urgent) and 4 hygiene recommendations. Be specific — name actual packages and commands.`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "AI analysis failed");

      const raw = (json.analysis ?? "") as string;
      const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      const parsed = JSON.parse(cleaned) as DepAnalysis;
      setAnalysis(parsed);
      setAiState("done");
      setActiveView("ai");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI analysis failed");
      setAiState("error");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-48 gap-6 animate-pulse bg-surface-container/10 rounded-3xl border border-dashed border-outline-variant/10">
        <div className="size-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
          <MaterialIcon name="scatter_plot" size={32} className="text-indigo-500/30" />
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">Mapping Dependency Ecosystem</p>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-48 text-center bg-surface-container/10 rounded-3xl border-2 border-dashed border-outline-variant/10">
        <MaterialIcon name="hub" size={48} className="text-muted-foreground/10 mb-6" />
        <h4 className="text-xl font-bold">Dependency Map Unavailable</h4>
        <p className="text-sm text-muted-foreground/60 max-w-sm mx-auto mt-2 leading-relaxed">
          No library dependencies detected. Ensure the repositories contain a standard package.json or manifest file.
        </p>
      </div>
    );
  }

  const repoNodes = data.nodes.filter((n) => n.type === "repo");
  const libNodes  = data.nodes.filter((n) => n.type === "library");
  const activeLibs = selectedRepo
    ? data.links.filter((l) => l.source === selectedRepo).map((l) => l.target)
    : libNodes.map((n) => n.id);

  // Vulnerability lookup
  const vulnMap = new Map<string, VulnResult>(scanResults.map((r) => [r.package, r]));

  // Stats
  const criticalCount = scanResults.filter((r) => r.advisories[0]?.severity === "critical").length;
  const highCount     = scanResults.filter((r) => r.advisories[0]?.severity === "high").length;
  const modCount      = scanResults.filter((r) => ["moderate", "medium"].includes(r.advisories[0]?.severity ?? "")).length;
  const maxSevCount   = Math.max(criticalCount, highCount, modCount, 1);

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Header with stats + actions ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-5 rounded-3xl bg-surface-container/20 border border-outline-variant/10">
        <div className="flex-1 space-y-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
            <MaterialIcon name="radar" size={12} /> Dependency Radar
          </p>
          <p className="text-sm font-black text-foreground/85">
            {libNodes.length} packages · {data.links.length} connections · {repoNodes.length} repo{repoNodes.length !== 1 ? "s" : ""}
          </p>
          {scanState === "done" && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {criticalCount > 0 && (
                <span className="text-[9px] font-black text-red-400 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-red-400 inline-block" />
                  {criticalCount} critical
                </span>
              )}
              {highCount > 0 && (
                <span className="text-[9px] font-black text-orange-400 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-orange-400 inline-block" />
                  {highCount} high
                </span>
              )}
              {modCount > 0 && (
                <span className="text-[9px] font-black text-amber-400 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-amber-400 inline-block" />
                  {modCount} moderate
                </span>
              )}
              {scanResults.length === 0 && (
                <span className="text-[9px] font-black text-emerald-400 flex items-center gap-1">
                  <MaterialIcon name="verified_user" size={11} /> All clear
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button type="button" onClick={handleSecurityScan}
            disabled={scanState === "scanning" || libNodes.length === 0}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
              scanState === "scanning"
                ? "bg-amber-500/10 text-amber-400/50 border border-amber-500/20 cursor-not-allowed"
                : "bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20"
            )}>
            <MaterialIcon name={scanState === "scanning" ? "hourglass_top" : "security"} size={13}
              className={scanState === "scanning" ? "animate-spin" : ""} />
            {scanState === "scanning" ? "Scanning…" : scanState === "done" ? "Re-scan" : "Security Scan"}
          </button>
          <button type="button" onClick={fetchAIAnalysis}
            disabled={aiState === "loading"}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
              aiState === "loading"
                ? "bg-violet-500/10 text-violet-400/50 border border-violet-500/20 cursor-not-allowed"
                : "bg-violet-500 border-violet-500 text-white hover:bg-violet-600 shadow-md shadow-violet-500/20"
            )}>
            <MaterialIcon name={aiState === "loading" ? "hourglass_top" : "psychology"} size={13}
              className={aiState === "loading" ? "animate-spin" : ""} />
            {aiState === "loading" ? "Analyzing…" : "AI Analysis"}
          </button>
        </div>
      </div>

      {/* ── View tabs ── */}
      <div className="flex gap-1 p-1 bg-surface-container/30 rounded-2xl border border-outline-variant/10">
        {[
          { id: "deps" as const, label: "Dependencies", icon: "account_tree", count: libNodes.length },
          { id: "vulns" as const, label: "Vulnerabilities", icon: "security", count: scanResults.length, badge: criticalCount > 0 ? criticalCount : undefined },
          { id: "ai" as const, label: "AI Insights", icon: "psychology", count: undefined },
        ].map((tab) => (
          <button key={tab.id} type="button" onClick={() => setActiveView(tab.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all",
              activeView === tab.id ? "bg-indigo-500 text-white shadow-md" : "text-muted-foreground/60 hover:text-foreground"
            )}>
            <MaterialIcon name={tab.icon} size={12} />
            {tab.label}
            {tab.badge != null && (
              <span className="size-4 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center">
                {tab.badge}
              </span>
            )}
            {tab.count != null && tab.badge == null && (
              <span className="text-[8px] opacity-60">({tab.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Dependencies view ── */}
      {activeView === "deps" && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Repo selector */}
          {repoNodes.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              <button type="button" onClick={() => setSelectedRepo(null)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[9px] font-black transition-all",
                  selectedRepo === null
                    ? "bg-indigo-500 text-white border-indigo-500"
                    : "bg-surface-container/30 border-outline-variant/10 text-muted-foreground/60 hover:text-foreground"
                )}>
                <MaterialIcon name="hub" size={11} /> All repos
              </button>
              {repoNodes.map((n) => (
                <button key={n.id} type="button" onClick={() => setSelectedRepo(n.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[9px] font-black transition-all",
                    selectedRepo === n.id
                      ? "bg-indigo-500 text-white border-indigo-500"
                      : "bg-surface-container/30 border-outline-variant/10 text-muted-foreground/60 hover:text-foreground"
                  )}>
                  <MaterialIcon name="folder_zip" size={11} />
                  {n.id.split("/")[1]}
                  <span className="opacity-60">({data.links.filter((l) => l.source === n.id).length})</span>
                </button>
              ))}
            </div>
          )}

          {/* Dependency grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {activeLibs.slice(0, 48).map((libId) => {
              const vuln = vulnMap.get(libId);
              const topSev = vuln?.advisories[0]?.severity ?? null;
              const ss = topSev ? sevStyle(topSev) : null;
              return (
                <div key={libId}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all",
                    vuln
                      ? `${ss!.bg} ${ss!.border}`
                      : "bg-surface-container/20 border-outline-variant/8 hover:border-outline-variant/20"
                  )}>
                  <MaterialIcon name="package_2" size={14}
                    className={vuln ? ss!.text : "text-muted-foreground/40"} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[10px] font-bold truncate", vuln ? ss!.text : "text-foreground/75")}>{libId}</p>
                    {topSev && (
                      <p className={cn("text-[8px] font-black uppercase tracking-widest", ss!.text)}>{topSev}</p>
                    )}
                  </div>
                  {vuln && (
                    <span className={cn("size-2 rounded-full shrink-0", ss!.dot)} />
                  )}
                </div>
              );
            })}
            {activeLibs.length > 48 && (
              <div className="flex items-center justify-center px-3 py-2.5 rounded-xl border border-outline-variant/8 text-[10px] text-muted-foreground/40">
                +{activeLibs.length - 48} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Vulnerabilities view ── */}
      {activeView === "vulns" && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {scanState === "idle" && (
            <div className="flex flex-col items-center gap-4 py-12 text-center rounded-2xl border-2 border-dashed border-outline-variant/10">
              <MaterialIcon name="security" size={36} className="text-muted-foreground/20" />
              <div>
                <p className="text-sm font-black text-foreground/70">No scan run yet</p>
                <p className="text-xs text-muted-foreground/40 mt-1">Click "Security Scan" to query the npm advisory database for known CVEs in your dependencies.</p>
              </div>
            </div>
          )}

          {scanState === "scanning" && (
            <div className="flex items-center gap-3 py-8 justify-center animate-pulse">
              <div className="size-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
              <span className="text-xs text-muted-foreground/50">Querying npm advisory database…</span>
            </div>
          )}

          {scanError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/5 border border-red-500/10">
              <MaterialIcon name="error" size={14} className="shrink-0 text-red-400" />
              <p className="text-xs text-red-400">{scanError}</p>
            </div>
          )}

          {scanState === "done" && (
            <>
              {/* Severity summary */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Critical", count: criticalCount, color: "#ef4444" },
                  { label: "High",     count: highCount,     color: "#f97316" },
                  { label: "Moderate", count: modCount,      color: "#f59e0b" },
                  { label: "Total",    count: scanResults.length, color: "#6366f1" },
                ].map((s) => (
                  <div key={s.label} className="p-3 rounded-2xl bg-surface-container/30 border border-outline-variant/10 text-center space-y-1">
                    <p className="text-xl font-black" style={{ color: s.color }}>{s.count}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">{s.label}</p>
                    <RiskBar count={s.count} max={maxSevCount} color={s.color} />
                  </div>
                ))}
              </div>

              {scanResults.length === 0 ? (
                <div className="flex items-center gap-3 p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/15">
                  <MaterialIcon name="verified_user" size={24} className="text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-sm font-black text-emerald-400">All clear</p>
                    <p className="text-xs text-muted-foreground/50 mt-0.5">No known CVEs found in {libNodes.length} scanned packages.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {scanResults
                    .sort((a, b) => {
                      const order = ["critical", "high", "moderate", "low"];
                      return order.indexOf(a.advisories[0]?.severity ?? "low") - order.indexOf(b.advisories[0]?.severity ?? "low");
                    })
                    .map((vuln) => {
                      const topSev = vuln.advisories[0]?.severity ?? "low";
                      const ss = sevStyle(topSev);
                      const isExpanded = expandedVuln === vuln.package;
                      return (
                        <div key={vuln.package} className={cn("rounded-2xl border overflow-hidden", ss.bg, ss.border)}>
                          <button type="button" className="w-full flex items-center gap-3 px-4 py-3 text-left"
                            onClick={() => setExpandedVuln(isExpanded ? null : vuln.package)}>
                            <span className={cn("size-2 rounded-full shrink-0", ss.dot)} />
                            <span className={cn("text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0", ss.bg, ss.border, ss.text)}>
                              {topSev}
                            </span>
                            <span className="text-xs font-black text-foreground/85 flex-1">{vuln.package}</span>
                            <span className="text-[9px] text-muted-foreground/40 shrink-0">
                              {vuln.advisories.length} advisory{vuln.advisories.length !== 1 ? "ies" : ""}
                            </span>
                            <MaterialIcon name={isExpanded ? "expand_less" : "expand_more"} size={14} className="text-muted-foreground/40 shrink-0" />
                          </button>
                          {isExpanded && (
                            <div className="px-4 pb-4 space-y-3 border-t border-white/5 animate-in fade-in duration-150">
                              {vuln.advisories.map((adv) => {
                                const advSS = sevStyle(adv.severity);
                                return (
                                  <div key={adv.id} className="pt-3 space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={cn("text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border", advSS.bg, advSS.border, advSS.text)}>
                                        {adv.severity}
                                      </span>
                                      <span className="text-xs font-semibold text-foreground/80">{adv.title}</span>
                                    </div>
                                    {adv.fixedIn && (
                                      <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80">
                                        <MaterialIcon name="check_circle" size={12} />
                                        Fix available: <span className="font-mono font-bold">{adv.fixedIn}</span>
                                      </div>
                                    )}
                                    <a href={adv.url} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[10px] font-black text-indigo-400 hover:underline">
                                      View advisory <MaterialIcon name="open_in_new" size={10} />
                                    </a>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── AI Insights view ── */}
      {activeView === "ai" && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {aiState === "idle" && (
            <div className="flex flex-col items-center gap-4 py-12 text-center rounded-2xl border-2 border-dashed border-outline-variant/10">
              <MaterialIcon name="psychology" size={36} className="text-muted-foreground/20" />
              <div>
                <p className="text-sm font-black text-foreground/70">No AI analysis yet</p>
                <p className="text-xs text-muted-foreground/40 mt-1 max-w-xs mx-auto">
                  Click "AI Analysis" to get a structured dependency risk assessment, specific vulnerability remediation steps, and hygiene recommendations.
                </p>
              </div>
            </div>
          )}

          {aiState === "loading" && (
            <div className="flex items-center gap-3 py-8 justify-center animate-pulse">
              <div className="size-4 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
              <span className="text-xs text-muted-foreground/50">Evaluating dependency risk surface and supply chain posture…</span>
            </div>
          )}

          {aiState === "error" && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/5 border border-red-500/10">
              <MaterialIcon name="error" size={14} className="shrink-0 text-red-400" />
              <p className="text-[11px] text-red-400">{aiError}</p>
            </div>
          )}

          {aiState === "done" && analysis && (
            <div className="space-y-4 animate-in fade-in duration-400">
              {/* Risk header */}
              <div className="flex items-center justify-between p-4 rounded-2xl bg-surface-container/30 border border-outline-variant/10">
                <div className="space-y-0.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Supply Chain Risk Level</p>
                  <SupplyChainBadge risk={analysis.supplyChainRisk} />
                </div>
                <button type="button" onClick={fetchAIAnalysis}
                  className="flex items-center gap-1.5 text-[10px] font-black text-muted-foreground/40 hover:text-violet-400 transition-colors">
                  <MaterialIcon name="refresh" size={12} /> Re-analyze
                </button>
              </div>

              {/* Summary */}
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-violet-500/5 border border-violet-500/10">
                <MaterialIcon name="summarize" size={16} className="text-violet-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-violet-400/70 mb-1">Risk Assessment</p>
                  <p className="text-xs text-foreground/75 leading-relaxed">{analysis.riskSummary}</p>
                </div>
              </div>

              {/* Top vulnerabilities */}
              {analysis.topVulns?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 px-1">Remediation Plan</p>
                  {analysis.topVulns.map((v, i) => {
                    const urgencyStyle = {
                      immediate: "bg-red-500/10 border-red-500/20 text-red-400",
                      soon:      "bg-amber-500/10 border-amber-500/20 text-amber-400",
                      planned:   "bg-surface-container border-outline-variant/20 text-muted-foreground/60",
                    }[v.urgency];
                    return (
                      <div key={i} className="p-4 rounded-2xl bg-surface-container/30 border border-outline-variant/8 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black text-foreground/85">{v.pkg}</span>
                          <span className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ml-auto", urgencyStyle)}>
                            {v.urgency}
                          </span>
                        </div>
                        <p className="text-[11px] text-foreground/65 font-mono leading-relaxed">{v.action}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Hygiene recommendations */}
              {analysis.hygiene?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 px-1">Dependency Hygiene</p>
                  {analysis.hygiene.map((h, i) => (
                    <div key={i} className="flex items-start gap-3 p-4 rounded-2xl bg-surface-container/20 border border-outline-variant/8">
                      <MaterialIcon name="lightbulb" size={14} className="text-indigo-400/70 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="text-xs font-semibold text-foreground/80">{h.recommendation}</p>
                        <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                          <MaterialIcon name="shield" size={10} className="text-emerald-400/60" />
                          {h.impact}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* License note */}
              {analysis.licenseNote && (
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10">
                  <MaterialIcon name="gavel" size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-400/70 mb-1">License Considerations</p>
                    <p className="text-[11px] text-foreground/65 leading-relaxed">{analysis.licenseNote}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
