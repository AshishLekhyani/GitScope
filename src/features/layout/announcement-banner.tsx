"use client";

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

interface Announcement {
  id: string;
  message: string;
  type: string;
}

const TYPE_STYLES: Record<string, { bar: string; icon: string; iconName: string }> = {
  info:    { bar: "bg-amber-500/10 border-amber-500/30 text-amber-200", icon: "text-amber-400", iconName: "info" },
  warning: { bar: "bg-amber-500/10 border-amber-500/30 text-amber-200", icon: "text-amber-400",  iconName: "warning" },
  error:   { bar: "bg-red-500/10 border-red-500/30 text-red-200",       icon: "text-red-400",    iconName: "error" },
  success: { bar: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200", icon: "text-emerald-400", iconName: "check_circle" },
};

export function AnnouncementBanner() {
  const [ann, setAnn] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch("/api/admin/announcement")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.announcement) {
          const key = `ann_dismissed:${d.announcement.id}`;
          if (!sessionStorage.getItem(key)) setAnn(d.announcement);
        }
      })
      .catch(() => {});
  }, []);

  if (!ann || dismissed) return null;

  const style = TYPE_STYLES[ann.type] ?? TYPE_STYLES.info;

  function dismiss() {
    sessionStorage.setItem(`ann_dismissed:${ann!.id}`, "1");
    setDismissed(true);
  }

  return (
    <div className={cn("flex items-center gap-3 px-4 py-2 border-b text-sm", style.bar)}>
      <MaterialIcon name={style.iconName} size={16} className={style.icon} />
      <span className="flex-1 leading-snug">{ann.message}</span>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <MaterialIcon name="close" size={15} />
      </button>
    </div>
  );
}
