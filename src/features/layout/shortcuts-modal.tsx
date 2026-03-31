"use client";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setShortcutsOpen } from "@/store/slices/uiSlice";
import { motion } from "framer-motion";
import { 
  Keyboard as KeyboardIcon, 
  Search, 
  Terminal, 
  LayoutDashboard, 
  TrendingUp, 
  BookOpen, 
  Moon, 
  Maximize, 
  CornerDownLeft,
  HelpCircle,
  Smartphone,
  Info
} from "lucide-react";
import { useEffect, useState } from "react";

export function ShortcutsModal() {
  const isOpen = useAppSelector((state) => state.ui.shortcutsOpen);
  const dispatch = useAppDispatch();
  const [os, setOs] = useState<"mac" | "win" | "mobile">("win");

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|android/.test(ua)) setOs("mobile");
    else if (ua.indexOf("mac") !== -1) setOs("mac");
    else setOs("win");
  }, []);

  const modKey = os === "mac" ? "⌘" : "Ctrl";
  const shortcuts = [
    { keys: ["/"], action: "Focus Global Search", icon: Search },
    { keys: [modKey, "K"], action: "Open Action Palette", icon: Terminal },
    { keys: ["G", "O"], action: "Jump to Overview", icon: LayoutDashboard },
    { keys: ["G", "E"], action: "Explore Trends", icon: TrendingUp },
    { keys: ["G", "D"], action: "System Docs", icon: BookOpen },
    { keys: ["T"], action: "Toggle Theme", icon: Moon },
    { keys: ["F"], action: "Toggle Fullscreen", icon: Maximize },
    { keys: ["Esc"], action: "Close Modals", icon: CornerDownLeft },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => dispatch(setShortcutsOpen(false))}
        className="absolute inset-0 bg-background/60 backdrop-blur-md"
      />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl shadow-2xl p-6 sm:p-8"
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500">
              <KeyboardIcon className="size-5" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight text-foreground">Discovery Engine Shortcuts</h2>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{os === "mobile" ? "Action Center" : `${os.toUpperCase()} Engineering Controls`}</p>
            </div>
          </div>
          <button 
            onClick={() => dispatch(setShortcutsOpen(false))}
            className="flex size-8 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <CornerDownLeft className="size-4 text-muted-foreground" />
          </button>
        </div>

        {os === "mobile" ? (
          <div className="space-y-4 py-4">
             <div className="rounded-2xl bg-indigo-500/5 p-4 border border-indigo-500/10 flex items-start gap-4">
               <Smartphone className="size-6 text-indigo-500" />
               <div>
                  <h3 className="text-sm font-bold text-foreground">Mobile Actions</h3>
                  <p className="text-xs text-muted-foreground">Shortcuts are disabled on touch devices. Use the Bottom Bar or Action Menu icons for navigation.</p>
               </div>
             </div>
             <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Search", icon: Search },
                  { label: "Docs", icon: BookOpen },
                  { label: "Palette", icon: Terminal },
                  { label: "Settings", icon: HelpCircle }
                ].map(item => (
                   <div key={item.label} className="p-4 rounded-xl border border-border bg-white/50 dark:bg-slate-900/50 flex flex-col items-center gap-2">
                      <item.icon className="size-5 text-indigo-500" />
                      <span className="text-xs font-bold">{item.label}</span>
                   </div>
                ))}
             </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:gap-3">
            {shortcuts.map((s) => (
              <div 
                key={s.action} 
                className="group flex flex-col gap-2 rounded-2xl border border-white/5 bg-white/40 dark:bg-slate-900/40 p-3 hover:bg-indigo-500/5 hover:border-indigo-500/20 transition-all duration-300"
              >
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-2">
                      <s.icon className="size-3.5 text-muted-foreground group-hover:text-indigo-500 transition-colors" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{s.action}</span>
                   </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {s.keys.map((key) => (
                    <kbd 
                      key={key} 
                      className="min-w-[28px] rounded-lg border border-border bg-muted/50 px-2 py-1 text-center text-[10px] font-mono font-bold shadow-sm"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 flex items-center gap-3 rounded-2xl bg-slate-900/5 dark:bg-white/5 p-4 border border-border/50">
           <Info className="size-4 text-indigo-500 shrink-0" />
           <p className="text-[10px] font-semibold text-muted-foreground leading-relaxed">
             Pro Tip: Use <span className="font-bold text-foreground">/</span> to instantly focus the search bar from any view. Most navigation commands start with the <span className="font-bold text-foreground">G</span> (Go) prefix.
           </p>
        </div>
      </motion.div>
    </div>
  );
}
