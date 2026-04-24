"use client";

import { useState, useEffect, useRef } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { SearchRepoResult } from "@/features/layout/top-nav";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import Image from "next/image";

interface CompareSearchProps {
  selectedRepos: SearchRepoResult[];
  onSelect: (repo: SearchRepoResult) => void;
  onRemove: (id: string) => void;
  max?: number;
}

export function CompareSearch({ selectedRepos, onSelect, onRemove, max = 3 }: CompareSearchProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchRepoResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/github/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          const formatted: SearchRepoResult[] = (data.repos ?? []).map(
            (item: { owner: string; repo: string; avatar: string; stars: number | string; desc: string }) => ({
              owner: item.owner,
              repo: item.repo,
              avatar: item.avatar,
              stars: item.stars,
              desc: item.desc,
            })
          );
          setResults(formatted);
        }
      } catch (e) {
        console.error("Search failed", e);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl">
      <div className="flex flex-wrap gap-2 mb-4">
        {selectedRepos.map((repo) => (
          <motion.div
            layout
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            key={`${repo.owner}/${repo.repo}`}
            className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-full"
          >
            <Image src={repo.avatar} width={16} height={16} className="size-4 rounded-full" alt="" />
            <span className="text-xs font-bold text-amber-400">
              {repo.owner}/{repo.repo}
            </span>
            <button
              type="button"
              aria-label={`Remove ${repo.owner}/${repo.repo}`}
              onClick={() => onRemove(`${repo.owner}/${repo.repo}`)}
              className="text-amber-400/50 hover:text-amber-400 transition-colors"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
        
        {selectedRepos.length < max && (
          <div className="flex-1 min-w-[200px] relative">
            <div className={cn(
               "flex items-center gap-3 px-4 py-2.5 rounded-none border transition-all duration-300 bg-surface-container/50",
               isFocused ? "border-amber-500/50 ring-4 ring-amber-500/10 bg-background shadow-xl" : "border-outline-variant/10"
            )}>
              <MaterialIcon name="add" size={20} className={isFocused ? "text-amber-500" : "text-muted-foreground"} />
              <input
                value={q}
                onFocus={() => setIsFocused(true)}
                onChange={(e) => setQ(e.target.value)}
                placeholder={selectedRepos.length === 0 ? "Search for a repository to compare..." : "Add another..."}
                className="bg-transparent border-0 outline-none text-sm w-full placeholder:text-muted-foreground/60"
              />
              {isSearching && (
                <div className="size-4 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin" />
              )}
            </div>

            <AnimatePresence>
              {isFocused && (results.length > 0 || isSearching) && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute top-full left-0 right-0 mt-2 z-[100] border border-outline-variant/10 bg-surface-container/95 backdrop-blur-xl rounded-none shadow-2xl overflow-hidden p-2"
                >
                  {results.filter(r => !selectedRepos.some(s => `${s.owner}/${s.repo}` === `${r.owner}/${r.repo}`)).map((repo) => (
                    <button
                      type="button"
                      key={`${repo.owner}/${repo.repo}`}
                      onClick={() => {
                        onSelect(repo);
                        setQ("");
                        setResults([]);
                        setIsFocused(false);
                      }}
                      className="flex w-full items-center gap-3 p-3 rounded-none hover:bg-stone-100 dark:hover:bg-stone-800 transition-all text-left group"
                    >
                      <Image src={repo.avatar} width={32} height={32} className="size-8 rounded-none" alt="" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate group-hover:text-amber-500 transition-colors">
                          <span className="opacity-40">{repo.owner}/</span>{repo.repo}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">{repo.desc}</div>
                      </div>
                      <MaterialIcon name="add_circle" size={20} className="text-muted-foreground group-hover:text-amber-500 opacity-0 group-hover:opacity-100 transition-all" />
                    </button>
                  ))}
                  {!isSearching && results.length === 0 && (
                    <div className="p-8 text-center text-xs text-muted-foreground">No repositories found.</div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
