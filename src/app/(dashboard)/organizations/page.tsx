export const dynamic = 'force-dynamic';

import { requireTier } from "@/lib/auth-tier";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { OrganizationsClient } from "@/features/organizations/organizations-client";

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

async function getOrgDetails(login: string, token: string): Promise<GitHubOrg | null> {
  const res = await fetch(`https://api.github.com/orgs/${login}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
    next: { revalidate: 120 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    ...data,
    public_repos: data.public_repos ?? 0,
    public_members: data.public_members ?? 0,
  };
}

export default async function OrganizationsPage() {
  await requireTier("github");

  const session = await getServerSession(authOptions);
  const token = await getGitHubToken();

  let orgs: GitHubOrg[] = [];

  if (token) {
    const userOrgs = await getUserOrgs(token);
    // Fetch detailed info for all orgs in parallel
    const detailedOrgs = await Promise.all(
      userOrgs.map((org) => getOrgDetails(org.login, token))
    );
    orgs = detailedOrgs.filter(Boolean) as GitHubOrg[];
  }

  const username = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "you";

  return <OrganizationsClient orgs={orgs} username={username} />;
}
