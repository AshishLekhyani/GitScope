"use client";

import { signIn } from "next-auth/react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";

interface Props {
  callbackUrl?: string;
  className?: string;
  label?: string;
}

export function ConnectGitHubButton({
  callbackUrl = "/overview",
  className,
  label = "Connect GitHub Account",
}: Props) {
  return (
    <button
      type="button"
      onClick={() => signIn("github", { callbackUrl })}
      className={cn(
        "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl btn-gitscope-primary text-sm font-bold active:scale-[0.98] transition-all",
        className
      )}
    >
      <MaterialIcon name="hub" size={18} />
      {label}
    </button>
  );
}
