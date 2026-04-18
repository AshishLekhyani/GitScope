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
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${repo}/stats/contributors`, {
    headers,
    next: { revalidate: 0 },
  });

  if (res.status === 202) {
    // GitHub is computing — tell the client to retry
    return NextResponse.json({ computing: true }, { status: 202 });
  }
  if (res.status === 404 || res.status === 403) {
    return NextResponse.json({ error: "Repo not found or access denied" }, { status: res.status });
  }
  if (!res.ok) {
    return NextResponse.json({ error: "GitHub API error" }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data);
}

export const GET = withRouteSecurity(handler, SecurityPresets.standard);
