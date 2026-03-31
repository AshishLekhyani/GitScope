import { Skeleton } from "@/components/ui/skeleton";
import { RepoSearchPanel } from "@/features/search/repo-search";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Search",
  description: "Search GitHub repositories with autocomplete and recent picks.",
};

function SearchFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export default function SearchPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-8">
      <Suspense fallback={<SearchFallback />}>
        <RepoSearchPanel />
      </Suspense>
    </div>
  );
}
