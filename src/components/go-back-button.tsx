"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export function GoBackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex items-center gap-2 px-6 py-3 rounded-none border border-border bg-card hover:bg-muted text-sm font-bold transition-all"
    >
      <ArrowLeft className="size-4" />
      Go Back
    </button>
  );
}
