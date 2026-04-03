export default function DashboardLoading() {
  return (
    <div className="animate-pulse">
      {/* Header Skeleton */}
      <div className="w-full relative rounded-2xl border border-border bg-card/60 p-8 shadow-sm mb-8">
        <div className="h-8 w-1/3 bg-slate-200 dark:bg-slate-800 rounded-lg mb-4" />
        <div className="h-4 w-1/2 bg-slate-200 dark:bg-slate-800 rounded-lg mb-8" />
        <div className="h-10 w-48 bg-slate-200 dark:bg-slate-800 rounded-lg" />
      </div>

      {/* Quick Actions Grid Skeleton */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card/40 p-6 h-40 flex flex-col justify-between">
            <div className="size-10 rounded-lg bg-slate-200 dark:bg-slate-800" />
            <div className="space-y-2">
              <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-800 rounded" />
              <div className="h-3 w-full bg-slate-200 dark:bg-slate-800 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
