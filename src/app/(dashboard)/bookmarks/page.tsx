"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/material-icon";
import { motion, AnimatePresence } from "framer-motion";

type Status = "open" | "in_progress" | "done" | "dismissed";
type Severity = "critical" | "high" | "medium" | "low" | "info";

interface ActionItem {
  id: string;
  repo: string;
  title: string;
  description: string;
  suggestion: string;
  severity: Severity;
  category: string;
  file: string | null;
  status: Status;
  createdAt: string;
}

const SEV_STYLES: Record<Severity, { badge: string; dot: string }> = {
  critical: { badge: "bg-red-500/15 border-red-500/30 text-red-400",     dot: "bg-red-500" },
  high:     { badge: "bg-orange-500/15 border-orange-500/30 text-orange-400", dot: "bg-orange-500" },
  medium:   { badge: "bg-amber-500/15 border-amber-500/30 text-amber-400",  dot: "bg-amber-500" },
  low:      { badge: "bg-blue-500/15 border-blue-500/30 text-blue-400",    dot: "bg-blue-500" },
  info:     { badge: "bg-slate-500/15 border-slate-500/30 text-muted-foreground", dot: "bg-slate-400" },
};

const STATUS_OPTS: { value: Status; label: string; icon: string; color: string }[] = [
  { value: "open",        label: "Open",        icon: "radio_button_unchecked", color: "text-red-400" },
  { value: "in_progress", label: "In Progress", icon: "timelapse",              color: "text-amber-400" },
  { value: "done",        label: "Done",        icon: "check_circle",           color: "text-emerald-400" },
  { value: "dismissed",   label: "Dismissed",   icon: "cancel",                 color: "text-muted-foreground/50" },
];

async function apiPatch(id: string, status: Status): Promise<boolean> {
  const res = await fetch("/api/user/action-items", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status }),
  });
  return res.ok;
}

async function apiDelete(id: string): Promise<boolean> {
  const res = await fetch(`/api/user/action-items?id=${id}`, { method: "DELETE" });
  return res.ok;
}

function ActionCard({ item, onStatusChange, onDelete }: {
  item: ActionItem;
  onStatusChange: (id: string, status: Status) => void;
  onDelete: (id: string) => void;
}) {
  const sev = (item.severity in SEV_STYLES ? item.severity : "low") as Severity;
  const s = SEV_STYLES[sev];
  const [showMenu, setShowMenu] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={cn(
        "group relative rounded-2xl border bg-card p-5 space-y-3 transition-all hover:shadow-md",
        item.status === "done" ? "opacity-60" : "opacity-100",
        item.status === "dismissed" ? "opacity-40" : "",
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className={cn("size-2 rounded-full shrink-0 mt-2", s.dot)} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-foreground/90 leading-snug line-clamp-2">{item.title}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={cn("text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border", s.badge)}>
              {item.severity}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground/50">{item.repo}</span>
            {item.file && (
              <span className="text-[9px] font-mono text-muted-foreground/40 truncate max-w-35">{item.file.split("/").pop()}</span>
            )}
          </div>
        </div>
        {/* Status menu */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowMenu((v) => !v)}
            aria-label="Item actions"
            className="size-7 rounded-lg flex items-center justify-center border border-border hover:bg-muted/60 transition-colors"
          >
            <MaterialIcon name="more_horiz" size={14} className="text-muted-foreground" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-8 z-20 w-40 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
              {STATUS_OPTS.map((opt) => (
                <button key={opt.value} type="button"
                  onClick={() => { onStatusChange(item.id, opt.value); setShowMenu(false); }}
                  className={cn("w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold hover:bg-muted/60 transition-colors",
                    item.status === opt.value ? "text-primary" : "text-foreground/70"
                  )}
                >
                  <MaterialIcon name={opt.icon} size={13} className={opt.color} />
                  {opt.label}
                </button>
              ))}
              <div className="h-px bg-border/60 mx-2" />
              <button type="button"
                onClick={() => { onDelete(item.id); setShowMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-destructive hover:bg-destructive/10 transition-colors"
              >
                <MaterialIcon name="delete_outline" size={13} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Suggestion */}
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed line-clamp-2">{item.suggestion}</p>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border/50">
        <div className={cn("flex items-center gap-1 text-[9px] font-black uppercase tracking-widest",
          STATUS_OPTS.find((o) => o.value === item.status)?.color ?? "text-muted-foreground"
        )}>
          <MaterialIcon name={STATUS_OPTS.find((o) => o.value === item.status)?.icon ?? "circle"} size={11} />
          {STATUS_OPTS.find((o) => o.value === item.status)?.label}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground/40">
            {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
          </span>
          <Link href={`/intelligence?repo=${item.repo}`}
            className="text-[9px] font-black text-indigo-400/60 hover:text-indigo-400 transition-colors"
          >
            View repo →
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

const FILTER_STATUSES: Array<{ value: Status | "all"; label: string }> = [
  { value: "all",        label: "All" },
  { value: "open",       label: "Open" },
  { value: "in_progress",label: "In Progress" },
  { value: "done",       label: "Done" },
  { value: "dismissed",  label: "Dismissed" },
];

export default function ActionItemsPage() {
  const [items, setItems]     = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter]   = useState<Status | "all">("all");
  const [search, setSearch]   = useState("");

  useEffect(() => {
    fetch("/api/user/action-items")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d) => { if (d.items) setItems(d.items); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleStatus = async (id: string, status: Status) => {
    const prev = items;
    setItems((cur) => cur.map((i) => i.id === id ? { ...i, status } : i));
    const ok = await apiPatch(id, status);
    if (!ok) setItems(prev);
  };

  const handleDelete = async (id: string) => {
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== id));
    const ok = await apiDelete(id);
    if (!ok) setItems(prev);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.status !== filter) return false;
      if (!q) return true;
      return item.title.toLowerCase().includes(q) ||
             item.repo.toLowerCase().includes(q) ||
             item.suggestion.toLowerCase().includes(q);
    });
  }, [items, filter, search]);

  const counts = useMemo(() => ({
    open:        items.filter((i) => i.status === "open").length,
    in_progress: items.filter((i) => i.status === "in_progress").length,
    done:        items.filter((i) => i.status === "done").length,
    dismissed:   items.filter((i) => i.status === "dismissed").length,
  }), [items]);

  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight">
            <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-indigo-500/10">
              <MaterialIcon name="checklist" size={22} className="text-indigo-500" />
            </span>
            <span className="bg-clip-text text-transparent bg-linear-to-r from-indigo-500 to-purple-500">
              Action Items
            </span>
            {!loading && items.length > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-red-500 px-2.5 py-0.5 text-xs font-black text-white">
                {counts.open}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scan findings you&apos;ve saved to fix. Save any finding from a repo scan using the &ldquo;Save as Action Item&rdquo; button.
          </p>
        </div>
        <Link href="/intelligence" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 text-white text-xs font-black hover:bg-indigo-600 transition-colors">
          <MaterialIcon name="manage_search" size={14} className="text-white" /> Run New Scan
        </Link>
      </div>

      {/* Stats strip */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Open",        count: counts.open,        color: "text-red-400",     bg: "bg-red-500/8 border-red-500/15" },
            { label: "In Progress", count: counts.in_progress, color: "text-amber-400",   bg: "bg-amber-500/8 border-amber-500/15" },
            { label: "Done",        count: counts.done,        color: "text-emerald-400", bg: "bg-emerald-500/8 border-emerald-500/15" },
            { label: "Dismissed",   count: counts.dismissed,   color: "text-muted-foreground/50", bg: "bg-muted/20 border-border" },
          ].map((s) => (
            <div key={s.label} className={cn("rounded-2xl border p-4 text-center", s.bg)}>
              <p className={cn("text-2xl font-black", s.color)}>{s.count}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1,2,3].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-muted/40" />)}
        </div>
      )}

      {/* Load error */}
      {!loading && loadError && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-destructive/20 bg-destructive/5 py-16 text-center">
          <MaterialIcon name="error_outline" size={32} className="text-destructive/60" />
          <div>
            <p className="font-bold text-sm text-foreground">Failed to load action items</p>
            <p className="text-xs text-muted-foreground mt-1">Check your connection and try refreshing.</p>
          </div>
          <button
            type="button"
            onClick={() => { setLoadError(false); setLoading(true); fetch("/api/user/action-items").then(r => r.ok ? r.json() : Promise.reject()).then(d => { if (d.items) setItems(d.items); }).catch(() => setLoadError(true)).finally(() => setLoading(false)); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card hover:bg-muted text-xs font-bold transition-all"
          >
            <MaterialIcon name="refresh" size={14} /> Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !loadError && items.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-6 rounded-3xl border-2 border-dashed border-border/50 py-24 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-indigo-500/10">
            <MaterialIcon name="add_task" size={32} className="text-indigo-400" />
          </div>
          <div className="max-w-sm space-y-2">
            <h3 className="text-xl font-black">No action items yet</h3>
            <p className="text-sm text-muted-foreground">
              Run a repo scan in the Intelligence Hub, then click &ldquo;Save as Action Item&rdquo; on any finding to track it here.
            </p>
          </div>
          <Link href="/intelligence"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-500"
          >
            <MaterialIcon name="manage_search" size={16} className="text-white" /> Open Intelligence Hub
          </Link>
        </div>
      )}

      {/* Filters + grid */}
      {!loading && !loadError && items.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Status filter */}
            <div className="flex items-center gap-1 p-1 rounded-xl border border-border bg-card">
              {FILTER_STATUSES.map((f) => (
                <button key={f.value} type="button" onClick={() => setFilter(f.value)}
                  className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                    filter === f.value ? "bg-indigo-500 text-white shadow" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative flex-1 min-w-50 max-w-sm">
              <MaterialIcon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search findings…"
                className="w-full pl-8 pr-4 py-2 rounded-xl border border-border bg-card text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/40"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground/50">
              <MaterialIcon name="search_off" size={28} className="mx-auto mb-2" />
              <p className="text-sm">No items match your filter.</p>
            </div>
          ) : (
            <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {filtered.map((item) => (
                  <ActionCard key={item.id} item={item} onStatusChange={handleStatus} onDelete={handleDelete} />
                ))}
              </AnimatePresence>
            </motion.div>
          )}

          <p className="text-center text-xs text-muted-foreground/40">
            {filtered.length} of {items.length} item{items.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
