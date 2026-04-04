"use client";

import { Icon } from "@iconify/react";
import { cn } from "@/lib/utils";

/** Stitch HTML uses underscore names; Iconify uses kebab-case after `material-symbols:` */
const ALIASES: Record<string, string> = {
  fork_right: "material-symbols:fork-right",
  emergency_home: "material-symbols:emergency-home",
  menu_book: "material-symbols:menu-book",
  contact_support: "material-symbols:contact-support",
  compare_arrows: "material-symbols:compare-arrows",
  trending_up: "material-symbols:trending-up",
  keyboard_command_key: "material-symbols:keyboard-command-key",
  deployed_code: "material-symbols:deployed-code",
  rocket_launch: "material-symbols:rocket-launch",
  travel_explore: "material-symbols:travel-explore",
  bolt: "material-symbols:bolt",
  sync: "material-symbols:sync",
  warning: "material-symbols:warning",
  verified: "material-symbols:verified",
  star: "material-symbols:star",
  notifications: "material-symbols:notifications",
  terminal: "material-symbols:terminal",
  download: "material-symbols:download",
  home: "material-symbols:home",
  analytics: "material-symbols:analytics",
  group: "material-symbols:group",
  code: "material-symbols:code",
  settings: "material-symbols:settings",
  dashboard: "material-symbols:dashboard",
  search: "material-symbols:search",
  history: "material-symbols:history",
  close: "material-symbols:close",
  keyboard: "material-symbols:keyboard",
  source: "material-symbols:code",
};

function toIconify(name: string): string {
  if (ALIASES[name]) return ALIASES[name];
  return `material-symbols:${name.replace(/_/g, "-")}`;
}

export function MaterialIcon({
  name,
  className,
  size = 20,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  return (
    <Icon
      icon={toIconify(name)}
      width={size}
      height={size}
      className={cn("shrink-0 text-current", className)}
      aria-hidden
    />
  );
}
// MaterialIcon component
