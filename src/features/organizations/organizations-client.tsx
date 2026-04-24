"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { motion, AnimatePresence } from "framer-motion";
import { WorkspacesPanel } from "@/features/organizations/workspaces-panel";
import {
  Search,
  Building2,
  Users,
  GitFork,
  Globe,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  BarChart3,
  Zap,
  Star,
  MapPin,
  Link as LinkIcon,
  Calendar,
  ExternalLink,
  Filter,
  Grid3X3,
  LayoutList,
  Download,
  MoreHorizontal,
  Pin,
  Share2,
  Clock,
  ChevronDown,
  Github,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Hash,
  Copy,
  Check,
} from "lucide-react";

// Types
interface GitHubOrg {
  login: string;
  description: string | null;
  avatar_url: string;
  public_repos: number;
  public_members: number;
  blog?: string;
  location?: string;
  email?: string;
  created_at?: string;
  updated_at?: string;
  followers?: number;
  following?: number;
  html_url: string;
}

interface OrgRepo {
  id: number;
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  html_url: string;
  private: boolean;
  archived: boolean;
}

interface OrganizationsClientProps {
  orgs: GitHubOrg[];
  username: string;
  userId?: string;
  plan?: string;
}

type ViewMode = "grid" | "list";
type FilterTab = "all" | "active" | "largest" | "recent";

const languageColors: Record<string, string> = {
  TypeScript: "#c77a12",
  JavaScript: "#f1e05a",
  Python: "#0e9966",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#701516",
  PHP: "#a16207",
  Swift: "#ffac45",
  Kotlin: "#f59e0b",
  "C#": "#178600",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#92400e",
  Vue: "#41b883",
  React: "#61dafb",
  Dart: "#10b981",
  Scala: "#c22d40",
  null: "#6b7280",
};

export function OrganizationsClient({ orgs, username, userId = "", plan = "free" }: OrganizationsClientProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [selectedOrg, setSelectedOrg] = useState<GitHubOrg | null>(null);
  const [orgRepos, setOrgRepos] = useState<OrgRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [copiedOrg, setCopiedOrg] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Shared Workspace state
  const [workspaceOrg, setWorkspaceOrg] = useState<string | null>(null);
  const [workspaceData, setWorkspaceData] = useState<{
    repos: { repo: string; healthScore: number; securityScore: number; qualityScore: number; criticalCount: number; highCount: number; summary: string; createdAt: string; user: { name: string | null; image: string | null; githubHandle: string | null } }[];
    avgHealth: number;
    criticalRepos: number;
    total: number;
  } | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  const loadWorkspace = async (orgLogin: string) => {
    if (workspaceOrg === orgLogin) { setWorkspaceOrg(null); setWorkspaceData(null); return; }
    setWorkspaceOrg(orgLogin);
    setWorkspaceLoading(true);
    try {
      const res = await fetch(`/api/ai/team-scans?org=${encodeURIComponent(orgLogin)}`);
      if (res.ok) setWorkspaceData(await res.json());
    } catch { /* ignore */ }
    finally { setWorkspaceLoading(false); }
  };

  // Stats calculations
  const stats = useMemo(() => {
    const totalRepos = orgs.reduce((sum, org) => sum + (org.public_repos || 0), 0);
    const totalMembers = orgs.reduce((sum, org) => sum + (org.public_members || 0), 0);
    const avgRepos = orgs.length > 0 ? Math.round(totalRepos / orgs.length) : 0;
    const largestOrg = orgs.reduce((max, org) => 
      (org.public_repos || 0) > (max?.public_repos || 0) ? org : max, orgs[0]
    );
    
    return {
      totalOrgs: orgs.length,
      totalRepos,
      totalMembers,
      avgRepos,
      largestOrg,
    };
  }, [orgs]);

  // Filter and sort organizations
  const filteredOrgs = useMemo(() => {
    let result = [...orgs];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (org) =>
          org.login.toLowerCase().includes(query) ||
          org.description?.toLowerCase().includes(query) ||
          org.location?.toLowerCase().includes(query)
      );
    }

    // Tab filter
    switch (filterTab) {
      case "active":
        // Sort by recent update (if available) or repos
        result.sort((a, b) => (b.public_repos || 0) - (a.public_repos || 0));
        break;
      case "largest":
        result.sort((a, b) => (b.public_repos || 0) - (a.public_repos || 0));
        break;
      case "recent":
        // Would need created_at from API, fallback to repos
        result.sort((a, b) => (b.public_repos || 0) - (a.public_repos || 0));
        break;
      default:
        // Default: alphabetical
        result.sort((a, b) => a.login.localeCompare(b.login));
    }

    return result;
  }, [orgs, searchQuery, filterTab]);

  // Fetch org repos when opening modal
  const fetchOrgRepos = async (org: GitHubOrg) => {
    setIsLoadingRepos(true);
    try {
      // Note: In production, this should use your API route with proper auth
      const response = await fetch(
        `https://api.github.com/orgs/${org.login}/repos?sort=updated&per_page=10`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
          },
        }
      );
      if (response.ok) {
        const repos = await response.json();
        setOrgRepos(repos);
      }
    } catch (error) {
      console.error("Failed to fetch repos:", error);
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const handleOrgClick = async (org: GitHubOrg) => {
    setSelectedOrg(org);
    await fetchOrgRepos(org);
  };

  // Copy org name
  const copyOrgName = async (name: string) => {
    await navigator.clipboard.writeText(name);
    setCopiedOrg(name);
    setTimeout(() => setCopiedOrg(null), 2000);
  };

  // Export orgs data
  const exportOrgs = () => {
    const data = {
      organizations: orgs,
      stats,
      exportedAt: new Date().toISOString(),
      exportedBy: username,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `organizations-export-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Quick search for external org
  const handleQuickSearch = () => {
    const trimmed = searchQuery.trim().replace(/^@/, "");
    if (!trimmed) return;
    window.open(`https://github.com/${trimmed}`, "_blank", "noopener,noreferrer");
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  // Calculate trend (mock - would need historical data)
  const getTrend = (org: GitHubOrg) => {
    // Generate deterministic "random" trend based on org name
    const hash = org.login.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const trend = ((hash % 40) - 15); // -15 to +25
    return trend;
  };

  if (orgs.length === 0) {
    return (
      <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
        <EmptyState username={username} />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
        >
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-3">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Connected Account
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <Building2 className="size-8 text-amber-500" />
              Organization Pulse
            </h1>
            <p className="text-muted-foreground mt-1.5 text-sm">
              Your GitHub organizations — real-time data from {username}&apos;s connected account.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={exportOrgs}
              className="gap-2"
            >
              <Download size={16} />
              Export
            </Button>
            <div className="flex items-center gap-4 px-5 py-3 rounded-none bg-card border border-border shadow-sm">
              <div className="p-2 rounded-none bg-amber-500/10">
                <Building2 size={18} className="text-amber-500" />
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Organizations
                </div>
                <div className="text-2xl font-bold">{filteredOrgs.length}</div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Workspaces — seat management */}
        <WorkspacesPanel currentUserId={userId} plan={plan} />

        {/* Bento Stats Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <StatCard
            label="Total Organizations"
            value={stats.totalOrgs}
            icon={Building2}
            color="amber"
            trend={+12}
          />
          <StatCard
            label="Total Repositories"
            value={stats.totalRepos.toLocaleString()}
            icon={GitFork}
            color="emerald"
            trend={+8}
          />
          <StatCard
            label="Total Members"
            value={stats.totalMembers.toLocaleString()}
            icon={Users}
            color="amber"
            trend={+5}
          />
          <StatCard
            label="Avg Repos/Org"
            value={stats.avgRepos}
            icon={BarChart3}
            color="purple"
            trend={-2}
          />
        </motion.div>

        {/* Search & Controls */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col gap-4"
        >
          <Card className="p-4 sm:p-6 bg-linear-to-br from-amber-500/5 via-transparent to-amber-500/5">
            <div className="flex flex-col gap-4">
              <div className="relative max-w-2xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
                <Input
                  placeholder="Search organizations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleQuickSearch()}
                  className="pl-10 pr-24"
                />
                <Button
                  size="sm"
                  onClick={handleQuickSearch}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <ExternalLink size={14} className="mr-1" />
                  GitHub
                </Button>
              </div>

              {/* Suggestions */}
              {orgs.length > 0 && !searchQuery && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Quick access:</span>
                  {orgs.slice(0, 5).map((org) => (
                    <button
                      key={org.login}
                      onClick={() => setSearchQuery(org.login)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Avatar className="size-4">
                        <AvatarImage src={org.avatar_url} alt={org.login} />
                        <AvatarFallback className="text-[8px]">
                          {org.login.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {org.login}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <Tabs value={filterTab} onValueChange={(v) => setFilterTab(v as FilterTab)}>
              <TabsList className="bg-muted/50">
                <TabsTrigger value="all" className="text-xs">
                  All
                </TabsTrigger>
                <TabsTrigger value="active" className="text-xs">
                  Most Active
                </TabsTrigger>
                <TabsTrigger value="largest" className="text-xs">
                  Largest
                </TabsTrigger>
                <TabsTrigger value="recent" className="text-xs">
                  Recently Updated
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={cn("gap-2", showFilters && "bg-muted")}
              >
                <Filter size={14} />
                Filters
              </Button>

              <div className="flex items-center border rounded-none p-1 bg-muted/50">
                <button
                  onClick={() => setViewMode("grid")}
                  className={cn(
                    "p-2 rounded-none transition-all",
                    viewMode === "grid" && "bg-white dark:bg-stone-800 shadow-sm"
                  )}
                >
                  <Grid3X3 size={16} />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "p-2 rounded-none transition-all",
                    viewMode === "list" && "bg-white dark:bg-stone-800 shadow-sm"
                  )}
                >
                  <LayoutList size={16} />
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Organizations Grid/List */}
        <AnimatePresence mode="wait">
          {viewMode === "grid" ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {filteredOrgs.map((org, index) => (
                <OrgCard
                  key={org.login}
                  org={org}
                  index={index}
                  onClick={() => handleOrgClick(org)}
                  onCopy={() => copyOrgName(org.login)}
                  copied={copiedOrg === org.login}
                  trend={getTrend(org)}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {filteredOrgs.map((org, index) => (
                <OrgListItem
                  key={org.login}
                  org={org}
                  index={index}
                  onClick={() => handleOrgClick(org)}
                  onCopy={() => copyOrgName(org.login)}
                  copied={copiedOrg === org.login}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Shared Workspace ─────────────────────────────────────────────── */}
        {orgs.length > 0 && (
          <div className="rounded-none border border-outline-variant/10 bg-surface-container/20 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-amber-400" />
                <span className="text-sm font-black">Shared Workspace</span>
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 uppercase tracking-widest">Team</span>
              </div>
              <p className="text-[10px] text-muted-foreground/50">Select an org to view team scan history</p>
            </div>
            <div className="flex gap-2 p-4 flex-wrap">
              {orgs.slice(0, 8).map((org) => (
                <button
                  key={org.login}
                  type="button"
                  onClick={() => loadWorkspace(org.login)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-none border text-[10px] font-black transition-all",
                    workspaceOrg === org.login
                      ? "bg-amber-500 text-white border-amber-500 shadow-lg shadow-amber-500/20"
                      : "border-outline-variant/15 text-muted-foreground hover:border-amber-500/30 hover:text-foreground"
                  )}
                >
                  <Avatar className="size-4 shrink-0">
                    <AvatarImage src={org.avatar_url} alt={org.login} />
                    <AvatarFallback className="text-[7px]">{org.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  {org.login}
                </button>
              ))}
            </div>

            {workspaceLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground/50">
                <RefreshCw className="size-4 animate-spin" />
                <span className="text-sm">Loading team scans…</span>
              </div>
            )}

            {!workspaceLoading && workspaceOrg && workspaceData && (
              <div className="px-4 pb-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                  {[
                    { label: "Repos Scanned", value: workspaceData.total, color: "text-foreground" },
                    { label: "Avg Health", value: workspaceData.avgHealth, color: workspaceData.avgHealth >= 70 ? "text-emerald-400" : workspaceData.avgHealth >= 50 ? "text-amber-400" : "text-red-400" },
                    { label: "Critical Issues", value: workspaceData.criticalRepos, color: workspaceData.criticalRepos > 0 ? "text-red-400" : "text-emerald-400" },
                  ].map((m) => (
                    <div key={m.label} className="px-4 py-3 rounded-none bg-surface-container/40 border border-outline-variant/10 space-y-0.5">
                      <p className={cn("text-xl font-black", m.color)}>{m.value}</p>
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">{m.label}</p>
                    </div>
                  ))}
                </div>

                {workspaceData.repos.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center rounded-none border-2 border-dashed border-outline-variant/10">
                    <BarChart3 className="size-8 text-muted-foreground/20" />
                    <div>
                      <p className="text-sm font-black text-foreground/50">No scans yet for {workspaceOrg}</p>
                      <p className="text-xs text-muted-foreground/40 mt-1">Use Code Lens to scan repos in this org. Results appear here for your whole team.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {workspaceData.repos.map((r) => {
                      const score = r.healthScore;
                      const scoreColor = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-red-400";
                      const barColor = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-red-500";
                      return (
                        <div key={r.repo} className="flex items-center gap-3 px-4 py-3 rounded-none bg-surface-container/30 border border-outline-variant/8 hover:border-amber-500/20 transition-all group">
                          {r.user.image && (
                            <Avatar className="size-6 shrink-0">
                              <AvatarImage src={r.user.image} alt={r.user.name ?? ""} />
                              <AvatarFallback className="text-[8px]">{(r.user.name ?? "?").slice(0, 2)}</AvatarFallback>
                            </Avatar>
                          )}
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-foreground/85 truncate">{r.repo.split("/")[1] ?? r.repo}</span>
                              {r.criticalCount > 0 && (
                                <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400">
                                  {r.criticalCount} critical
                                </span>
                              )}
                            </div>
                            <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-container-highest">
                              <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${score}%` }} />
                            </div>
                          </div>
                          <div className="text-right shrink-0 space-y-0.5">
                            <p className={cn("text-sm font-black", scoreColor)}>{score}</p>
                            <p className="text-[8px] font-mono text-muted-foreground/35">
                              {new Date(r.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
                            </p>
                          </div>
                          <Link
                            href={`/intelligence?repo=${encodeURIComponent(r.repo)}`}
                            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <ArrowUpRight className="size-4 text-amber-400" />
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Empty State for Search */}
        {filteredOrgs.length === 0 && searchQuery && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div className="size-16 rounded-none bg-muted/50 flex items-center justify-center mb-4">
              <Search className="size-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No organizations found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Try adjusting your search query or filters to find what you&apos;re looking for.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => setSearchQuery("")}>
              Clear Search
            </Button>
          </motion.div>
        )}

        {/* Organization Detail Modal */}
        <Dialog open={!!selectedOrg} onOpenChange={() => setSelectedOrg(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            {selectedOrg && (
              <>
                <DialogHeader>
                  <div className="flex items-start gap-4">
                    <Avatar className="size-16 border-2 border-border">
                      <AvatarImage src={selectedOrg.avatar_url} alt={selectedOrg.login} />
                      <AvatarFallback className="text-lg">
                        {selectedOrg.login.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <DialogTitle className="text-2xl flex items-center gap-2 flex-wrap">
                        {selectedOrg.login}
                        <Badge variant="secondary" className="text-xs">
                          <Globe className="w-3 h-3 mr-1" />
                          Public
                        </Badge>
                      </DialogTitle>
                      <DialogDescription className="mt-1">
                        {selectedOrg.description || "No description provided"}
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                {/* Quick Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-4">
                  <div className="p-4 rounded-none bg-muted/50 text-center">
                    <GitFork className="w-5 h-5 mx-auto mb-2 text-amber-500" />
                    <div className="text-xl font-bold">{selectedOrg.public_repos}</div>
                    <div className="text-xs text-muted-foreground">Repositories</div>
                  </div>
                  <div className="p-4 rounded-none bg-muted/50 text-center">
                    <Users className="w-5 h-5 mx-auto mb-2 text-amber-500" />
                    <div className="text-xl font-bold">{selectedOrg.public_members}</div>
                    <div className="text-xs text-muted-foreground">Members</div>
                  </div>
                  <div className="p-4 rounded-none bg-muted/50 text-center">
                    <Star className="w-5 h-5 mx-auto mb-2 text-amber-500" />
                    <div className="text-xl font-bold">
                      {orgRepos.reduce((sum, r) => sum + r.stargazers_count, 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">Total Stars</div>
                  </div>
                </div>

                {/* Links */}
                <div className="flex flex-wrap gap-2 mt-4">
                  <Link
                    href={`https://github.com/${selectedOrg.login}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 px-3"
                  >
                    <Github className="w-4 h-4" />
                    View on GitHub
                  </Link>
                  {selectedOrg.blog && (
                    <Link
                      href={selectedOrg.blog.startsWith("http") ? selectedOrg.blog : `https://${selectedOrg.blog}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 px-3"
                    >
                      <Globe className="w-4 h-4" />
                      Website
                    </Link>
                  )}
                </div>

                <Separator className="my-4" />

                {/* Repositories Section */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <GitFork className="w-5 h-5" />
                    Top Repositories
                    {isLoadingRepos && (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    )}
                  </h3>

                  {orgRepos.length > 0 ? (
                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                      {orgRepos.map((repo) => (
                        <Card
                          key={repo.id}
                          className="hover:shadow-md transition-shadow cursor-pointer group"
                        >
                          <Link
                            href={repo.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block p-4"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold group-hover:text-amber-500 transition-colors">
                                  {repo.name}
                                </h4>
                                {repo.private && (
                                  <Badge variant="secondary" className="text-xs">
                                    Private
                                  </Badge>
                                )}
                                {repo.archived && (
                                  <Badge variant="outline" className="text-xs">
                                    Archived
                                  </Badge>
                                )}
                              </div>
                              <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>

                            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                              {repo.description || "No description"}
                            </p>

                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              {repo.language && (
                                <span className="flex items-center gap-1">
                                  <span
                                    className="w-3 h-3 rounded-full"
                                    style={{
                                      backgroundColor:
                                        languageColors[repo.language] || "#6b7280",
                                    }}
                                  />
                                  {repo.language}
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Star className="w-3 h-3" />
                                {repo.stargazers_count.toLocaleString()}
                              </span>
                              <span className="flex items-center gap-1">
                                <GitFork className="w-3 h-3" />
                                {repo.forks_count.toLocaleString()}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDate(repo.updated_at)}
                              </span>
                            </div>
                          </Link>
                        </Card>
                      ))}
                    </div>
                  ) : isLoadingRepos ? (
                    <div className="flex items-center justify-center py-12">
                      <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No public repositories found
                    </div>
                  )}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

// Sub-components

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  trend,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color: "amber" | "emerald" | "purple" | "rose";
  trend: number;
}) {
  const colorClasses = {
    indigo: "from-amber-500 to-amber-500 bg-amber-500/10 text-amber-500",
    emerald: "from-emerald-500 to-teal-500 bg-emerald-500/10 text-emerald-500",
    blue: "from-amber-500 to-teal-500 bg-amber-500/10 text-amber-500",
    purple: "from-amber-500 to-amber-500 bg-amber-500/10 text-amber-500",
    amber: "from-amber-500 to-orange-500 bg-amber-500/10 text-amber-500",
    rose: "from-rose-500 to-red-500 bg-rose-500/10 text-rose-500",
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="relative overflow-hidden rounded-none bg-card border border-border p-5 shadow-sm hover:shadow-md transition-all"
    >
      <div className={`absolute top-0 left-0 right-0 h-1 bg-linear-to-r ${colorClasses[color].split(" ")[0]} ${colorClasses[color].split(" ")[1]}`} />
      <div className="flex items-start justify-between">
        <div className={`p-2.5 rounded-none ${colorClasses[color].split(" ")[2]}`}>
          <Icon className={`w-5 h-5 ${colorClasses[color].split(" ")[3]}`} />
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
          {trend >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {Math.abs(trend)}%
        </div>
      </div>
      <div className="mt-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </div>
    </motion.div>
  );
}

function OrgCard({
  org,
  index,
  onClick,
  onCopy,
  copied,
  trend,
}: {
  org: GitHubOrg;
  index: number;
  onClick: () => void;
  onCopy: () => void;
  copied: boolean;
  trend: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -4 }}
      onClick={onClick}
      className="group cursor-pointer"
    >
      <Card className="relative overflow-hidden h-full border-border hover:border-amber-500/30 transition-all hover:shadow-lg hover:shadow-amber-500/5">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-linear-to-r from-amber-500 to-amber-500 opacity-60 group-hover:opacity-100 transition-opacity" />
        
        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-12 rounded-none border border-border">
                <AvatarImage src={org.avatar_url} alt={org.login} />
                <AvatarFallback className="rounded-none">
                  {org.login.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="font-bold text-lg group-hover:text-amber-500 transition-colors">
                  {org.login}
                </h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <GitFork className="w-3 h-3" />
                    {org.public_repos} repos
                  </span>
                </div>
              </div>
            </div>
            <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingUp className="w-3 h-3 rotate-180" />}
              {Math.abs(trend)}%
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground line-clamp-2 mb-4 min-h-[40px]">
            {org.description || "No description provided"}
          </p>

          {/* Stats Row */}
          <div className="flex items-center gap-4 pt-4 border-t border-border/50">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="w-3.5 h-3.5" />
              <span className="font-medium text-foreground">{org.public_members}</span>
              <span>members</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitFork className="w-3.5 h-3.5" />
              <span className="font-medium text-foreground">{org.public_repos}</span>
              <span>repos</span>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/50">
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy();
                }}
                className="p-1.5 rounded-none hover:bg-muted transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
            </div>
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1 group-hover:text-amber-500 transition-colors">
              Explore
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function OrgListItem({
  org,
  index,
  onClick,
  onCopy,
  copied,
}: {
  org: GitHubOrg;
  index: number;
  onClick: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={onClick}
      className="group flex items-center gap-4 p-4 rounded-none border border-border bg-card hover:border-amber-500/30 hover:shadow-sm transition-all cursor-pointer"
    >
      <Avatar className="size-10 rounded-none">
        <AvatarImage src={org.avatar_url} alt={org.login} />
        <AvatarFallback className="rounded-none text-xs">
          {org.login.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold group-hover:text-amber-500 transition-colors">
            {org.login}
          </h4>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {org.description || "No description"}
        </p>
      </div>

      <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <GitFork className="w-4 h-4" />
          <span className="font-medium text-foreground">{org.public_repos}</span>
          <span className="text-xs">repos</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="w-4 h-4" />
          <span className="font-medium text-foreground">{org.public_members}</span>
          <span className="text-xs">members</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className="p-2 rounded-none hover:bg-muted transition-colors"
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-500" />
          ) : (
            <Copy className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-amber-500 group-hover:translate-x-0.5 transition-all" />
      </div>
    </motion.div>
  );
}

function EmptyState({ username, onExplore }: { username: string; onExplore?: (org: string) => void }) {
  const [searchOrg, setSearchOrg] = useState("");
  
  const popularOrgs = [
    { name: "vercel", description: "Develop. Preview. Ship." },
    { name: "microsoft", description: "Open source projects from Microsoft" },
    { name: "google", description: "Google's open source contributions" },
    { name: "facebook", description: "Meta's open source projects" },
    { name: "apache", description: "Apache Software Foundation" },
    { name: "netlify", description: "The fastest way to build the fastest sites" },
  ];

  return (
    <div className="space-y-8">
      {/* Main Empty State */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-16 text-center rounded-none border-2 border-dashed border-border/50 gap-6"
      >
        <div className="flex size-16 items-center justify-center rounded-none bg-amber-500/10">
          <Building2 className="size-8 text-amber-500/60" />
        </div>
        <div className="space-y-2 max-w-md">
          <h3 className="text-xl font-semibold">No Organizations Found</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your GitHub account ({username}) isn&apos;t part of any organizations yet, or your OAuth token doesn&apos;t have org:read permission.
          </p>
        </div>

        {/* Quick Org Search */}
        <div className="w-full max-w-md px-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search any organization (e.g., vercel, google)..."
              value={searchOrg}
              onChange={(e) => setSearchOrg(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchOrg && window.open(`https://github.com/${searchOrg.trim().replace(/^@/, "")}`, "_blank")}
              className="pl-10"
            />
            <Button
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => searchOrg && window.open(`https://github.com/${searchOrg.trim().replace(/^@/, "")}`, "_blank")}
              disabled={!searchOrg}
            >
              <ExternalLink size={14} className="mr-1" />
              Go
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-center">
          <Link
            href="https://github.com/settings/connections/applications"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2"
          >
            <RefreshCw className="w-4 h-4" />
            Check OAuth Permissions
          </Link>
          <Link
            href="https://github.com/account/organizations"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
          >
            <Building2 className="w-4 h-4" />
            Create Organization
          </Link>
        </div>
      </motion.div>

      {/* Popular Organizations Explorer */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-amber-500" />
          <h3 className="text-lg font-semibold">Explore Popular Organizations</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {popularOrgs.map((org, index) => (
            <motion.div
              key={org.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Link
                href={`https://github.com/${org.name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block group"
              >
                <Card className="p-4 hover:shadow-md transition-all border-border hover:border-amber-500/30">
                  <div className="flex items-start gap-3">
                    <div className="size-10 rounded-none bg-linear-to-br from-amber-500 to-amber-500 flex items-center justify-center text-white font-bold text-sm">
                      {org.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold group-hover:text-amber-500 transition-colors">
                        {org.name}
                      </h4>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {org.description}
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
