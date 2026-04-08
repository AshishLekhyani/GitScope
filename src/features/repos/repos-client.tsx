"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { MyRepo } from "@/app/api/github/my-repos/route";

// ── Language colors (GitHub's palette) ───────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5",
  Rust: "#dea584", Go: "#00ADD8", Java: "#b07219", "C++": "#f34b7d",
  C: "#555555", "C#": "#178600", Ruby: "#701516", PHP: "#4F5D95",
  Swift: "#F05138", Kotlin: "#A97BFF", Dart: "#00B4AB", Vue: "#41b883",
  Svelte: "#ff3e00", Shell: "#89e051", HTML: "#e34c26", CSS: "#563d7c",
  SCSS: "#c6538c", Dockerfile: "#384d54", Lua: "#000080",
  Haskell: "#5e5086", Elixir: "#6e4a7e", Clojure: "#db5855",
  Scala: "#c22d40", "F#": "#b845fc", R: "#198CE7", MATLAB: "#e16737",
};

function getLangColor(lang: string | null): string {
  if (!lang) return "#6b7280";
  return LANG_COLORS[lang] ?? "#6b7280";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function getActivityLevel(pushedAt: string): { label: string; color: string } {
  const days = Math.floor((Date.now() - new Date(pushedAt).getTime()) / 86400000);
  if (days < 7) return { label: "Active", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  if (days < 30) return { label: "Recent", color: "text-teal-400 bg-teal-500/10 border-teal-500/20" };
  if (days < 90) return { label: "Moderate", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
  if (days < 365) return { label: "Slow", color: "text-orange-400 bg-orange-500/10 border-orange-500/20" };
  return { label: "Stale", color: "text-muted-foreground/40 bg-surface-container-highest border-outline-variant/10" };
}

// ── Repo Card ─────────────────────────────────────────────────────────────────

function RepoCard({ repo, viewMode }: { repo: MyRepo; viewMode: "grid" | "list" }) {
  const router = useRouter();
  const langColor = getLangColor(repo.language);
  const activity = getActivityLevel(repo.pushed_at);
  const [imgError, setImgError] = useState(false);

  const handleAnalyze = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/intelligence?repo=${encodeURIComponent(repo.full_name)}`);
  };

  const handleDashboard = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const [owner, name] = repo.full_name.split("/");
    router.push(`/dashboard/${owner}/${name}`);
  };

  if (viewMode === "list") {
    return (
      <a
        href={repo.html_url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-4 px-5 py-4 rounded-2xl border border-outline-variant/10 bg-surface-container/15 hover:bg-surface-container/40 hover:border-indigo-500/20 transition-all"
      >
        {/* Owner avatar */}
        <div className="size-10 rounded-xl overflow-hidden shrink-0 bg-surface-container-highest border border-outline-variant/10">
          {!imgError ? (
            <Image
              src={repo.owner.avatar_url}
              alt={repo.owner.login}
              width={40} height={40}
              className="size-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="size-full flex items-center justify-center">
              <MaterialIcon name="folder" size={20} className="text-muted-foreground/30" />
            </div>
          )}
        </div>

        {/* Name + description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-black text-foreground/90 truncate">{repo.full_name}</span>
            {repo.private && (
              <MaterialIcon name="lock" size={12} className="text-amber-400 shrink-0" />
            )}
            {repo.archived && (
              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-surface-container-highest text-muted-foreground/50 border border-outline-variant/10 shrink-0">
                archived
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/50 truncate">
            {repo.description ?? "No description"}
          </p>
        </div>

        {/* Language */}
        {repo.language && (
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: langColor }} />
            <span className="text-[10px] font-bold text-muted-foreground/60">{repo.language}</span>
          </div>
        )}

        {/* Stats */}
        <div className="hidden md:flex items-center gap-4 shrink-0">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
            <MaterialIcon name="star" size={11} className="text-amber-400" />
            {formatCount(repo.stargazers_count)}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
            <MaterialIcon name="fork_right" size={11} />
            {formatCount(repo.forks_count)}
          </span>
        </div>

        {/* Activity + time */}
        <div className="hidden lg:flex items-center gap-2 shrink-0">
          <span className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border", activity.color)}>
            {activity.label}
          </span>
          <span className="text-[10px] text-muted-foreground/40">{timeAgo(repo.pushed_at)}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={handleDashboard}
            className="size-8 rounded-xl bg-surface-container-highest hover:bg-indigo-500/10 flex items-center justify-center transition-colors"
          >
            <MaterialIcon name="dashboard" size={14} className="text-muted-foreground/60 hover:text-indigo-400" />
          </button>
          <button
            type="button"
            onClick={handleAnalyze}
            className="size-8 rounded-xl bg-indigo-500/10 hover:bg-indigo-500 flex items-center justify-center transition-colors group/btn"
          >
            <MaterialIcon name="auto_awesome" size={14} className="text-indigo-400 group-hover/btn:text-white" />
          </button>
        </div>
      </a>
    );
  }

  // Grid card
  return (
    <div className="group relative flex flex-col rounded-3xl border border-outline-variant/10 bg-surface-container/15 hover:bg-surface-container/35 hover:border-indigo-500/20 transition-all overflow-hidden cursor-pointer"
      onClick={() => window.open(repo.html_url, "_blank", "noopener noreferrer")}
    >
      {/* Language color header */}
      <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: langColor, opacity: 0.7 }} />

      {/* Card body */}
      <div className="flex flex-col flex-1 p-4 gap-3">

        {/* Owner + name row */}
        <div className="flex items-start gap-2.5">
          <div className="size-9 rounded-xl overflow-hidden shrink-0 bg-surface-container-highest border border-outline-variant/10">
            {!imgError ? (
              <Image
                src={repo.owner.avatar_url}
                alt={repo.owner.login}
                width={36} height={36}
                className="size-full object-cover"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="size-full flex items-center justify-center">
                <MaterialIcon name="person" size={18} className="text-muted-foreground/30" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-black text-muted-foreground/50 truncate">{repo.owner.login}</span>
              {repo.private && (
                <MaterialIcon name="lock" size={10} className="text-amber-400 shrink-0" />
              )}
              {repo.owner.type === "Organization" && (
                <MaterialIcon name="corporate_fare" size={10} className="text-indigo-400 shrink-0" />
              )}
            </div>
            <p className="text-sm font-black text-foreground/90 truncate leading-tight">{repo.name}</p>
          </div>
          <div className={cn("text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full border shrink-0", activity.color)}>
            {activity.label}
          </div>
        </div>

        {/* Description */}
        <p className="text-[11px] text-muted-foreground/55 leading-relaxed line-clamp-2 flex-1">
          {repo.description ?? "No description provided."}
        </p>

        {/* Topics */}
        {repo.topics.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {repo.topics.slice(0, 3).map((t) => (
              <span key={t} className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/8 border border-indigo-500/12 text-indigo-400">
                {t}
              </span>
            ))}
            {repo.topics.length > 3 && (
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-surface-container-highest border border-outline-variant/10 text-muted-foreground/40">
                +{repo.topics.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-3 pt-1 border-t border-outline-variant/8">
          {repo.language && (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: langColor }} />
              <span className="text-[9px] font-bold text-muted-foreground/50 truncate">{repo.language}</span>
            </div>
          )}
          <span className="flex items-center gap-1 text-[9px] text-muted-foreground/50 shrink-0">
            <MaterialIcon name="star" size={10} className="text-amber-400" />
            {formatCount(repo.stargazers_count)}
          </span>
          <span className="flex items-center gap-1 text-[9px] text-muted-foreground/50 shrink-0">
            <MaterialIcon name="fork_right" size={10} />
            {formatCount(repo.forks_count)}
          </span>
          {repo.open_issues_count > 0 && (
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground/50 shrink-0">
              <MaterialIcon name="circle" size={8} className="text-orange-400" />
              {repo.open_issues_count}
            </span>
          )}
        </div>

        {/* Last push */}
        <p className="text-[9px] text-muted-foreground/35 font-mono">
          Updated {timeAgo(repo.pushed_at)}
          {repo.license && ` · ${repo.license.spdx_id}`}
        </p>
      </div>

      {/* Hover action overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all rounded-3xl flex items-end justify-end p-3 gap-2">
        <button
          type="button"
          onClick={handleDashboard}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-white text-[10px] font-black uppercase tracking-wider hover:bg-white/20 transition-colors"
        >
          <MaterialIcon name="dashboard" size={12} /> Insights
        </button>
        <button
          type="button"
          onClick={handleAnalyze}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500 border border-indigo-400 text-white text-[10px] font-black uppercase tracking-wider hover:bg-indigo-600 transition-colors shadow-lg shadow-indigo-500/30"
        >
          <MaterialIcon name="auto_awesome" size={12} /> AI Analyze
        </button>
      </div>

      {/* Access level badge */}
      {repo.accessLevel === "admin" && (
        <div className="absolute top-3 right-3 size-5 rounded-full bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center">
          <MaterialIcon name="admin_panel_settings" size={12} className="text-indigo-400" />
        </div>
      )}
    </div>
  );
}

// ── Filter state ──────────────────────────────────────────────────────────────

type FilterType = "all" | "owned" | "contributed" | "private" | "public" | "archived" | "forked";
type SortType = "updated" | "stars" | "name" | "issues" | "forks";
type ViewMode = "grid" | "list";

// ── Main component ────────────────────────────────────────────────────────────

interface ReposMeta {
  total: number;
  private: number;
  public: number;
  owned: number;
  source: string;
  githubUser?: string;
  message?: string;
}

export function ReposClient() {
  const [repos, setRepos] = useState<MyRepo[]>([]);
  const [meta, setMeta] = useState<ReposMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortType>("updated");
  const [langFilter, setLangFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/github/my-repos?type=all&sort=updated&visibility=all")
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((data: { repos: MyRepo[]; meta: ReposMeta }) => {
        setRepos(data.repos ?? []);
        setMeta(data.meta ?? null);
      })
      .catch(() => {
        setError("Failed to load repositories. Connect your GitHub account in Settings.");
      })
      .finally(() => setLoading(false));
  }, []);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Unique languages
  const languages = useMemo(() => {
    const langs = new Set(repos.map((r) => r.language).filter(Boolean) as string[]);
    return [...langs].sort();
  }, [repos]);

  // Filtered + sorted repos
  const filtered = useMemo(() => {
    let result = repos;

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.full_name.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q) ||
          r.topics.some((t) => t.includes(q)) ||
          (r.language ?? "").toLowerCase().includes(q)
      );
    }

    // Type filter
    if (filter === "owned") result = result.filter((r) => r.isOwned);
    else if (filter === "contributed") result = result.filter((r) => !r.isOwned && r.isContributor);
    else if (filter === "private") result = result.filter((r) => r.private);
    else if (filter === "public") result = result.filter((r) => !r.private);
    else if (filter === "archived") result = result.filter((r) => r.archived);
    else if (filter === "forked") result = result.filter((r) => r.fork);

    // Language filter
    if (langFilter) result = result.filter((r) => r.language === langFilter);

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === "stars") return b.stargazers_count - a.stargazers_count;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "issues") return b.open_issues_count - a.open_issues_count;
      if (sortBy === "forks") return b.forks_count - a.forks_count;
      // updated
      return new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime();
    });

    return result;
  }, [repos, search, filter, sortBy, langFilter]);

  const FILTER_TABS: { id: FilterType; label: string; icon: string; count?: number }[] = [
    { id: "all", label: "All", icon: "folder_open", count: repos.length },
    { id: "owned", label: "Owned", icon: "person", count: meta?.owned },
    { id: "contributed", label: "Contributor", icon: "group_add" },
    { id: "private", label: "Private", icon: "lock", count: meta?.private },
    { id: "public", label: "Public", icon: "public", count: meta?.public },
    { id: "forked", label: "Forks", icon: "fork_right" },
    { id: "archived", label: "Archived", icon: "archive" },
  ];

  return (
    <div className="space-y-8 p-1 md:p-8 animate-in fade-in duration-700 font-sans">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-outline-variant/10">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-indigo-500/5 border border-indigo-500/10">
            <span className="size-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-widest text-indigo-500/70">
              {loading ? "Loading…" : meta?.githubUser ? `@${meta.githubUser}` : "Your Repositories"}
            </span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-black bg-linear-to-br from-foreground via-foreground/90 to-foreground/40 bg-clip-text text-transparent tracking-tight">
            My <span className="text-primary italic">Repositories</span>
          </h1>
          <p className="text-sm text-muted-foreground/55 max-w-xl leading-relaxed">
            All repositories you own or contribute to — with private access, AI analysis, and insights beyond what GitHub shows.
          </p>
        </div>

        {/* Stats */}
        {meta && !loading && (
          <div className="flex flex-wrap items-center gap-3">
            {[
              { label: "Total", value: meta.total, icon: "folder", color: "text-indigo-400" },
              { label: "Private", value: meta.private, icon: "lock", color: "text-amber-400" },
              { label: "Public", value: meta.public, icon: "public", color: "text-emerald-400" },
              { label: "Owned", value: meta.owned, icon: "person", color: "text-violet-400" },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center px-4 py-2.5 rounded-2xl bg-surface-container/30 border border-outline-variant/10 min-w-[68px]">
                <span className={cn("text-xl font-black", s.color)}>{s.value}</span>
                <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40 mt-0.5">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Controls ── */}
      <div className="space-y-4">
        {/* Search + view mode */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <MaterialIcon name="search" size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search repos, topics, languages… (press / to focus)"
              className="w-full bg-surface-container/40 border border-outline-variant/15 rounded-2xl pl-11 pr-4 py-3 text-sm placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors">
                <MaterialIcon name="close" size={15} />
              </button>
            )}
          </div>

          {/* View mode toggle */}
          <div className="flex items-center gap-1 p-1 bg-surface-container/30 rounded-xl border border-outline-variant/10">
            {(["grid", "list"] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => setViewMode(mode)}
                className={cn("p-2 rounded-lg transition-all",
                  viewMode === mode ? "bg-indigo-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}>
                <MaterialIcon name={mode === "grid" ? "grid_view" : "format_list_bulleted"} size={16} />
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortType)}
            className="bg-surface-container/40 border border-outline-variant/15 rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-wider text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
          >
            {[
              { value: "updated", label: "Last Updated" },
              { value: "stars", label: "Most Stars" },
              { value: "forks", label: "Most Forked" },
              { value: "name", label: "Name A–Z" },
              { value: "issues", label: "Most Issues" },
            ].map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1.5">
          {FILTER_TABS.map((tab) => (
            <button key={tab.id} type="button" onClick={() => setFilter(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border",
                filter === tab.id
                  ? "bg-indigo-500 text-white border-indigo-500 shadow-md"
                  : "bg-surface-container/25 border-outline-variant/10 text-muted-foreground hover:border-indigo-500/20 hover:text-foreground"
              )}>
              <MaterialIcon name={tab.icon} size={11} />
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn("px-1.5 py-0.5 rounded-full text-[8px]",
                  filter === tab.id ? "bg-white/20" : "bg-surface-container-highest"
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}

          {/* Language filter */}
          {languages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-l border-outline-variant/15 pl-2">
              {languages.slice(0, 8).map((lang) => (
                <button key={lang} type="button"
                  onClick={() => setLangFilter(langFilter === lang ? null : lang)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border",
                    langFilter === lang
                      ? "bg-surface-container-highest border-indigo-500/30 text-foreground"
                      : "bg-surface-container/20 border-outline-variant/10 text-muted-foreground/60 hover:text-foreground"
                  )}>
                  <span className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: getLangColor(lang) }} />
                  {lang}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-44 rounded-3xl bg-surface-container/30 border border-outline-variant/8 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-6">
          <div className="size-20 rounded-3xl bg-amber-500/5 border border-amber-500/10 flex items-center justify-center">
            <MaterialIcon name="link_off" size={32} className="text-amber-500/40" />
          </div>
          <div>
            <h3 className="text-xl font-black mb-2">GitHub Not Connected</h3>
            <p className="text-sm text-muted-foreground/60 max-w-sm leading-relaxed">{error}</p>
          </div>
          <Link href="/settings"
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-500 text-white text-[11px] font-black uppercase tracking-wider hover:bg-indigo-600 transition-colors shadow-xl shadow-indigo-500/20">
            <MaterialIcon name="settings" size={14} /> Go to Settings
          </Link>
        </div>
      )}

      {!loading && !error && meta?.message && repos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-6">
          <div className="size-20 rounded-3xl bg-indigo-500/5 border border-indigo-500/10 flex items-center justify-center">
            <MaterialIcon name="folder_open" size={32} className="text-indigo-500/30" />
          </div>
          <div>
            <h3 className="text-xl font-black mb-2">No Repositories Found</h3>
            <p className="text-sm text-muted-foreground/60 max-w-sm leading-relaxed">{meta.message}</p>
          </div>
          <Link href="/settings"
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-500 text-white text-[11px] font-black uppercase tracking-wider hover:bg-indigo-600 transition-colors">
            <MaterialIcon name="link" size={14} /> Connect GitHub
          </Link>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && repos.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <MaterialIcon name="search_off" size={40} className="text-muted-foreground/20" />
          <div>
            <p className="text-sm font-black text-foreground/60">No results for "{search}"</p>
            <p className="text-[11px] text-muted-foreground/40 mt-1">Try a different keyword or clear the filters</p>
          </div>
          <button type="button" onClick={() => { setSearch(""); setFilter("all"); setLangFilter(null); }}
            className="text-[10px] font-black uppercase tracking-wider text-indigo-400 hover:text-indigo-300 transition-colors">
            Clear all filters
          </button>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          {/* Results count */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
              {filtered.length} {filtered.length === 1 ? "repository" : "repositories"}
              {search && ` matching "${search}"`}
              {langFilter && ` · ${langFilter}`}
            </p>
          </div>

          {/* Repo grid/list */}
          {viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
              {filtered.map((repo) => (
                <RepoCard key={repo.id} repo={repo} viewMode="grid" />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((repo) => (
                <RepoCard key={repo.id} repo={repo} viewMode="list" />
              ))}
            </div>
          )}

          {/* Footer note */}
          {meta?.source === "none" && (
            <p className="text-center text-[10px] text-muted-foreground/30 pt-4">
              Showing public repositories only. Connect GitHub to see private repos.
            </p>
          )}
        </>
      )}
    </div>
  );
}
