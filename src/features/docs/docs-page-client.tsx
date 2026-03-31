"use client";

import { MaterialIcon } from "@/components/material-icon";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

type Section = "getting-started" | "api" | "organizations" | "activity" | "search" | "insights" | "security";

const sections: { id: Section; label: string; icon: string }[] = [
  { id: "getting-started", label: "System Initialization", icon: "rocket_launch" },
  { id: "api", label: "Data Architecture & API", icon: "api" },
  { id: "organizations", label: "Organization Pulse", icon: "corporate_fare" },
  { id: "activity", label: "Activity Monitoring", icon: "bubble_chart" },
  { id: "search", label: "Advanced Search Syntax", icon: "travel_explore" },
  { id: "insights", label: "Analytics Methodology", icon: "analytics" },
  { id: "security", label: "Data Sovereignty", icon: "shield" },
];

const content: Record<Section, { title: string; subtitle: string; paragraphs: string[]; codeSnippet?: string; links?: { label: string; href: string }[] }> = {
  "getting-started": {
    title: "Deployment & System Initialization",
    subtitle: "Infrastructure setup and environment configuration for the GitScope analyst suite.",
    paragraphs: [
      "The GitScope engine is architected as a high-fidelity telemetry platform for decoding the global development ecosystem. To begin analysis, ensure your environment is configured for authenticated access.",
      "• Token Lifecycle: You must configure a GitHub Personal Access Token (classic or fine-grained) to elevate your retrieval quota from 60 to 5,000 requests per hour.",
      "• Environment Relay: Use the GITHUB_TOKEN key in your secure configuration. Our stateless relay ensures this token never leaves the server-side memory.",
      "• Dashboard Navigation: Use the TopNav to quickly switch between Personal Overview, Global Exploration, and technical documentation.",
      "• Real-time Reconciliation: All data is fetched directly from the GitHub source, ensuring zero-latency between a developer action and its appearance in your metrics.",
    ],
    codeSnippet: `# Secure Environment Configuration
GITHUB_TOKEN=ghp_6781290345678901234
NEXTAUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://root@gitscope-db:5432/main`,
    links: [{ label: "Configure API Access", href: "/settings" }],
  },
  organizations: {
    title: "Organization Pulse & Ecosystem Analysis",
    subtitle: "Macro-level intelligence for tracking entire development networks.",
    paragraphs: [
      "The Organization Pulse module provides a high-level view of engineering velocity across an entire GitHub organization. This is essential for competitive benchmarking and architectural due diligence.",
      "• Ecosystem Aggregation: Automatically indexes every repository under an organization to provide global star-counts, fork distributions, and language footprints.",
      "• Growth Velocity: Track the month-over-month growth of an organization's developer network and contributor diversity.",
      "• Health Distribution: Identify which repositories within an org are the true drivers of impact and which are becoming legacy technical debt.",
      "• Talent Flux: Monitor organization-wide contributor heatmaps to identify peak productivity windows of development teams.",
    ],
    links: [{ label: "Launch Organization Analysis", href: "/organizations" }],
  },
  activity: {
    title: "Continuous Activity Monitoring",
    subtitle: "Real-time telemetry of developer events and system notifications.",
    paragraphs: [
      "The Activity Log (Pulse) serves as your command center for tracking the heartbeat of your engineering world. It correlates disparate GitHub events into a unified, actionable stream.",
      "• Event Correlation: Merges Push events, Pull Request transitions, Shield-level security alerts, and Star distributions into a single interactive feed.",
      "• Historical Depth: While the default view focuses on the last 24 hours, you can utilize the 'Historical Analysis' feature to retrieve deep-timed telemetry.",
      "• Notification Filtering: Use specific event filters to focus on high-priority security transitions or core repository commit streams.",
      "• Live Signals: Integrated emerald-pulse markers indicate when the system is actively monitoring fresh hooks from the GitHub repository pool.",
    ],
    links: [{ label: "View Activity Pulse", href: "/activity" }],
  },
  search: {
    title: "Advanced Search & Discovery",
    subtitle: "Leveraging boolean logic and ecosystem signaling to find high-value targets.",
    paragraphs: [
      "The Exploration engine utilizes GitHub's advanced query syntax alongside custom GitScope filters to refine your repository discovery experience.",
      "• Boolean Targeting: Combine language (lang:), stars (stars:), and specific org (org:) filters with high precision logic.",
      "• Sorting Methodology: Repositories can be sorted by 'Impact', 'Authority', or 'Velocity'—moving beyond simple star counts.",
      "• Instant Persistence: Every repository you scan is intelligently indexed into your session's 'Recent History', allowing for instant re-access via the TopNav search bar.",
    ],
    links: [{ label: "Launch Explorer", href: "/search" }],
  },
  insights: {
    title: "Engineering Analytics & Methodology",
    subtitle: "Decoding the algorithms behind GitScope's repository health scoring.",
    paragraphs: [
      "Understanding our proprietary indices is critical for making informed architectural decisions. We move beyond vanity metrics to measure true engineering sustainability.",
      "• Authority Index: A comparative score based on ecosystem-wide signaling, PR cycle times, and fork-to-active-PR ratios.",
      "• Contributor Heatmaps: Temporal analysis of commit density that allows you to identify Crunch periods or team burnout risks.",
      "• Velocity Thresholds: We monitor for sudden drops in repository activity which often precede significant architectural drift or project abandonment.",
    ],
  },
  api: {
    title: "Data Interoperability & REST Architecture",
    subtitle: "Utilizing the GitScope internal relay for programmatic telemetry extraction.",
    paragraphs: [
      "Our backend exposes several secure high-performance endpoints that proxy the GitHub API while adding a caching and normalization layer.",
      "• Standard Responses: All endpoints return standardized JSON schemas, ensuring compatibility with your existing internal BI tools.",
      "• Rate Limit Shielding: Our relay automatically manages your token's quota, using intelligent pooling to maximize your operational uptime.",
      "• Secure Handshakes: All API communication is TLS 1.3 encrypted, with server-side token injection to prevent client-side leaks.",
    ],
    codeSnippet: `GET /api/github/repos/{owner}/{repo}/stats
{
  "impact_score": 88.4,
  "velocity": "+4.2%",
  "active_contributors": 24,
  "health_status": "Tactical-Grade"
}`,
  },
  security: {
    title: "Data Sovereignty & Zero Trust Security",
    subtitle: "How GitScope protects your architectural data and authentication tokens.",
    paragraphs: [
      "GitScope is built on a 'Security-First' philosophy, ensuring that your most sensitive engineering data remains under your absolute control.",
      "• Stateless Design: We do not persist your repository telemetry. Every analysis session is a fresh, real-time slice of the ecosystem.",
      "• Identity Isolation: We utilize NextAuth.js for secure session management, isolating your user identity from your repository scanning data.",
      "• SSO Integrated: Enterprise tiers support full OIDC/SAML integration for organizations requiring strict access control and auditing.",
    ],
  },
};

export interface DocsPageClientProps {
  variant?: "marketing" | "dashboard";
}

export function DocsPageClient({ variant = "marketing" }: DocsPageClientProps) {
  const [active, setActive] = useState<Section>("getting-started");
  const [searchQuery, setSearchQuery] = useState("");
  const isDashboard = variant === "dashboard";
  const data = content[active];

  const filteredSections = sections.filter(s => 
    s.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
    content[s.id].title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "mx-auto w-full",
        isDashboard ? "max-w-none space-y-8" : "max-w-7xl px-6 py-12"
      )}
    >
      {!isDashboard && (
        <div className="mb-10 text-center">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-5xl mb-4">
            Documentation
          </h1>
          <p className="text-muted-foreground mx-auto max-w-lg text-sm md:text-base font-medium">
            Guides, API reference, and feature walkthroughs for the GitScope engineering suite.
          </p>
        </div>
      )}

      {isDashboard && (
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500">
                Engineering Reference
              </span>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-500">
                <MaterialIcon name="menu_book" size={14} />
                <span className="text-[10px] uppercase font-bold tracking-widest">System Guides</span>
              </div>
            </h1>
            <p className="text-muted-foreground mt-1 text-sm font-medium">
              Technical documentation and architectural blueprints for the GitScope analyst platform.
            </p>
          </div>
          <div className="relative group max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground group-focus-within:text-indigo-500 transition-colors" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reference guides..."
              className="pl-10 pr-4 py-6 rounded-2xl bg-card border-border focus:ring-2 ring-indigo-500/20 font-medium"
            />
          </div>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <nav className="space-y-1">
          {filteredSections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm transition-all group",
                active === s.id
                  ? "bg-indigo-500/10 font-bold text-indigo-500 border border-indigo-500/20 shadow-lg shadow-indigo-500/5"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent"
              )}
            >
              <MaterialIcon 
                name={s.icon} 
                size={18} 
                className={cn(
                  "transition-colors",
                  active === s.id ? "text-indigo-500" : "text-muted-foreground group-hover:text-foreground"
                )} 
              />
              <span className="truncate tracking-tight">{s.label}</span>
            </button>
          ))}
          {filteredSections.length === 0 && (
            <div className="px-4 py-8 text-center border border-dashed border-border rounded-xl">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">No matching guides</p>
            </div>
          )}
        </nav>

        <motion.article
          key={active}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className="rounded-2xl p-8 lg:p-12 relative overflow-hidden border border-border bg-card"
        >
          <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
            <MaterialIcon name={sections.find(s => s.id === active)?.icon || "article"} size={160} />
          </div>

          <div className="relative z-10 max-w-3xl">
            <div className="mb-8">
              <h2 className="font-heading text-3xl font-black text-foreground uppercase tracking-tight">
                {data.title}
              </h2>
              <p className="mt-2 text-sm md:text-base text-muted-foreground font-medium italic">
                {data.subtitle}
              </p>
            </div>

            <div className="space-y-6">
              {data.paragraphs.map((p, i) => {
                const isBullet = p.startsWith("•");
                return (
                  <p 
                    key={i} 
                    className={cn(
                      "text-sm leading-relaxed",
                      isBullet 
                        ? "pl-6 relative before:absolute before:left-1 before:top-2 before:size-1.5 before:rounded-full before:bg-indigo-500/40 text-muted-foreground font-medium" 
                        : "text-foreground/90 font-bold"
                    )}
                  >
                    {isBullet ? p.substring(2) : p}
                  </p>
                );
              })}
            </div>

            {data.codeSnippet && (
              <div className="mt-10 space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <div className="size-2 rounded-full bg-indigo-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Technical Specification / Configuration</span>
                </div>
                <pre className="overflow-x-auto rounded-2xl border border-white/5 bg-[#0d152a] p-6 font-mono text-xs leading-relaxed text-emerald-400/90 shadow-2xl">
                  <code>{data.codeSnippet}</code>
                </pre>
              </div>
            )}

            {data.links && data.links.length > 0 && (
              <div className="mt-12 border-t border-border/50 pt-10">
                <div className="mb-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Ecosystem Integration Links</div>
                <div className="flex flex-wrap gap-4">
                  {data.links.map((l) => (
                    <Link
                      key={l.label}
                      href={l.href}
                      className="group inline-flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-6 py-3 text-xs font-black text-indigo-500 transition-all hover:bg-indigo-500/10 hover:border-indigo-500/40 shadow-sm"
                    >
                      {l.label}
                      <MaterialIcon name="arrow_forward" size={14} className="transition-transform group-hover:translate-x-1" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.article>
      </div>
    </motion.div>
  );
}
