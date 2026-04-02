"use client";

import { useState, useEffect, useRef } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { SearchRepoResult } from "@/features/layout/top-nav";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";

interface IntelligenceSearchProps {
  onSelect: (repo: string) => void;
  selectedRepos: string[];
  onRemove: (repo: string) => void;
  maxRepos: number;
}

export function IntelligenceSearch({ onSelect, selectedRepos, onRemove, maxRepos }: IntelligenceSearchProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchRepoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/github/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.repos || []);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <div className="relative" ref={searchRef}>
        <div className={cn(
          "relative flex items-center bg-surface-container border border-outline-variant/20 rounded-3xl p-2 transition-all duration-300 ring-offset-background shadow-sm",
          isFocused && "bg-surface-container-highest border-indigo-500/50 ring-4 ring-indigo-500/10 shadow-2xl scale-[1.01]"
        )}>
           <div className="pl-4 pr-3 text-muted-foreground/40">
              {loading ? (
                <div className="size-5 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />
              ) : (
                <MaterialIcon name="search" size={24} />
              )}
           </div>
           <input 
             type="text"
             value={q}
             onChange={(e) => setQ(e.target.value)}
             onFocus={() => setIsFocused(true)}
             className="flex-1 bg-transparent border-0 focus:ring-0 text-lg font-bold placeholder:text-muted-foreground/30 py-4"
             placeholder="Search a repository to run recursive intelligence..."
           />
           <div className="pr-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/30 border border-outline-variant/10 px-2.5 py-1.5 rounded-xl">
                 Scanned: {selectedRepos.length} / {maxRepos}
              </span>
           </div>
        </div>

        <AnimatePresence>
          {isFocused && (results.length > 0 || q) && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              className="absolute top-full left-0 right-0 mt-4 bg-surface-container-highest border border-outline-variant/10 rounded-3xl shadow-2xl overflow-hidden z-[100] max-h-[400px] overflow-y-auto custom-scrollbar p-2"
            >
              {results.length === 0 && !loading && (
                <div className="py-12 text-center">
                  <MaterialIcon name="manage_search" size={32} className="text-muted-foreground/20 mb-3" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">No ecosystem matches</p>
                </div>
              )}
              
              <div className="grid grid-cols-1 gap-1">
                {results.map((repo) => {
                  const fullName = `${repo.owner}/${repo.repo}`;
                  const isSelected = selectedRepos.includes(fullName);
                  return (
                    <button
                      key={fullName}
                      disabled={isSelected}
                      onClick={() => {
                        onSelect(fullName);
                        setQ("");
                        setIsFocused(false);
                      }}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-2xl transition-all group text-left",
                        isSelected ? "opacity-30 grayscale cursor-not-allowed" : "hover:bg-indigo-500/5 active:scale-[0.98]"
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <Image src={repo.avatar} width={40} height={40} className="size-10 rounded-xl" alt="" />
                        <div>
                          <div className="text-sm font-black tracking-tight">{repo.repo}</div>
                          <div className="text-[10px] font-bold text-muted-foreground uppercase">{repo.owner}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                         <div className="text-right">
                            <div className="text-[10px] font-black">{repo.stars}</div>
                            <div className="text-[8px] font-black text-muted-foreground uppercase tracking-widest">Stars</div>
                         </div>
                         <MaterialIcon name={isSelected ? "check_circle" : "add_circle_outline"} size={20} className={isSelected ? "text-indigo-500" : "text-muted-foreground/20 group-hover:text-indigo-500"} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <AnimatePresence mode="popLayout">
          {selectedRepos.map((repo) => (
            <motion.div
              layout
              key={repo}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex items-center gap-3 pl-3 pr-2 py-2 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 group hover:border-indigo-500/50 transition-colors"
            >
              <div className="text-xs font-black text-indigo-500 tracking-tight">
                <span className="opacity-40">{repo.split("/")[0]}/</span>{repo.split("/")[1]}
              </div>
              <button 
                onClick={() => onRemove(repo)}
                className="size-6 rounded-lg bg-indigo-500/20 text-indigo-500 hover:bg-indigo-500 hover:text-white transition-all flex items-center justify-center"
              >
                <MaterialIcon name="close" size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
