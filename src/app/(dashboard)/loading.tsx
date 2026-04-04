"use client";

import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex-1 space-y-6 p-4 pt-4 sm:space-y-8 sm:p-8 sm:pt-6">
      {/* Header Skeleton */}
      <Card className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent" />
        <div className="relative z-10 space-y-4">
          <Skeleton className="h-8 w-1/3 rounded-lg" />
          <Skeleton className="h-4 w-1/2 rounded-lg" />
          <div className="flex gap-3 pt-2">
            <Skeleton className="h-10 w-40 rounded-lg" />
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>
        </div>
      </Card>

      {/* Quick Actions Grid Skeleton */}
      <div className="grid gap-4 grid-cols-2 sm:gap-6 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="relative overflow-hidden p-4 h-40 sm:p-6">
            <div className="absolute inset-0 bg-gradient-to-br from-muted/30 to-transparent" />
            <div className="relative z-10 flex flex-col justify-between h-full">
              <Skeleton className="size-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-3 w-full rounded" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Bottom Cards Skeleton */}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        <Card className="p-6">
          <Skeleton className="h-5 w-40 mb-4 rounded" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 flex-1 rounded" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <Skeleton className="h-5 w-48 mb-4 rounded" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-lg" />
                <Skeleton className="h-4 flex-1 rounded" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
