"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { MaterialIcon } from "@/components/material-icon";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getUser } from "@/services/githubClient";
import { useAppDispatch } from "@/store/hooks";
import { addRecentSearch } from "@/store/slices/dashboardSlice";
import { useRecentHistory } from "@/hooks/use-recent-history";
import type { GitHubUser, GitHubRepo, Contribution } from "@/types/github";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Users,
  GitFork,
  Star,
  MapPin,
  Building,
  Link as LinkIcon,
  Calendar,
  Mail,
  ExternalLink,
  Code,
  TrendingUp,
  FolderGit,
  Hash,
  Eye
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts/es6";

// Helper to get color for programming languages
function getLanguageColor(language: string): string {
  const colors: { [key: string]: string } = {
    JavaScript: "#f1e05a",
    TypeScript: "#2b7489",
    Python: "#3572A5",
    Java: "#b07219",
    "C++": "#f34b7d",
    C: "#555555",
    "C#": "#178600",
    Ruby: "#701516",
    Go: "#00ADD8",
    Rust: "#dea584",
    PHP: "#4F5D95",
    Swift: "#ffac45",
    Kotlin: "#A97BFF",
    "Objective-C": "#438eff",
    Shell: "#89e051",
    R: "#198CE7",
    "Jupyter Notebook": "#DA5B0B",
    Vue: "#41b883",
    HTML: "#e34c26",
    CSS: "#563d7c",
    SCSS: "#c6538c",
    Dart: "#00B4AB",
    Elixir: "#6e4a7e",
    Haskell: "#5e5086",
    Scala: "#c22d40",
    Perl: "#0298c3",
    Lua: "#000080",
    Clojure: "#db5855",
    Erlang: "#B83998",
    MATLAB: "#e16737",
    Groovy: "#e69f56",
    TeX: "#3D6117",
    PowerShell: "#012456",
    Vim: "#199f4b",
    "Visual Basic": "#945db7",
    Assembly: "#6E4C13",
    PLSQL: "#dad8d8",
    SQL: "#dad8d8",
    JSON: "#292929",
    YAML: "#cb171e",
    Markdown: "#083fa1",
    XML: "#0060ac",
    Dockerfile: "#384d54",
    Makefile: "#427819",
    CMake: "#DA3434",
    Nix: "#7e7eff",
    OCaml: "#3be133",
    Raku: "#0000fb",
    V: "#4f87d4",
    Zig: "#ec915c",
    Julia: "#a270ba",
    Solidity: "#AA6746",
    WebAssembly: "#04133b",
    EmacsLisp: "#c065db",
    D: "#ba595e",
    FORTRAN: "#4d41b1",
    Ada: "#02f88c",
    Pascal: "#E3F171",
    Prolog: "#74283c",
    Smalltalk: "#596706",
    APL: "#5A9E4F",
    Brainfuck: "#2F2530",
    Eiffel: "#4d6977",
    Elm: "#60B5CC",
    GAP: "#0000cc",
    GDScript: "#355570",
    Haxe: "#df7900",
    Idris: "#b30000",
    Lean: "#69d6f1",
    Mercury: "#ff2b2b",
    Nim: "#ffc200",
    Q: "#0040cd",
    Racket: "#3c5caa",
    Rebol: "#358a5b",
    Red: "#f50000",
    Sass: "#a53b54",
    Stan: "#b2011d",
    Svelte: "#ff3e00",
    Terra: "#00004c",
    Twig: "#c1d026",
    Vala: "#a56de2",
    Verilog: "#b2b7f8",
    VHDL: "#adb2be",
    Wdl: "#42f1f4",
    XQuery: "#5232e7",
    Yacc: "#4B6C4B",
    Zephir: "#118f9e",
    Other: "#cccccc",
  };
  
  return colors[language] || "#cccccc";
}

/* ─── Language Distribution ─── */
function LanguageDistribution({ repos, languageStats, loading }: { repos: GitHubRepo[]; languageStats?: Record<string, number>; loading: boolean }) {
  // Use real code bytes from API if available, fallback to repo count
  const languages = useMemo(() => {
    if (languageStats && Object.keys(languageStats).length > 0) {
      // Use real code bytes from GitHub API
      const totalBytes = Object.values(languageStats).reduce((a, b) => a + b, 0);
      return Object.entries(languageStats)
        .map(([name, bytes]) => ({
          name,
          count: bytes, // bytes of code
          percentage: Math.round((bytes / totalBytes) * 100),
          bytes,
          color: getLanguageColor(name),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    }
    
    // Fallback: count repos per language
    const counts = repos.reduce<Record<string, number>>((acc, repo) => {
      if (repo.language) {
        acc[repo.language] = (acc[repo.language] || 0) + 1;
      }
      return acc;
    }, {});
    
    return Object.entries(counts)
      .map(([name, count]) => ({
        name,
        count,
        percentage: Math.round((count / repos.length) * 100),
        bytes: 0,
        color: getLanguageColor(name),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [languageStats, repos]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl dark:bg-slate-900/30">
        <Skeleton className="mb-4 h-5 w-36" />
        <Skeleton className="h-[200px] w-full rounded-lg" />
      </div>
    );
  }

  if (languages.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl dark:bg-slate-900/30">
        <h3 className="mb-3 font-mono text-[10px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
          Language Distribution
        </h3>
        <p className="text-muted-foreground text-sm py-8 text-center">No language data available</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-md transition-all duration-300 hover:border-white/20 hover:shadow-lg dark:shadow-lg dark:hover:shadow-xl dark:bg-slate-900/30">
      <h3 className="mb-4 font-mono text-[10px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
        Language Distribution
      </h3>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={languages} layout="vertical" margin={{ left: 0, right: 20 }}>
            <XAxis type="number" hide />
            <YAxis 
              dataKey="name" 
              type="category" 
              width={80}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface-container-high)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20} name={languageStats ? "Code Bytes" : "Repositories"}>
              {languages.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {languages.slice(0, 5).map((lang) => (
          <Badge key={lang.name} variant="secondary" className="text-xs">
            <span className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: lang.color }} />
            {lang.name} ({formatBytes(lang.bytes)})
          </Badge>
        ))}
      </div>
    </div>
  );
}

// Helper to format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function UserStatsCards({
  user,
  repos,
  loading,
}: {
  user: GitHubUser | null;
  repos: GitHubRepo[];
  loading: boolean;
}) {
  const stats = useMemo(() => {
    const totalStars = repos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
    const totalForks = repos.reduce((sum, repo) => sum + repo.forks_count, 0);
    const activeRepos = repos.filter(repo =>
      new Date(repo.updated_at) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    ).length;
    const topLanguage = repos
      .filter(r => r.language)
      .map(r => r.language as string)
      .sort((a, b) =>
        repos.filter(r => r.language === b).length -
        repos.filter(r => r.language === a).length
      )[0] || "N/A";

    return [
      { title: "Followers", value: user?.followers.toLocaleString() ?? "0", icon: Users, color: "text-blue-400", bg: "bg-blue-400/10", trend: null },
      { title: "Following", value: user?.following.toLocaleString() ?? "0", icon: Users, color: "text-green-400", bg: "bg-green-400/10", trend: null },
      { title: "Total Stars", value: totalStars.toLocaleString(), icon: Star, color: "text-yellow-400", bg: "bg-yellow-400/10", trend: null },
      { title: "Total Forks", value: totalForks.toLocaleString(), icon: GitFork, color: "text-purple-400", bg: "bg-purple-400/10", trend: null },
      { title: "Active Repos", value: activeRepos.toString(), icon: FolderGit, color: "text-orange-400", bg: "bg-orange-400/10", trend: null },
      { title: "Top Language", value: topLanguage, icon: Code, color: "text-pink-400", bg: "bg-pink-400/10", trend: null },
    ];
  }, [user, repos]);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-6">
            <Skeleton className="mb-2 h-4 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-md transition-all duration-300 hover:border-white/20 hover:shadow-lg dark:shadow-lg dark:hover:shadow-xl dark:bg-slate-900/30"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                {stat.title}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {stat.value}
              </p>
            </div>
            <div className={cn("rounded-lg p-2", stat.bg)}>
              <stat.icon className={cn("h-5 w-5", stat.color)} />
            </div>
          </div>
          {stat.trend && (
            <div className="mt-2 flex items-center gap-1 text-xs">
              <TrendingUp className="h-3 w-3 text-emerald-500" />
              <span className="text-emerald-500 font-medium">{stat.trend}</span>
              <span className="text-muted-foreground">this month</span>
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

/* ─── Repository Card ─── */
function RepoCard({ repo, username, index }: { repo: GitHubRepo; username: string; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group rounded-xl border border-white/5 bg-white/2 p-4 shadow-sm transition-all duration-200 hover:border-white/10 hover:bg-white/5 hover:shadow-md dark:shadow-md dark:hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <FolderGit className="h-4 w-4 text-muted-foreground" />
            <a
              href={`/dashboard/${username}/${repo.name}`}
              className="font-mono text-sm font-semibold text-primary hover:underline truncate"
            >
              {repo.name}
            </a>
            {repo.fork && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                Fork
              </Badge>
            )}
          </div>
          {repo.description && (
            <p className="text-muted-foreground mb-3 line-clamp-2 text-xs">
              {repo.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
            {repo.language && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {repo.language}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {repo.stargazers_count.toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <GitFork className="h-3 w-3" />
              {repo.forks_count.toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {repo.watchers_count.toLocaleString()}
            </span>
          </div>
        </div>
        <a
          href={repo.html_url}
          target="_blank"
          rel="noreferrer"
          className="opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ExternalLink className="h-4 w-4 text-muted-foreground" />
        </a>
      </div>
    </motion.div>
  );
}

/* ─── Repository Grid ─── */
function RepositoryGrid({ repos, loading, username }: { repos: GitHubRepo[]; loading: boolean; username: string }) {
  const [filter, setFilter] = useState<"all" | "forks" | "sources">("all");
  const [sortBy, setSortBy] = useState<"stars" | "updated" | "forks">("stars");
  const [showAll, setShowAll] = useState(false);

  const filteredRepos = useMemo(() => {
    let filtered = repos;
    if (filter === "forks") filtered = repos.filter(r => r.fork);
    if (filter === "sources") filtered = repos.filter(r => !r.fork);
    
    return [...filtered].sort((a, b) => {
      if (sortBy === "stars") return b.stargazers_count - a.stargazers_count;
      if (sortBy === "forks") return b.forks_count - a.forks_count;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [repos, filter, sortBy]);

  const displayedRepos = showAll ? filteredRepos : filteredRepos.slice(0, 12);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-md transition-all duration-300 hover:border-white/20 hover:shadow-lg dark:shadow-lg dark:hover:shadow-xl dark:bg-slate-900/30">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h3 className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
          Repositories ({filteredRepos.length})
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
            {(["all", "sources", "forks"] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setShowAll(false); }}
                className={cn(
                  "rounded-md px-2 py-1 text-[10px] font-medium transition-all capitalize",
                  filter === f
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
            {(["stars", "updated", "forks"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={cn(
                  "rounded-md px-2 py-1 text-[10px] font-medium transition-all capitalize",
                  sortBy === s
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={cn("grid gap-3", showAll ? "grid-cols-1 md:grid-cols-2" : "md:grid-cols-2")}>
        {displayedRepos.map((repo, index) => (
          <RepoCard key={repo.id} repo={repo} username={username} index={index} />
        ))}
      </div>

      {filteredRepos.length > 12 && (
        <div className="mt-4 text-center">
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-xs"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "Show less" : `View all ${filteredRepos.length} repositories`}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── User Info Sidebar ─── */
function UserInfoSidebar({ user, loading }: { user: GitHubUser | null; loading: boolean }) {
  if (loading || !user) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  const links = [
    { icon: Building, label: "Company", value: user.company, href: null },
    { icon: MapPin, label: "Location", value: user.location, href: null },
    { icon: Mail, label: "Email", value: user.email, href: user.email ? `mailto:${user.email}` : null },
    { icon: LinkIcon, label: "Website", value: user.blog, href: user.blog ? (user.blog.startsWith('http') ? user.blog : `https://${user.blog}`) : null },
    { icon: Hash, label: "Twitter", value: user.twitter_username ? `@${user.twitter_username}` : null, href: user.twitter_username ? `https://twitter.com/${user.twitter_username}` : null },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-md dark:shadow-lg dark:bg-slate-900/30">
        <h4 className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase mb-4">
          Contact & Links
        </h4>
        <div className="space-y-3">
          {links.map((link) => link.value && (
            <div key={link.label} className="flex items-center gap-3">
              <link.icon className="h-4 w-4 text-muted-foreground" />
              {link.href ? (
                <a
                  href={link.href}
                  target={link.href.startsWith('http') ? "_blank" : undefined}
                  rel={link.href.startsWith('http') ? "noreferrer" : undefined}
                  className="text-sm text-primary hover:underline truncate"
                >
                  {link.value}
                </a>
              ) : (
                <span className="text-sm">{link.value}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-md dark:shadow-lg dark:bg-slate-900/30">
        <h4 className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground uppercase mb-4">
          Account Info
        </h4>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Joined</span>
            <span>{new Date(user.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Last Updated</span>
            <span>{new Date(user.updated_at).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Public Repos</span>
            <span className="font-medium">{user.public_repos}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main: UserProfile ─── */
export function UserProfile({ username }: { username: string }) {
  const dispatch = useAppDispatch();
  const { addToHistory } = useRecentHistory();
  const queryClient = useQueryClient();

  const userQ = useQuery({
    queryKey: ["user", username],
    queryFn: () => getUser(username),
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  });

  useEffect(() => {
    if (userQ.isSuccess) {
      dispatch(addRecentSearch({ owner: username, repo: "" }));
      addToHistory({
        id: username,
        name: username,
        type: "user",
        avatar: userQ.data?.user?.avatar_url,
      });
    }
  }, [dispatch, username, userQ.isSuccess, userQ.data?.user?.avatar_url, addToHistory]);

  const loading = userQ.isLoading;
  const err = userQ.error as Error | undefined;

  if (err) {
    return (
      <div className="border-destructive/40 bg-destructive/5 rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Could not load user profile</h2>
        <p className="text-muted-foreground mt-2 text-sm">{err.message}</p>
        <p className="text-muted-foreground mt-3 text-sm">
          Tip: add a{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">GITHUB_TOKEN</code>
          {" "}in{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">.env.local</code>
          {" "}for higher rate limits (5k/hr).
        </p>
      </div>
    );
  }

  const user: GitHubUser | null = userQ.data?.user ?? null;
  const repos = userQ.data?.repos ?? [];
  const contributions = userQ.data?.contributions ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-6"
    >
      {/* ── Header Card ── */}
      <div className="rounded-2xl border border-white/10 bg-linear-to-br from-white/10 to-white/5 p-6 backdrop-blur-xl shadow-lg dark:shadow-xl dark:bg-slate-900/30">
        <div className="flex flex-col md:flex-row md:items-start gap-6">
          <motion.img
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            src={user?.avatar_url ?? `https://github.com/${username}.png`}
            alt={username}
            className="h-28 w-28 rounded-2xl border-2 border-white/20 shadow-xl"
          />
          <div className="flex-1 min-w-0">
            <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
              <div className="flex-1">
                <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                  {user?.name || username}
                </h1>
                <p className="font-mono text-sm text-muted-foreground mt-1">
                  @{username}
                </p>
              </div>
              {user?.html_url && (
                <a
                  href={user.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "btn-gitscope-primary inline-flex items-center rounded-md font-bold shrink-0"
                  )}
                >
                  <ExternalLink className="mr-2 size-4" />
                  View on GitHub
                </a>
              )}
            </div>
            {user?.bio && (
              <p className="text-foreground mt-4 text-sm leading-relaxed max-w-2xl">
                {user.bio}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Content Grid ── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px] xl:grid-cols-[1fr_320px]">
        <div className="space-y-6 order-2 lg:order-1">
          <UserStatsCards user={user} repos={repos} loading={loading} />
          
          <Tabs defaultValue="repositories" className="w-full">
            <TabsList className="w-full justify-start bg-white/5 border border-white/10 p-1 overflow-x-auto">
              <TabsTrigger value="repositories" className="text-xs">
                <FolderGit className="mr-2 h-3.5 w-3.5" />
                Repositories
              </TabsTrigger>
              <TabsTrigger value="languages" className="text-xs">
                <Code className="mr-2 h-3.5 w-3.5" />
                Languages
              </TabsTrigger>
            </TabsList>
            <TabsContent value="repositories" className="mt-4">
              <RepositoryGrid repos={repos} loading={loading} username={username} />
            </TabsContent>
            <TabsContent value="languages" className="mt-4">
              <LanguageDistribution repos={repos} languageStats={userQ.data?.languageStats} loading={loading} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="order-1 lg:order-2">
          <UserInfoSidebar user={user} loading={loading} />
        </div>
      </div>

      <p className="text-muted-foreground text-center text-xs">
        Profile data is derived from public GitHub APIs. Rate limits apply without a token.
      </p>
    </motion.div>
  );
}
