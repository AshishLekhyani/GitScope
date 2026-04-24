"use client";

import { useParams } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { ArrowLeft, LayoutDashboard, Database, BarChart3, Activity, Users, Settings, Shield, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const slug = params.slug as string;
  
  // Check system preference or stored theme on mount
  const [isDark, setIsDark] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check if user has a theme preference stored or from system
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme) {
      setIsDark(storedTheme === 'dark');
    } else {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDark(prefersDark);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark, mounted]);

  return (
    <div className={cn(
      "flex h-screen overflow-hidden transition-colors",
      isDark ? "bg-[#100f0d] text-foreground" : "bg-background text-foreground"
    )}>
      {/* Simulation Banner */}
      <div className={cn(
        "fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-4 px-4 py-1.5 backdrop-blur-md border-b",
        isDark 
          ? "bg-primary/20 border-primary/20" 
          : "bg-primary/10 border-primary/20"
      )}>
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
        <div className="h-3 w-px bg-primary/20" />
        <button
          onClick={() => setIsDark(!isDark)}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-tight text-muted-foreground hover:text-foreground transition-colors"
        >
          {isDark ? <Sun className="size-3" /> : <Moon className="size-3" />}
          {isDark ? "Light" : "Dark"}
        </button>
      </div>

      {/* Mock Sidebar */}
      <aside className={cn(
        "hidden w-64 flex-col border-r pt-12 lg:flex",
        isDark
          ? "border-white/5 bg-[#0d0c0a]"
          : "border-border bg-surface-container"
      )}>
        <div className="px-6 py-6 font-heading text-lg font-bold tracking-tight text-foreground flex items-center gap-3">
          <div className="relative w-7 h-7 border-[1.5px] border-primary/60 grid place-items-center shrink-0 bg-primary/5">
            <div className="absolute inset-0.75 border-[1.5px] border-primary/40" />
            <div className="relative w-2 h-2 bg-primary z-10" />
          </div>
          <span className="font-mono font-bold text-[13px] tracking-[0.06em]">
            GIT<span className="text-primary">SCOPE</span>
          </span>
          <span className="text-[10px] font-mono text-primary/60 mt-0.5 uppercase">v1</span>
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
                "flex items-center gap-3 rounded-none px-3 py-2 text-sm font-medium transition-all cursor-default",
                item.active 
                  ? "bg-primary/10 text-primary border border-primary/10" 
                  : "text-muted-foreground hover:bg-muted opacity-50"
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </div>
          ))}
        </nav>

        <div className={cn(
          "p-4 mt-auto border-t opacity-30 cursor-default",
          isDark ? "border-white/5" : "border-border"
        )}>
          <div className="flex items-center gap-3 rounded-none px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <Settings className="size-4" />
            Config
          </div>
          <div className="flex items-center gap-3 rounded-none px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <Shield className="size-4" />
            Security
          </div>
        </div>
      </aside>

      {/* Mock Content Area */}
      <main className={cn(
        "relative flex flex-1 flex-col overflow-y-auto pt-10",
        isDark ? "bg-[#100f0d]" : "bg-background"
      )}>
        <div className={cn(
          "absolute inset-0",
          isDark
            ? "bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,0.03),transparent_40%)]"
            : "bg-[radial-gradient(circle_at_50%_0%,rgba(199,122,18,0.04),transparent_40%)]"
        )} />
        <div className="relative z-10 flex-1 overflow-x-hidden">
          {children}
        </div>
      </main>
    </div>
  );
}
