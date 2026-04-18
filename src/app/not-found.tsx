import Link from "next/link";
import { Home, ArrowLeft } from "lucide-react";
import { GoBackButton } from "@/components/go-back-button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-8">
      <div className="text-center space-y-8 max-w-md w-full">
        {/* Glowing 404 */}
        <div className="relative">
          <div className="absolute inset-0 bg-primary/10 rounded-full blur-3xl scale-150" />
          <div className="relative font-mono text-[120px] font-black text-primary/10 leading-none select-none tracking-tighter">
            404
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-black tracking-tight">
            Page Not Found
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed font-medium">
            The route you&#39;re requesting doesn&#39;t exist or has been moved. Check the URL or navigate back.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/overview"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl btn-gitscope-primary text-sm font-bold transition-all"
          >
            <Home className="size-4" />
            Go to Overview
          </Link>
          <GoBackButton />
        </div>

        <div className="pt-4 border-t border-border/50">
          <p className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest">
            GitScope · Error 404 · Resource Not Found
          </p>
        </div>
      </div>
    </div>
  );
}
