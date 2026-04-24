import { TrendingReposPanel } from "@/features/trending/trending-repos";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Stack Trending",
  description: "Repositories trending in your tech stack.",
};

function TrendingFallback() {
  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      <Card className="p-6">
        <Skeleton className="h-8 w-48 mb-4 rounded-none" />
        <Skeleton className="h-64 w-full rounded-none" />
      </Card>
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="p-4 h-40">
            <Skeleton className="h-4 w-3/4 mb-2 rounded" />
            <Skeleton className="h-3 w-full rounded mb-4" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function TrendingPage() {
  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      <Suspense fallback={<TrendingFallback />}>
        <TrendingReposPanel />
      </Suspense>
    </div>
  );
}
