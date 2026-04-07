"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/material-icon";
import { BookmarkedRepo, fetchBookmarks, removeBookmark } from "@/lib/bookmarks";

type SortMode = "recent" | "alpha";

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarCount({ count }: { count: number }) {
  const formatted =
    count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-500">
      <MaterialIcon name="star" size={13} className="text-amber-500" />
      {formatted}
    </span>
  );
}

function BookmarkCard({
  bookmark,
  onRemove,
}: {
  bookmark: BookmarkedRepo;
  onRemove: (owner: string, repo: string) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const timeAgo = formatDistanceToNow(new Date(bookmark.bookmarkedAt), {
    addSuffix: true,
  });

  const handleRemove = async () => {
    setRemoving(true);
    await onRemove(bookmark.owner, bookmark.repo);
    setRemoving(false);
  };

  return (
    <div className="group flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm transition-all hover:border-indigo-500/30 hover:shadow-md">
      {/* Top row: avatar + name + remove */}
      <div className="flex items-start gap-3">
        {bookmark.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bookmark.avatar}
            alt={bookmark.owner}
            width={40}
            height={40}
            className="size-10 shrink-0 rounded-xl border border-border/60 object-cover"
          />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-sm font-black text-indigo-500">
            {bookmark.owner[0]?.toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm font-bold truncate">
            <span className="text-muted-foreground">{bookmark.owner}/</span>
            <span className="text-foreground">{bookmark.repo}</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Saved {timeAgo}
          </p>
        </div>

        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          aria-label={`Remove ${bookmark.owner}/${bookmark.repo} from bookmarks`}
          className="shrink-0 flex size-8 items-center justify-center rounded-lg text-muted-foreground/50 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
        >
          <MaterialIcon name={removing ? "hourglass_empty" : "delete_outline"} size={16} />
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 flex-1 min-h-10">
        {bookmark.description || (
          <span className="italic text-muted-foreground/50">
            No description provided.
          </span>
        )}
      </p>

      {/* Bottom row: stars + actions */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
        <StarCount count={bookmark.stars} />

        <div className="flex items-center gap-2">
          <a
            href={`https://github.com/${bookmark.owner}/${bookmark.repo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold text-muted-foreground transition-colors hover:border-border/80 hover:bg-muted/60 hover:text-foreground"
          >
            <MaterialIcon name="open_in_new" size={12} />
            GitHub
          </a>
          <Link
            href={`/dashboard/${bookmark.owner}/${bookmark.repo}`}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-indigo-500"
          >
            <MaterialIcon name="analytics" size={12} className="text-white" />
            Open in GitScope
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<BookmarkedRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortMode>("recent");
  const [search, setSearch] = useState("");

  // Load bookmarks from API on mount
  useEffect(() => {
    fetchBookmarks().then((data) => {
      setBookmarks(data);
      setLoading(false);
    });
  }, []);

  const handleRemove = useCallback(async (owner: string, repo: string) => {
    const ok = await removeBookmark(owner, repo);
    if (ok) {
      setBookmarks((prev) => prev.filter((b) => !(b.owner === owner && b.repo === repo)));
    }
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookmarks.filter((b) => {
      if (!q) return true;
      return (
        b.repo.toLowerCase().includes(q) ||
        b.owner.toLowerCase().includes(q) ||
        b.description?.toLowerCase().includes(q)
      );
    });
  }, [bookmarks, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sort === "alpha") {
        return `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`);
      }
      return (
        new Date(b.bookmarkedAt).getTime() - new Date(a.bookmarkedAt).getTime()
      );
    });
  }, [filtered, sort]);

  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight">
            <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-indigo-500/10">
              <MaterialIcon name="bookmark" size={22} className="text-indigo-500" />
            </span>
            <span className="bg-clip-text text-transparent bg-linear-to-r from-indigo-500 to-purple-500">
              Bookmarks
            </span>
            {!loading && bookmarks.length > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-indigo-500 px-2.5 py-0.5 text-xs font-black text-white">
                {bookmarks.length}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your saved repositories — synced to your account across all devices.
          </p>
        </div>

        {/* Sort controls */}
        {!loading && bookmarks.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-1">
            {(
              [
                { value: "recent", label: "Recently Added", icon: "schedule" },
                { value: "alpha", label: "Alphabetical", icon: "sort_by_alpha" },
              ] as { value: SortMode; label: string; icon: string }[]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSort(opt.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                  sort === opt.value
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <MaterialIcon
                  name={opt.icon}
                  size={13}
                  className={sort === opt.value ? "text-white" : ""}
                />
                <span className="hidden sm:inline">{opt.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Loading skeleton ────────────────────────────────────────────────── */}
      {loading && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-52 animate-pulse rounded-3xl bg-muted/40"
            />
          ))}
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!loading && bookmarks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-6 rounded-3xl border-2 border-dashed border-border/50 py-24 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-indigo-500/10">
            <MaterialIcon name="bookmark_border" size={32} className="text-indigo-400" />
          </div>
          <div className="max-w-sm space-y-2">
            <h3 className="text-xl font-black">No bookmarks yet</h3>
            <p className="text-sm text-muted-foreground">
              Search a repository and bookmark it from the repo overview page to
              save it here for quick access — synced to your account.
            </p>
          </div>
          <Link
            href="/search"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-500"
          >
            <MaterialIcon name="search" size={16} className="text-white" />
            Search Repositories
          </Link>
        </div>
      )}

      {/* ── Search + grid ────────────────────────────────────────────────────── */}
      {!loading && bookmarks.length > 0 && (
        <div className="space-y-5">
          {/* Search filter */}
          <div className="relative max-w-sm">
            <MaterialIcon
              name="search"
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter bookmarks…"
              className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-4 text-sm placeholder:text-muted-foreground/60 focus:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search filter"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <MaterialIcon name="close" size={14} />
              </button>
            )}
          </div>

          {/* No search results */}
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border/50 py-16 text-center">
              <MaterialIcon name="search_off" size={32} className="text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                No bookmarks match &ldquo;{search}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-xs font-bold text-indigo-500 hover:underline"
              >
                Clear filter
              </button>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.map((bookmark) => (
                <BookmarkCard
                  key={`${bookmark.owner}/${bookmark.repo}`}
                  bookmark={bookmark}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}

          {/* Footer count */}
          <p className="text-center text-xs text-muted-foreground/60">
            {sorted.length} of {bookmarks.length} bookmark
            {bookmarks.length !== 1 ? "s" : ""} shown
            {search && ` for "${search}"`}
          </p>
        </div>
      )}
    </div>
  );
}
