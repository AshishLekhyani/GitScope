"use client";

import { useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

interface PrDescriptionGeneratorProps {
  selectedRepo: string | null;
  isPro: boolean;
}

export function PrDescriptionGenerator({ selectedRepo, isPro }: PrDescriptionGeneratorProps) {
  const [repo, setRepo] = useState(selectedRepo ?? "");
  const [mode, setMode] = useState<"pr" | "branch">("pr");
  const [prNumber, setPrNumber] = useState("");
  const [headBranch, setHeadBranch] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ description: string; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!repo || loading) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const body = mode === "pr"
        ? { repo, prNumber: Number(prNumber) }
        : { repo, headBranch, baseBranch };
      const res = await fetch("/api/ai/generate-pr-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Generation failed"); return; }
      setResult({ description: data.description, model: data.model });
    } catch { setError("Network error"); } finally { setLoading(false); }
  };

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.description).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isPro) {
    return (
      <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-8 text-center space-y-3">
        <MaterialIcon name="edit_note" size={32} className="text-indigo-400 mx-auto" />
        <p className="font-black text-base text-foreground">PR Description Generator requires Professional+</p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Auto-generate structured PR descriptions from your commits and diff. Upgrade to unlock.
        </p>
        <a href="/pricing-settings"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 text-white text-sm font-black hover:bg-indigo-600 transition-colors">
          <MaterialIcon name="upgrade" size={14} className="text-white" /> Upgrade Plan
        </a>
      </div>
    );
  }

  const canGenerate = repo && (mode === "pr" ? prNumber.trim() !== "" : headBranch.trim() !== "");

  return (
    <div className="space-y-5">
      {/* Repo input */}
      {!selectedRepo && (
        <input value={repo} onChange={(e) => setRepo(e.target.value)}
          placeholder="Repository (owner/repo)"
          className="w-full bg-surface-container/40 border border-outline-variant/15 rounded-2xl px-4 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
      )}
      {selectedRepo && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/8 border border-indigo-500/20 text-xs font-mono text-indigo-400">
          <MaterialIcon name="folder" size={12} /> {selectedRepo}
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex gap-1 p-1 bg-surface-container/30 rounded-xl border border-outline-variant/10">
        {(["pr", "branch"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={cn(
              "flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all",
              mode === m ? "bg-indigo-500 text-white" : "text-muted-foreground/60 hover:text-foreground"
            )}>
            {m === "pr" ? "By PR Number" : "By Branch"}
          </button>
        ))}
      </div>

      {/* Inputs */}
      {mode === "pr" ? (
        <input value={prNumber} onChange={(e) => setPrNumber(e.target.value.replace(/\D/g, ""))}
          placeholder="PR number (e.g. 42)"
          className="w-full bg-surface-container/40 border border-outline-variant/15 rounded-xl px-4 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <input value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)}
            placeholder="Base branch (e.g. main)"
            className="bg-surface-container/40 border border-outline-variant/15 rounded-xl px-4 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
          <input value={headBranch} onChange={(e) => setHeadBranch(e.target.value)}
            placeholder="Head branch (your branch)"
            className="bg-surface-container/40 border border-outline-variant/15 rounded-xl px-4 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
        </div>
      )}

      <button type="button" onClick={generate} disabled={!canGenerate || loading}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 text-white text-sm font-black hover:bg-indigo-600 transition-colors disabled:opacity-40">
        <MaterialIcon name={loading ? "hourglass_top" : "edit_note"} size={15} className="text-white" />
        {loading ? "Generating…" : "Generate PR Description"}
      </button>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {result && (
        <div className="space-y-3 animate-in fade-in duration-300">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
              Generated · {result.model}
            </p>
            <button type="button" onClick={copy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant/20 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 hover:text-indigo-400 hover:border-indigo-500/30 transition-colors">
              <MaterialIcon name={copied ? "check" : "content_copy"} size={11} />
              {copied ? "Copied!" : "Copy Markdown"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-foreground/80 leading-relaxed bg-surface-container/30 rounded-2xl border border-outline-variant/10 p-5 overflow-x-auto max-h-[480px] overflow-y-auto">
            {result.description}
          </pre>
        </div>
      )}
    </div>
  );
}
