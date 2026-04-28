"use client";

import { useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

type GeneratorType = "readme" | "changelog";

interface AiGeneratorProps {
  selectedRepo: string | null;
  isPro: boolean;
}

const GENERATORS = [
  {
    id: "readme" as GeneratorType,
    icon: "description",
    label: "README Generator",
    description: "Auto-generate a professional README from your repo structure",
    endpoint: "/api/ai/generate-readme",
    resultKey: "readme",
    color: "amber",
    options: [
      { key: "style", label: "Style", values: ["standard", "minimal", "detailed"], default: "standard" },
    ],
  },
  {
    id: "changelog" as GeneratorType,
    icon: "history",
    label: "Changelog Generator",
    description: "Generate a CHANGELOG from your commit history",
    endpoint: "/api/ai/generate-changelog",
    resultKey: "changelog",
    color: "amber",
    options: [
      { key: "format", label: "Format", values: ["keepachangelog", "conventional", "narrative"], default: "keepachangelog" },
      { key: "maxCommits", label: "Commits", values: ["50", "100", "200"], default: "100" },
    ],
  },
];

export function AiGenerator({ selectedRepo, isPro }: AiGeneratorProps) {
  const [activeGen, setActiveGen] = useState<GeneratorType>("readme");
  const [repo, setRepo] = useState(selectedRepo ?? "");
  const [options, setOptions] = useState<Record<string, string>>({ style: "standard", format: "keepachangelog", maxCommits: "100" });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ text: string; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const gen = GENERATORS.find((g) => g.id === activeGen)!;

  const generate = async () => {
    if (!repo || loading) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const body: Record<string, unknown> = { repo };
      for (const opt of gen.options) body[opt.key] = options[opt.key] ?? opt.default;
      if (activeGen === "changelog") body.maxCommits = Number(options.maxCommits ?? 100);
      const res = await fetch(gen.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Generation failed"); return; }
      setResult({ text: data[gen.resultKey] ?? "", model: data.model ?? "" });
    } catch { setError("Network error"); } finally { setLoading(false); }
  };

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isPro) {
    return (
      <div className="rounded-none border border-amber-500/20 bg-amber-500/5 p-8 text-center space-y-3">
        <MaterialIcon name="auto_awesome" size={32} className="text-amber-400 mx-auto" />
        <p className="font-black text-base text-foreground">AI Generators require Developer plan</p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Generate README files and changelogs from your repo with AI. Upgrade to unlock.
        </p>
        <a href="/pricing-settings"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-none bg-amber-500 text-white text-sm font-black hover:bg-amber-600 transition-colors">
          <MaterialIcon name="upgrade" size={14} className="text-white" /> Upgrade Plan
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Sub-tab selector */}
      <div className="flex gap-1 p-1 bg-surface-container/30 rounded-none border border-outline-variant/10">
        {GENERATORS.map((g) => (
          <button key={g.id} type="button"
            onClick={() => { setActiveGen(g.id); setResult(null); setError(null); }}
            className={cn(
              "flex-1 flex items-center gap-2 px-4 py-2.5 rounded-none transition-all",
              activeGen === g.id
                ? "bg-amber-500 text-white shadow-md"
                : "text-muted-foreground/60 hover:text-foreground hover:bg-surface-container-highest/60"
            )}>
            <MaterialIcon name={g.icon} size={14} className={activeGen === g.id ? "text-white" : "text-muted-foreground/50"} />
            <div className="text-left">
              <p className={cn("text-[10px] font-black uppercase tracking-wider leading-none", activeGen === g.id ? "text-white" : "")}>{g.label}</p>
              <p className={cn("text-[8px] mt-0.5 leading-tight hidden sm:block", activeGen === g.id ? "text-amber-100/70" : "text-muted-foreground/40")}>{g.description}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Repo input */}
      {!selectedRepo ? (
        <input value={repo} onChange={(e) => setRepo(e.target.value)}
          placeholder="Repository (owner/repo)"
          className="w-full bg-surface-container/40 border border-outline-variant/15 rounded-none px-4 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 rounded-none bg-amber-500/8 border border-amber-500/20 text-xs font-mono text-amber-400">
          <MaterialIcon name="folder" size={12} /> {selectedRepo}
        </div>
      )}

      {/* Options */}
      {gen.options.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {gen.options.map((opt) => (
            <div key={opt.key} className="space-y-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">{opt.label}</p>
              <div className="flex gap-1 p-0.5 bg-surface-container/30 rounded-none border border-outline-variant/10">
                {opt.values.map((v) => (
                  <button key={v} type="button"
                    onClick={() => setOptions((prev) => ({ ...prev, [opt.key]: v }))}
                    className={cn(
                      "px-3 py-1.5 rounded-none text-[9px] font-black uppercase tracking-wider transition-all",
                      (options[opt.key] ?? opt.default) === v
                        ? "bg-amber-500 text-white"
                        : "text-muted-foreground/60 hover:text-foreground"
                    )}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={generate} disabled={!repo || loading}
        className="flex items-center gap-2 px-5 py-2.5 rounded-none bg-amber-500 text-white text-sm font-black hover:bg-amber-600 transition-colors disabled:opacity-40">
        <MaterialIcon name={loading ? "hourglass_top" : "auto_awesome"} size={15} className="text-white" />
        {loading ? "Generating…" : `Generate ${gen.label.replace(" Generator", "")}`}
      </button>

      {error && (
        <div className="rounded-none border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {result && (
        <div className="space-y-3 animate-in fade-in duration-300">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
              Generated · {result.model}
            </p>
            <button type="button" onClick={copy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-none border border-outline-variant/20 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 hover:text-amber-400 hover:border-amber-500/30 transition-colors">
              <MaterialIcon name={copied ? "check" : "content_copy"} size={11} />
              {copied ? "Copied!" : "Copy Markdown"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-foreground/80 leading-relaxed bg-surface-container/30 rounded-none border border-outline-variant/10 p-5 overflow-x-auto max-h-130 overflow-y-auto">
            {result.text}
          </pre>
        </div>
      )}
    </div>
  );
}
