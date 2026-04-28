/**
 * GET /api/ai/repo-tree
 * ======================
 * Returns the flat file tree for a GitHub repo so the client can display
 * a file picker before launching a scan.
 *
 * Query params: repo (owner/name), branch (optional)
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubTokenWithSource } from "@/lib/github-auth";

interface TreeItem {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

async function ghFetch<T>(url: string, token: string | null): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  const branch = searchParams.get("branch") || null;

  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return Response.json({ error: "Invalid repo format. Use owner/repo" }, { status: 400 });
  }

  const { token: ghToken } = await getGitHubTokenWithSource({ session });

  // Resolve default branch if not specified
  let targetBranch = branch;
  if (!targetBranch) {
    const meta = await ghFetch<{ default_branch: string }>(
      `https://api.github.com/repos/${repo}`,
      ghToken
    );
    targetBranch = meta?.default_branch ?? "HEAD";
  }

  // Fetch the recursive tree
  const treeData = await ghFetch<{
    tree: TreeItem[];
    truncated?: boolean;
  }>(
    `https://api.github.com/repos/${repo}/git/trees/${targetBranch}?recursive=1`,
    ghToken
  );

  if (!treeData) {
    return Response.json(
      { error: "Repository not found or access denied. For private repos, connect your GitHub account." },
      { status: 404 }
    );
  }

  const EXCLUDE = /node_modules\/|\.next\/|dist\/|build\/|\.min\.(js|ts)$|\.d\.ts$|\.lock$|\.map$/;

  const files = (treeData.tree ?? [])
    .filter((t) => !EXCLUDE.test(t.path))
    .map((t) => ({ path: t.path, type: t.type, size: t.size }))
    .slice(0, 5000);

  return Response.json({
    files,
    branch: targetBranch,
    truncated: treeData.truncated ?? files.length >= 5000,
    total: treeData.tree?.length ?? 0,
  });
}
