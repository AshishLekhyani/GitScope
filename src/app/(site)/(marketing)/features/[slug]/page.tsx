"use client";

import { motion } from "framer-motion";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, BarChart3, ShieldCheck, Zap, Network } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ComponentType } from "react";

const FEATURE_CONTENT: Record<string, {
  title: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  valueProp: string;
  details: string[];
  exampleLabel: string;
  exampleData: { label: string; value: string }[];
  demoTarget: string;
}> = {
  "repo-comparison": {
    title: "Repository Benchmarking",
    icon: BarChart3,
    description: "Compare architectural performance and delivery health across multiple tech stacks.",
    valueProp: "Synchronize engineering standards across diverse microservices and legacy monolithic builds with high-fidelity telemetry.",
    details: [
      "Side-by-side growth velocity analysis",
      "Dependency drift and health scoring",
      "Commit density comparisons across teams",
      "Automated CI/CD success rate benchmarking"
    ],
    exampleLabel: "Benchmark Efficiency",
    exampleData: [
      { label: "Data Latency", value: "< 240ms" },
      { label: "Sync Status", value: "Operational" },
      { label: "Protocol Integrity", value: "99.9%" }
    ],
    demoTarget: "/demo/repo-comparison"
  },
  "contributor-insights": {
    title: "Contributor Clusters",
    icon: Network,
    description: "Visualize collaboration density and knowledge distribution across your engineering unit.",
    valueProp: "Identify mission-critical knowledge silos and collaboration patterns before they become operational bottlenecks.",
    details: [
      "Graphical knowledge density mapping",
      "Collaboration frequency and cluster analysis",
      "Social network bridging metrics",
      "Expertise distribution tracking"
    ],
    exampleLabel: "Knowledge Density",
    exampleData: [
      { label: "Cluster Depth", value: "Level 4" },
      { label: "Silo RiskScore", value: "Low" },
      { label: "Expert Bridges", value: "14 Nodes" }
    ],
    demoTarget: "/demo/contributor-insights"
  },
  "code-health": {
    title: "Code Health Analysis",
    icon: ShieldCheck,
    description: "Deep-scan structural integrity and architectural health with automated static analysis.",
    valueProp: "Surface structural vulnerabilities and pattern inconsistencies on every branch and merge request with SOC2-ready protocols.",
    details: [
      "Automated architectural drift detection",
      "Static code health scoring (SOC2 Ready)",
      "Language distribution and entropy tracking",
      "Security fleet verification"
    ],
    exampleLabel: "Health Matrix",
    exampleData: [
      { label: "Security Score", value: "A+" },
      { label: "Entropy Index", value: "Optimal" },
      { label: "Vulnerability Lock", value: "Active" }
    ],
    demoTarget: "/demo/code-health"
  },
  "release-forecasting": {
    title: "AI Release Forecasting",
    icon: Zap,
    description: "Predict delivery windows with augmented intelligence based on historical velocity.",
    valueProp: "Forecast mission-critical ship dates by analyzing complexity drifts and historical commit velocity across enterprise teams.",
    details: [
      "92% Confidence interval forecasting",
      "Complexity drift and delay prediction",
      "Team velocity standard deviation tracking",
      "AI-driven bottleneck identification"
    ],
    exampleLabel: "Predictive Analytics",
    exampleData: [
      { label: "Confidence Interval", value: "92%" },
      { label: "Forecast Model", value: "v1.0-AI" },
      { label: "Reliability score", value: "High" }
    ],
    demoTarget: "/demo/release-forecasting"
  },
  "contributor-heatmap": {
    title: "Contributor Heatmap",
    icon: Network,
    description: "Visualize temporal commit density and frequency across the repository lifecycle.",
    valueProp: "Surface activity peaks and structural gaps in your contribution pipeline with high-resolution temporal mapping.",
    details: [
      "Activity density and peak identification",
      "Temporal gap analysis and risk assessment",
      "Contributor burnout and velocity monitoring",
      "Recursive heatmap layering across branches"
    ],
    exampleLabel: "Activity Mapping",
    exampleData: [
      { label: "Peak Velocity", value: "240/wk" },
      { label: "Cycle Latency", value: "Level 2" },
      { label: "Uptime Consistency", value: "94.2%" }
    ],
    demoTarget: "/demo/contributor-heatmap"
  }
};

export default function FeatureDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const content = FEATURE_CONTENT[slug];

  if (!content) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center space-y-4">
        <h1 className="text-4xl font-bold">Feature Protocol Not Found</h1>
        <Link href="/" className="text-primary hover:underline">Return to Command Center</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Overview
      </Link>

      <div className="grid gap-12 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          <div className="flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-none border border-border bg-surface-container shadow-sm">
              <content.icon className="size-7 text-primary" />
            </div>
            <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground">
              {content.title}
            </h1>
          </div>
          
          <p className="text-xl font-medium leading-relaxed text-muted-foreground">
            {content.description}
          </p>

          <div className="h-0.5 w-12 bg-primary" />

          <p className="text-muted-foreground leading-relaxed">
            {content.valueProp}
          </p>

          <ul className="space-y-3">
            {content.details.map((detail, i) => (
              <li key={i} className="flex items-center gap-3 text-sm font-medium text-foreground">
                <div className="size-1.5 rounded-full bg-primary" />
                {detail}
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="space-y-8"
        >
          <div className="overflow-hidden rounded-none border border-border bg-card p-8 shadow-sm backdrop-blur-xl">
            <h3 className="mb-6 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {content.exampleLabel}
            </h3>
            <div className="grid gap-4">
              {content.exampleData.map((item, i) => (
                <div key={i} className="flex items-center justify-between rounded-none border border-border bg-surface-container p-4">
                  <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
                  <span className="font-mono text-sm font-bold text-primary">{item.value}</span>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <Link
                href={content.demoTarget}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-none py-4 font-black uppercase tracking-tight transition-all",
                  "bg-primary text-white shadow-lg hover:shadow-primary/20"
                )}
              >
                Launch Intelligence Demo
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>

          <div className="rounded-none border border-primary/10 bg-primary/5 p-6 backdrop-blur-sm">
            <p className="text-xs font-medium italic text-muted-foreground leading-relaxed">
              &quot;The ability to synchronize our engineering metadata across four disparate 
              business units has fundamentally changed how we manage architectural risk.&quot;
            </p>
            <div className="mt-4 flex items-center gap-3">
              <div className="size-8 rounded-full bg-muted" />
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Principal Engineer // Fortune 500
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
