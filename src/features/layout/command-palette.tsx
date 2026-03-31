"use client";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setCommandPaletteOpen } from "@/store/slices/uiSlice";
import { useRecentHistory } from "@/hooks/use-recent-history";
import { ROUTES } from "@/constants/routes";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { performLogout } from "@/lib/client-auth";
import {
  Terminal,
  Moon,
  Sun,
  LogOut,
  LayoutDashboard,
  BookOpen,
  Zap,
  Command,
  TrendingUp,
  History
} from "lucide-react";
import { motion } from "framer-motion";
import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const isOpen = useAppSelector((state) => state.ui.commandPaletteOpen);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { setTheme } = useTheme();
  const { history, clearHistory } = useRecentHistory();
  const [search, setSearch] = useState("");

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch(setCommandPaletteOpen(false));
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        dispatch(setCommandPaletteOpen(!isOpen));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dispatch, isOpen]);

  const navTo = (href: string) => {
    router.push(href);
    dispatch(setCommandPaletteOpen(false));
  };

  const actions = [
    { icon: LayoutDashboard, label: "Overview", href: ROUTES.overview, category: "Navigation" },
    { icon: TrendingUp, label: "Explore Trends", href: ROUTES.search, category: "Navigation" },
    { icon: BookOpen, label: "Engineering Reference", href: "/docs-reference", category: "Navigation" },
    { icon: Moon, label: "Switch to Dark Mode", action: () => setTheme("dark"), category: "System" },
    { icon: Sun, label: "Switch to Light Mode", action: () => setTheme("light"), category: "System" },
    { icon: LogOut, label: "Sign Out", action: () => { void performLogout(); }, category: "Account", danger: true },
  ];

  const filteredActions = actions.filter(a => 
    a.label.toLowerCase().includes(search.toLowerCase())
  );

  const filteredHistory = history.filter(h => 
    h.name.toLowerCase().includes(search.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => dispatch(setCommandPaletteOpen(false))}
        className="absolute inset-0 bg-background/40 backdrop-blur-sm"
      />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl shadow-2xl"
      >
        <div className="flex items-center border-b border-border px-4 py-4">
          <Terminal className="mr-3 size-5 text-indigo-500" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a command or search history..."
            className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground outline-none border border-border">
            ESC
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-indigo-500/20">
          
          {/* Recent Navigation (History) */}
          {filteredHistory.length > 0 && (
            <div className="mb-4">
              <div className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <History className="size-3" /> Quick Jump
                </div>
                <button onClick={clearHistory} className="hover:text-primary transition-colors">Clear</button>
              </div>
              {filteredHistory.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navTo(item.type === "repo" ? ROUTES.dashboard(item.id.split('/')[0], item.id.split('/')[1]) : `/${item.name}`)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-indigo-500/10 hover:text-indigo-500 transition-colors group"
                >
                  <div className="size-8 rounded-lg overflow-hidden border border-indigo-500/10">
                    {item.avatar && <Image src={item.avatar} width={32} height={32} alt={item.name} className="size-full object-cover" />}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-foreground group-hover:text-indigo-500">
                      {item.type === "repo" && <span className="opacity-40">{item.id.split('/')[0]}/</span>}
                      {item.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-black">{item.type}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* System Actions */}
          <div className="space-y-1">
             <div className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <Zap className="size-3" /> CLI Commands
             </div>
             {filteredActions.map((action) => (
               <button
                 key={action.label}
                 onClick={() => action.action ? (action.action(), dispatch(setCommandPaletteOpen(false))) : navTo(action.href!)}
                 className={cn(
                   "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition-colors group",
                   action.danger ? "hover:bg-red-500/10 text-red-500" : "hover:bg-indigo-500/10 hover:text-indigo-500"
                 )}
               >
                 <action.icon className={cn("size-4 opacity-50 group-hover:opacity-100", action.danger && "opacity-100")} />
                 <span className="flex-1">{action.label}</span>
                 <span className="text-[10px] font-black opacity-30 group-hover:opacity-100 uppercase tracking-widest">{action.category}</span>
               </button>
             ))}
          </div>

        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1"><Command className="size-3" />K/Ctrl K to open</span>
            <span className="flex items-center gap-1">↑↓ to navigate</span>
            <span className="flex items-center gap-1">↵ to perform action</span>
          </div>
          <div className="font-bold text-indigo-500">v2.4.0-Discovery</div>
        </div>
      </motion.div>
    </div>
  );
}
