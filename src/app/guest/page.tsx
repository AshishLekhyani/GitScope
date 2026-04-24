"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Star, GitFork, Eye, Code2, Lock, ArrowRight, Search,
  Github, Zap, BarChart3, GitCommit, Users, ExternalLink, ChevronRight,
  CheckCircle2, Sparkles, TrendingUp, Shield
} from "lucide-react";
import Link from "next/link";
import NextImage from "next/image";
import { motion, AnimatePresence } from "framer-motion";

interface QuickRepo {
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  owner: { login: string; avatar_url: string };
  html_url: string;
  topics: string[];
}

interface SearchResult {
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  owner: { avatar_url: string };
}

const FEATURED_REPOS = [
  "facebook/react",
  "vercel/next.js",
  "microsoft/vscode",
  "torvalds/linux",
];

const LOCKED_FEATURES = [
  { icon: BarChart3, label: "Commit Velocity Charts", tier: "Any account" },
  { icon: GitCommit, label: "Full Commit History", tier: "Any account" },
  { icon: Users, label: "Contributor Analytics", tier: "Any account" },
  { icon: Zap, label: "DORA Metrics & AI Risk", tier: "GitHub OAuth" },
  { icon: Code2, label: "Organization Pulse", tier: "GitHub OAuth" },
];

async function fetchRepo(fullName: string): Promise<QuickRepo | null> {
  const res = await fetch(`https://api.github.com/repos/${fullName}`);
  if (!res.ok) return null;
  return res.json();
}

async function searchPublicRepos(q: string): Promise<SearchResult[]> {
  const res = await fetch(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=8&sort=stars`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.items ?? [];
}

export default function GuestPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<QuickRepo | null>(null);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Redirect authenticated users to the dashboard
  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      router.replace("/overview");
    }
  }, [status, session, router]);

  // Load featured repo on mount
  useEffect(() => {
    setLoadingRepo(true);
    fetchRepo("facebook/react")
      .then((r) => setSelectedRepo(r))
      .finally(() => setLoadingRepo(false));
  }, []);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await searchPublicRepos(query.trim());
      setResults(r);
      setShowDropdown(true);
      setSearching(false);
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadRepo = async (name: string) => {
    setShowDropdown(false);
    setQuery(name);
    setLoadingRepo(true);
    const r = await fetchRepo(name);
    setSelectedRepo(r);
    setLoadingRepo(false);
  };

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <div className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="relative block shrink-0 overflow-hidden size-8">
              <NextImage
                src="/logo.png"
                width={32}
                height={32}
                alt="GitScope"
                className="hidden size-full object-contain dark:block"
              />
              <NextImage
                src="/logo-light.png"
                width={32}
                height={32}
                alt="GitScope"
                className="block size-full object-contain dark:hidden"
              />
            </span>
            <span className="font-heading text-lg font-bold tracking-tight text-foreground uppercase">GitScope</span>
            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[9px] font-black text-amber-500 uppercase tracking-widest">Guest Preview</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-none btn-gitscope-primary text-xs font-bold"
            >
              <Github className="size-3.5" />
              Sign in with GitHub
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/5 border border-primary/10">
            <span className="size-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-primary/60">Public Repo Explorer — No Account Required</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight md:text-4xl">
            Explore Any GitHub Repository
          </h1>
          <p className="text-muted-foreground text-sm max-w-xl mx-auto">
            Search any public repository and see basic metrics instantly.
            Sign in with GitHub to unlock full analytics, commit history, contributor insights, and AI analysis.
          </p>
        </div>

        {/* Search */}
        <div className="relative max-w-2xl mx-auto" ref={searchRef}>
          <div className={`flex items-center gap-3 p-3 rounded-none border bg-card transition-all ${showDropdown ? "border-primary/50 ring-4 ring-primary/10" : "border-border"}`}>
            <Search className="size-5 text-muted-foreground shrink-0 ml-1" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => results.length > 0 && setShowDropdown(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.includes("/")) loadRepo(query.trim());
              }}
              placeholder="Search repositories (e.g. torvalds/linux)..."
              className="flex-1 bg-transparent text-sm font-medium border-none focus:ring-0 focus:outline-none placeholder:text-muted-foreground/40"
            />
            {searching && (
              <div className="size-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin shrink-0" />
            )}
          </div>

          <AnimatePresence>
            {showDropdown && results.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="absolute top-full mt-2 left-0 right-0 z-50 bg-card border border-border rounded-none shadow-2xl overflow-hidden"
              >
                {results.map((r) => (
                  <button
                    key={r.full_name}
                    type="button"
                    onClick={() => loadRepo(r.full_name)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/60 transition-colors text-left border-b border-border/50 last:border-0"
                  >
                    <NextImage src={r.owner.avatar_url} width={32} height={32} alt="" className="size-8 rounded-none" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{r.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.description}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                      <Star className="size-3" /> {fmt(r.stargazers_count)}
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Featured quick picks */}
          <div className="mt-3 flex flex-wrap gap-2 justify-center">
            {FEATURED_REPOS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => loadRepo(r)}
                className="px-3 py-1 rounded-full bg-muted/50 border border-border/50 text-[11px] font-mono hover:bg-muted hover:border-primary/30 transition-all"
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* How it works — walkthrough */}
        <div className="rounded-none border border-border bg-card/50 p-8">
          <div className="text-center mb-8">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/5 border border-primary/10 text-[10px] font-black uppercase tracking-widest text-primary/60 mb-3">
              <Sparkles className="size-3" /> How GitScope Works
            </span>
            <h2 className="text-xl font-black tracking-tight">From code to insights in seconds</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                step: "01",
                icon: Github,
                title: "Connect GitHub",
                desc: "Sign in with your GitHub account via OAuth. We never store your code — only metadata.",
                color: "text-foreground",
                bg: "bg-muted/50",
              },
              {
                step: "02",
                icon: Search,
                title: "Pick Any Repo",
                desc: "Search any public or private repo you have access to. Results are instant.",
                color: "text-amber-500",
                bg: "bg-amber-500/5",
              },
              {
                step: "03",
                icon: BarChart3,
                title: "Get Deep Analytics",
                desc: "Commit velocity, DORA metrics, contributor heatmaps, dependency graphs — all live.",
                color: "text-primary",
                bg: "bg-primary/5",
              },
              {
                step: "04",
                icon: Sparkles,
                title: "AI Risk Analysis",
                desc: "Claude AI scores every open PR for risk and explains exactly why. Catch issues before merge.",
                color: "text-amber-500",
                bg: "bg-amber-500/5",
              },
            ].map((item) => (
              <div key={item.step} className="flex flex-col gap-3">
                <div className={`size-12 rounded-none ${item.bg} flex items-center justify-center`}>
                  <item.icon className={`size-6 ${item.color}`} />
                </div>
                <div>
                  <div className="font-mono text-[10px] font-black text-muted-foreground/40 mb-1">STEP {item.step}</div>
                  <h3 className="font-black text-sm mb-1">{item.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Feature comparison — tier table */}
        <div className="rounded-none border border-border bg-card/50 p-8">
          <div className="text-center mb-6">
            <h2 className="text-xl font-black tracking-tight">What you unlock with each plan</h2>
            <p className="text-sm text-muted-foreground mt-1">Start free, upgrade when you need more power.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 pr-6 font-bold text-muted-foreground text-xs uppercase tracking-widest">Feature</th>
                  <th className="py-3 px-4 text-center font-black text-xs">Guest</th>
                  <th className="py-3 px-4 text-center font-black text-xs text-primary">Any Account</th>
                  <th className="py-3 px-4 text-center font-black text-xs text-amber-500">GitHub OAuth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {[
                  { feature: "Basic repo stats (stars, forks, issues)", guest: true, any: true, github: true },
                  { feature: "Commit history & analytics", guest: false, any: true, github: true },
                  { feature: "Contributor insights & heatmaps", guest: false, any: true, github: true },
                  { feature: "Trending repository discovery", guest: false, any: true, github: true },
                  { feature: "Side-by-side repo comparison", guest: false, any: true, github: true },
                  { feature: "DORA metrics (cycle time, lead time)", guest: false, any: false, github: true },
                  { feature: "Organization Pulse (all your orgs)", guest: false, any: false, github: true },
                  { feature: "Live activity feed", guest: false, any: false, github: true },
                  { feature: "Dependency Radar (tech stack graph)", guest: false, any: false, github: true },
                  { feature: "AI PR risk scoring (Claude)", guest: false, any: false, github: true },
                ].map((row) => (
                  <tr key={row.feature} className="hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 pr-6 text-xs text-foreground/80">{row.feature}</td>
                    {([row.guest, row.any, row.github] as const).map((has, i) => (
                      <td key={i} className="py-2.5 px-4 text-center">
                        {has
                          ? <CheckCircle2 className={`size-4 mx-auto ${i === 2 ? "text-amber-500" : i === 1 ? "text-primary" : "text-muted-foreground/60"}`} />
                          : <span className="text-muted-foreground/20 text-lg leading-none">—</span>
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 flex flex-wrap gap-3 justify-center">
            <Link href="/login" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-none btn-gitscope-primary text-sm font-bold">
              <Github className="size-4" /> Sign in with GitHub — Full Access <ArrowRight className="size-4" />
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-none border border-border hover:bg-muted text-sm font-bold transition-all">
              Create free account <ChevronRight className="size-4" />
            </Link>
          </div>
        </div>

        {/* Why trust GitScope? */}
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { icon: Shield, title: "Your code stays yours", desc: "We only access GitHub metadata (commits, PRs, contributors). We never clone or store your code.", color: "text-emerald-500" },
            { icon: TrendingUp, title: "Real data, always live", desc: "All analytics use the GitHub API in real-time. No stale snapshots or cached estimates.", color: "text-primary" },
            { icon: Zap, title: "Uses your rate limit", desc: "GitHub OAuth users get their own 5000 req/hr limit — we never pool tokens or share rate limits.", color: "text-amber-500" },
          ].map((item) => (
            <div key={item.title} className="rounded-none border border-border bg-card p-5">
              <item.icon className={`size-6 ${item.color} mb-3`} />
              <h3 className="font-black text-sm mb-1">{item.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>

      {/* Repo Preview */}
        {loadingRepo ? (
          <div className="rounded-none border border-border bg-card p-8 space-y-4 animate-pulse">
            <div className="h-6 bg-muted rounded w-1/3" />
            <div className="h-4 bg-muted rounded w-2/3" />
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-none" />)}
            </div>
          </div>
        ) : selectedRepo ? (
          <motion.div
            key={selectedRepo.full_name}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Repo header */}
            <div className="rounded-none border border-border bg-card p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-4">
                  <NextImage
                    src={selectedRepo.owner.avatar_url}
                    width={56}
                    height={56}
                    alt=""
                    className="size-14 rounded-none border border-border/50"
                  />
                  <div>
                    <h2 className="text-xl font-black tracking-tight">{selectedRepo.full_name}</h2>
                    <p className="text-sm text-muted-foreground mt-1 max-w-xl">{selectedRepo.description}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {selectedRepo.topics.slice(0, 6).map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-full bg-primary/10 text-[10px] font-bold text-primary">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <a
                  href={selectedRepo.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-none border border-border hover:bg-muted text-sm font-bold transition-all"
                >
                  <Github className="size-4" />
                  View on GitHub
                  <ExternalLink className="size-3.5" />
                </a>
              </div>

              {/* Basic stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
                {[
                  { label: "Stars", value: fmt(selectedRepo.stargazers_count), icon: Star, color: "text-yellow-500" },
                  { label: "Forks", value: fmt(selectedRepo.forks_count), icon: GitFork, color: "text-amber-500" },
                  { label: "Watchers", value: fmt(selectedRepo.watchers_count), icon: Eye, color: "text-emerald-500" },
                  { label: "Open Issues", value: fmt(selectedRepo.open_issues_count), icon: Code2, color: "text-rose-500" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-none bg-muted/30 border border-border/50 p-4 flex items-center gap-3">
                    <stat.icon className={`size-5 ${stat.color}`} />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{stat.label}</p>
                      <p className="text-xl font-black">{stat.value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {selectedRepo.language && (
                <div className="mt-4 flex items-center gap-2">
                  <span className="size-3 rounded-full bg-primary" />
                  <span className="text-sm font-mono text-muted-foreground">{selectedRepo.language}</span>
                </div>
              )}
            </div>

            {/* Locked features gate */}
            <div className="rounded-none border border-primary/20 bg-primary/5 p-6">
              <div className="flex items-center gap-3 mb-4">
                <Lock className="size-5 text-primary/60" />
                <h3 className="text-base font-black">Full Analytics Locked</h3>
                <span className="text-xs text-muted-foreground">Sign in to unlock everything below</span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                {LOCKED_FEATURES.map(({ icon: Icon, label, tier }) => (
                  <div key={label} className="flex items-center gap-3 p-3 rounded-none bg-card border border-border/50 opacity-60">
                    <div className="size-8 rounded-none bg-muted flex items-center justify-center">
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-xs font-bold">{label}</p>
                      <p className="text-[10px] text-muted-foreground">{tier}</p>
                    </div>
                    <Lock className="size-3 text-muted-foreground/40 ml-auto shrink-0" />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-none btn-gitscope-primary text-sm font-bold"
                >
                  <Github className="size-4" />
                  Sign in with GitHub — Full Access
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-none border border-border hover:bg-muted text-sm font-bold transition-all"
                >
                  Sign up with Email
                  <ChevronRight className="size-4" />
                </Link>
              </div>
            </div>

            {/* Blurred fake chart teaser */}
            <div className="rounded-none border border-border bg-card p-6 relative overflow-hidden">
              <div className="absolute inset-0 backdrop-blur-sm bg-background/60 z-10 flex flex-col items-center justify-center gap-3">
                <Lock className="size-8 text-muted-foreground/30" />
                <p className="text-sm font-bold text-muted-foreground">Commit Activity Chart — Sign in to view</p>
                <Link href="/login" className="inline-flex items-center gap-2 px-5 py-2 rounded-none btn-gitscope-primary text-xs font-bold">
                  Unlock Full Analytics
                </Link>
              </div>
              {/* Fake chart behind blur */}
              <h3 className="text-sm font-bold mb-4 text-muted-foreground">Commit Activity (Last 12 Months)</h3>
              <div className="flex items-end gap-1 h-24 opacity-30">
                {["h-[30%]","h-[45%]","h-[25%]","h-[60%]","h-[50%]","h-[70%]","h-[80%]","h-[55%]","h-[90%]","h-[75%]","h-[40%]","h-[85%]"].map((h, i) => (
                  <div key={i} className={`flex-1 bg-primary/60 rounded-t-sm ${h}`} />
                ))}
              </div>
            </div>
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}
