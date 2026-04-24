import { Skeleton } from "@/components/ui/skeleton";
import { RepoSearchPanel } from "@/features/search/repo-search";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Search",
  description: "Search GitHub repositories with autocomplete and recent picks.",
};

function SearchFallback() {
  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      <Card className="p-6">
        <Skeleton className="h-12 w-full rounded-none mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-none" />
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function SearchPage() {
  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      <Suspense fallback={<SearchFallback />}>
        <RepoSearchPanel />
      </Suspense>
    </div>
  );
}
