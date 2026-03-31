import { TopNav } from "@/features/layout/top-nav";

export default function DashboardLoading() {
  return (
    <div className="bg-background flex min-h-screen flex-col overflow-hidden">
      {/* 
        We pass a dummy session with "loading" state equivalent.
        TopNav is already robust against null sessions and handles the skeleton UI internally.
      */}
      <TopNav session={null} />

      <div className="relative flex min-h-0 flex-1">
        {/* Desktop Sidebar Skeleton */}
        <aside className="border-sidebar-border bg-sidebar hidden h-[calc(100vh-4rem)] w-64 flex-col border-r md:flex">
          <div className="flex h-full flex-col pt-12 px-5">
            <div className="flex items-center gap-3 mb-8 opacity-40">
              <div className="size-10 rounded-lg bg-indigo-500/20 animate-pulse" />
              <div className="space-y-2">
                <div className="h-4 w-24 bg-slate-700/80 rounded animate-pulse" />
                <div className="h-2 w-16 bg-slate-700/60 rounded animate-pulse" />
              </div>
            </div>
            <div className="mt-8 space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 opacity-40 p-2">
                   <div className="size-5 rounded bg-slate-700/80 animate-pulse" />
                   <div className="h-3 w-32 bg-slate-700/80 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Content Area Skeleton */}
        <div className="flex min-w-0 flex-1 flex-col transition-all duration-300 md:pl-64">
          <main className="flex-1 px-4 pt-6 pb-20 md:px-8 md:pb-12 md:pt-8 w-full">
            <div className="max-w-6xl mx-auto space-y-8 animate-pulse">
              
              {/* Header Skeleton */}
              <div className="w-full relative rounded-2xl border border-border bg-card/60 p-8 shadow-sm">
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
          </main>
        </div>
      </div>
    </div>
  );
}
