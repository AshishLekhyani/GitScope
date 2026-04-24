"use client";

import { MaterialIcon } from "@/components/material-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/constants/routes";
import { getRepoContents, type GitHubFile } from "@/services/githubClient";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { useMemo } from "react";

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function SourceExplorerClient({
  owner,
  repo,
  path,
}: {
  owner: string;
  repo: string;
  path: string;
}) {
  const breadcrumbs = useMemo(() => {
    if (!path) return [];
    const parts = path.split("/");
    return parts.map((p, i) => ({
      name: p,
      path: parts.slice(0, i + 1).join("/"),
    }));
  }, [path]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["repoContents", owner, repo, path],
    queryFn: () => getRepoContents(owner, repo, path),
  });

  const isFile = data && !Array.isArray(data);
  const fileData = isFile ? (data as GitHubFile) : null;
  const items = Array.isArray(data) ? data : [];

  // Sort directories first
  items.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative w-full pb-20"
    >
      <div className="mb-6 flex flex-col gap-2 border-b border-outline-variant/10 pb-4">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Source Explorer
        </h1>
        
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap font-mono text-sm text-muted-foreground pb-2 scrollbar-none">
          <Link
            href={ROUTES.source(owner, repo)}
            className="hover:text-primary transition-colors hover:underline"
          >
            {repo}
          </Link>
          {breadcrumbs.map((b) => (
            <div key={b.path} className="flex items-center gap-2">
              <span className="text-outline-variant">/</span>
              <Link
                href={ROUTES.source(owner, repo, b.path)}
                className="hover:text-primary transition-colors hover:underline"
              >
                {b.name}
              </Link>
            </div>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 15 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-none" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-none border border-destructive/20 bg-destructive/5 p-6 text-center text-sm text-destructive">
          Error loading contents. Make sure the repository path is accessible.
        </div>
      )}

      {/* Directory Listing */}
      {!isLoading && !error && !isFile && items.length > 0 && (
        <div className="overflow-hidden rounded-none border border-outline-variant/15 bg-surface-container shadow-md">
          <div className="grid grid-cols-[1fr_100px] gap-4 border-b border-outline-variant/10 bg-surface-container-high px-4 py-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:grid-cols-[1fr_150px_100px]">
            <div>Name</div>
            <div className="hidden sm:block">Date</div>
            <div className="text-right">Size</div>
          </div>
          <div className="divide-y divide-outline-variant/5">
            {path && (
              <Link
                href={
                  breadcrumbs.length > 1
                    ? ROUTES.source(owner, repo, breadcrumbs[breadcrumbs.length - 2].path)
                    : ROUTES.source(owner, repo)
                }
                className="flex items-center px-4 py-3 hover:bg-surface-container-highest transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MaterialIcon name="folder_open" size={20} className="text-muted-foreground" />
                  <span className="font-mono text-sm font-semibold text-primary">..</span>
                </div>
              </Link>
            )}
            {items.map((item) => (
              <Link
                key={item.sha}
                href={ROUTES.source(owner, repo, item.path)}
                className="grid grid-cols-[1fr_100px] items-center gap-4 px-4 py-2.5 transition-colors hover:bg-surface-container-highest cursor-pointer sm:grid-cols-[1fr_150px_100px]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <MaterialIcon 
                    name={item.type === "dir" ? "folder" : "insert_drive_file"} 
                    size={20} 
                    className={item.type === "dir" ? "text-amber-400" : "text-muted-foreground"} 
                  />
                  <span className="truncate font-mono text-sm text-foreground group-hover:underline">
                    {item.name}
                  </span>
                </div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  —
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {item.type === "dir" ? "" : formatBytes(item.size)}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* File Viewer */}
      {!isLoading && !error && isFile && fileData && (
        <div className="overflow-hidden rounded-none border border-outline-variant/15 bg-surface-container shadow-md">
          <div className="flex items-center justify-between border-b border-outline-variant/10 bg-surface-container-high px-4 py-3">
            <div className="flex items-center gap-2">
              <MaterialIcon name="description" size={18} className="text-muted-foreground" />
              <span className="font-mono text-sm font-semibold">{fileData.name}</span>
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {formatBytes(fileData.size)}
            </div>
          </div>
          <div className="bg-surface-container-lowest p-4 overflow-x-auto text-sm font-mono text-foreground">
            <code className="whitespace-pre">
              {fileData.content ? atob(fileData.content) : "No content available."}
            </code>
          </div>
        </div>
      )}
    </motion.div>
  );
}
