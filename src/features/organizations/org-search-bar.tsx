"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OrgSearchBarProps {
  suggestions: string[];
}

export function OrgSearchBar({ suggestions }: OrgSearchBarProps) {
  const [q, setQ] = useState("");

  const analyze = () => {
    const trimmed = q.trim().replace(/^@/, "");
    if (!trimmed) return;
    // Navigate to the org's GitHub page or search dashboard
    // For now route to GitHub (real org analysis would need extra API build-out)
    window.open(`https://github.com/${trimmed}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 p-1.5 rounded-xl bg-background/50 border border-border focus-within:ring-2 ring-primary/20 transition-all">
        <div className="flex-1 flex items-center px-3">
          <Search className="size-5 text-muted-foreground mr-2 shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && analyze()}
            placeholder="Search for an organization (e.g. vercel, google, apple)..."
            className="w-full bg-transparent border-none focus:ring-0 text-sm font-medium placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <Button
          type="button"
          onClick={analyze}
          className="btn-gitscope-primary rounded-lg px-6 font-bold shadow-lg"
        >
          Analyze
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => { setQ(tag); }}
            className="px-2.5 py-1 rounded-full bg-muted/50 text-[10px] font-bold text-muted-foreground uppercase tracking-widest hover:bg-muted hover:text-foreground cursor-pointer transition-colors border border-border/50"
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
}
