"use client";

import { useParams } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { ArrowLeft, LayoutDashboard, Database, BarChart3, Activity, Users, Settings, Shield } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const slug = params.slug as string;

  return (
    <div className="flex h-screen overflow-hidden bg-[#0b1326] text-foreground transition-all">
      {/* Simulation Banner */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-4 bg-primary/20 px-4 py-1.5 backdrop-blur-md border-b border-primary/20">
        <div className="flex items-center gap-2">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            Simulation Protocol Active // Mode: Interactive Mock
          </span>
        </div>
        <div className="h-3 w-px bg-primary/20" />
        <Link 
          href={ROUTES.feature(slug)} 
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-tight text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3" />
          Return to Intelligence Files
        </Link>
      </div>

      {/* Mock Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-white/5 bg-[#0d111b] pt-12 lg:flex">
        <div className="px-6 py-6 font-heading text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
          <div className="from-primary/20 to-primary/5 flex size-8 items-center justify-center rounded-lg border border-primary/20 bg-gradient-to-br">
            <span className="text-primary font-black text-xs">G</span>
          </div>
          GitScope <span className="text-[10px] font-mono text-primary/60 mt-1 uppercase">v2</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {[
            { icon: LayoutDashboard, label: "Overview", active: false },
            { icon: Database, label: "Repositories", active: true },
            { icon: BarChart3, label: "Analytics", active: false },
            { icon: Activity, label: "System Health", active: false },
            { icon: Users, label: "Engineers", active: false },
          ].map((item) => (
            <div
              key={item.label}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all cursor-default",
                item.active 
                  ? "bg-primary/10 text-primary border border-primary/10" 
                  : "text-muted-foreground hover:bg-white/5 opacity-50"
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </div>
          ))}
        </nav>

        <div className="p-4 mt-auto border-t border-white/5 opacity-30 cursor-default">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <Settings className="size-4" />
            Config
          </div>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <Shield className="size-4" />
            Security
          </div>
        </div>
      </aside>

      {/* Mock Content Area */}
      <main className="relative flex flex-1 flex-col overflow-y-auto pt-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(192,193,255,0.03),transparent_40%)]" />
        <div className="relative z-10 flex-1 overflow-x-hidden">
          {children}
        </div>
      </main>
    </div>
  );
}
