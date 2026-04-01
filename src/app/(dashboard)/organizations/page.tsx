export const dynamic = 'force-dynamic';

import { requireTier } from "@/lib/auth-tier";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import {
  Building2,
  BarChart3,
  Activity,
  ArrowRight,
  Globe,
  GitFork,
  Users,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import Image from "next/image";
import Link from "next/link";
import { OrgSearchBar } from "@/features/organizations/org-search-bar";

interface GitHubOrg {
  login: string;
  description: string | null;
  avatar_url: string;
  public_repos?: number;
  public_members?: number;
}

async function getUserOrgs(token: string): Promise<GitHubOrg[]> {
  const res = await fetch("https://api.github.com/user/orgs?per_page=30", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
    next: { revalidate: 120 },
  });
  if (!res.ok) return [];
  return res.json();
}

async function getOrgDetails(login: string, token: string): Promise<GitHubOrg & { public_repos: number; public_members: number; blog?: string } | null> {
  const res = await fetch(`https://api.github.com/orgs/${login}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
    next: { revalidate: 120 },
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function OrganizationsPage() {
  await requireTier("github");

  const session = await getServerSession(authOptions);
  const token = await getGitHubToken();

  let orgs: GitHubOrg[] = [];
  let orgDetails: (GitHubOrg & { public_repos: number; public_members: number })[] = [];

  if (token) {
    orgs = await getUserOrgs(token);
    // Fetch details for up to 9 orgs in parallel
    const details = await Promise.all(
      orgs.slice(0, 9).map((o) => getOrgDetails(o.login, token))
    );
    orgDetails = details.filter(Boolean) as typeof orgDetails;
  }

  const username = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "you";

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:space-y-8 sm:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500">
              Organization Pulse
            </span>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
              <Building2 className="size-3 text-indigo-500" />
              <span className="text-[10px] uppercase font-bold text-indigo-500 tracking-widest">
                {orgDetails.length} Orgs
              </span>
            </div>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            Your GitHub organizations — real-time data from {username}&apos;s connected account.
          </p>
        </div>
      </div>

      {/* Search Header */}
      <div className="glass-panel rounded-2xl p-4 sm:p-8 bg-gradient-to-br from-indigo-500/5 via-transparent to-purple-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Globe className="size-48" />
        </div>
        <div className="relative z-10 max-w-2xl">
          <h2 className="text-xl font-bold mb-4">Ecosystem Search</h2>
          <OrgSearchBar suggestions={orgs.slice(0, 6).map((o) => o.login)} />
        </div>
      </div>

      {/* Your Organizations */}
      {orgDetails.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <Zap className="size-4 text-amber-500" />
            <h3 className="text-sm font-black uppercase tracking-widest">Your Organizations</h3>
          </div>
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {orgDetails.map((org) => (
              <Card key={org.login} className="glass-panel group relative overflow-hidden flex flex-col h-full hover:border-indigo-500/50 transition-all duration-300">
                <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 to-purple-500 opacity-60" />
                <div className="p-4 sm:p-6 flex-1">
                  <div className="flex items-start justify-between mb-4">
                    <div className="size-12 rounded-xl overflow-hidden bg-foreground/5 border border-border/50">
                      <Image src={org.avatar_url} width={48} height={48} alt={org.login} className="size-full object-cover" />
                    </div>
                    <div className="px-2 py-1 rounded bg-primary/10 text-primary text-[10px] font-black uppercase tracking-tighter">
                      {org.public_repos} repos
                    </div>
                  </div>
                  <h4 className="text-xl font-bold mb-2 group-hover:text-indigo-500 transition-colors">
                    {org.login}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed font-medium mb-6 line-clamp-3">
                    {org.description || "No description provided."}
                  </p>
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/50">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest flex items-center gap-1">
                        <Users className="size-3" /> Members
                      </p>
                      <p className="text-sm font-black">{org.public_members ?? "—"}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest flex items-center gap-1">
                        <GitFork className="size-3" /> Repos
                      </p>
                      <p className="text-sm font-black">{org.public_repos}</p>
                    </div>
                  </div>
                </div>
                <Link
                  href={`https://github.com/${org.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-4 bg-muted/30 border-t border-border/50 flex items-center justify-between group-hover:bg-indigo-500/5 transition-colors"
                >
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground group-hover:text-indigo-500 transition-colors">
                    View on GitHub
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
                </Link>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center rounded-2xl border-2 border-dashed border-border/50">
          <Building2 className="size-12 text-muted-foreground/20 mb-4" />
          <h3 className="text-lg font-black mb-2">No Organizations Found</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Your GitHub account isn&apos;t part of any organizations yet, or your OAuth token doesn&apos;t have org:read permission.
          </p>
        </div>
      )}

      {/* Global Stats */}
      <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-4">
        {[
          { label: "Your Orgs", value: orgDetails.length.toString(), icon: Building2, color: "text-indigo-500" },
          { label: "Total Repos", value: orgDetails.reduce((s, o) => s + (o.public_repos ?? 0), 0).toLocaleString(), icon: BarChart3, color: "text-emerald-500" },
          { label: "Total Members", value: orgDetails.reduce((s, o) => s + (o.public_members ?? 0), 0).toLocaleString(), icon: Users, color: "text-blue-500" },
          { label: "Active Feed", value: "Live", icon: Activity, color: "text-amber-500" },
        ].map((stat, i) => (
          <Card key={i} className="glass-panel p-4 sm:p-6 flex flex-col items-center text-center gap-3">
            <div className="p-3 rounded-full bg-muted/50">
              <stat.icon className={`size-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{stat.label}</p>
              <p className="text-2xl font-black">{stat.value}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
