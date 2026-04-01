export const dynamic = 'force-dynamic';

import Link from "next/link";
import { Github, Lock, ArrowRight, Zap, BarChart3, Building2, Brain } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const GITHUB_FEATURES = [
  { icon: Brain, label: "Recursive Intelligence", desc: "DORA metrics, dependency radar, AI-powered risk scoring" },
  { icon: Building2, label: "Organization Pulse", desc: "Real-time analytics across your GitHub organizations" },
  { icon: BarChart3, label: "Velocity Analytics", desc: "PR cycle time, deployment frequency, bus factor analysis" },
  { icon: Zap, label: "Live Activity Feed", desc: "Real-time GitHub events from your repos and orgs" },
];

export default async function UnauthorizedPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-8">
      <div className="text-center space-y-10 max-w-lg w-full">
        {/* Icon */}
        <div className="relative">
          <div className="absolute inset-0 bg-primary/10 rounded-full blur-3xl scale-150" />
          <div className="relative size-24 mx-auto rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Lock className="size-10 text-primary/60" />
          </div>
        </div>

        {/* Heading */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/5 border border-primary/10">
            <Github className="size-3.5 text-primary/60" />
            <span className="text-[10px] font-black uppercase tracking-widest text-primary/60">GitHub Access Required</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight">
            Unlock the Full Stack
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed font-medium">
            This feature is exclusive to users who sign in with GitHub OAuth. Your GitHub session gives us the access needed to pull real-time data from your repositories and organizations.
          </p>
        </div>

        {/* Features unlocked */}
        <div className="grid grid-cols-1 gap-3 text-left">
          {GITHUB_FEATURES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-4 p-4 rounded-xl bg-card border border-border/50">
              <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="size-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        {session?.user ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground/50 font-mono uppercase tracking-widest">
              Currently signed in as: {session.user.email ?? session.user.name} (limited access)
            </p>
            <Link
              href="/api/auth/signin/github"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl btn-gitscope-primary text-sm font-bold"
            >
              <Github className="size-4" />
              Connect GitHub Account
              <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : (
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl btn-gitscope-primary text-sm font-bold"
          >
            <Github className="size-4" />
            Sign in with GitHub
            <ArrowRight className="size-4" />
          </Link>
        )}

        <Link
          href="/overview"
          className="block text-xs text-muted-foreground hover:text-foreground transition-colors font-mono uppercase tracking-widest"
        >
          ← Back to Overview
        </Link>
      </div>
    </div>
  );
}
