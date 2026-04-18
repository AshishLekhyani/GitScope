export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = req.nextUrl.searchParams.get("repo");
  if (!repo || !repo.includes("/")) {
    return NextResponse.json({ error: "repo param required (owner/name)" }, { status: 400 });
  }

  const token = await getGitHubToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls?state=open&per_page=30&sort=updated&direction=desc`,
    { headers, next: { revalidate: 0 } }
  );

  if (res.status === 403 || res.status === 404) {
    return NextResponse.json({ error: "Repo not found or access denied" }, { status: res.status });
  }
  if (!res.ok) {
    return NextResponse.json({ error: "GitHub API error" }, { status: 502 });
  }

  const prs = await res.json() as {
    number: number;
    title: string;
    user: { login: string; avatar_url: string } | null;
    head: { ref: string };
    base: { ref: string };
    additions: number;
    deletions: number;
    changed_files: number;
    draft: boolean;
    created_at: string;
    updated_at: string;
    labels: { name: string; color: string }[];
    html_url: string;
  }[];

  const simplified = prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? "unknown",
    authorAvatar: pr.user?.avatar_url ?? "",
    head: pr.head.ref,
    base: pr.base.ref,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changed_files ?? 0,
    draft: pr.draft,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    labels: pr.labels?.map((l) => ({ name: l.name, color: l.color })) ?? [],
    url: pr.html_url,
  }));

  return NextResponse.json({ prs: simplified });
}

export const GET = withRouteSecurity(handler, SecurityPresets.standard);
