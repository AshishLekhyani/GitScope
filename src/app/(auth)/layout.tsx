import { ThemeToggle } from "@/components/layout/theme-toggle";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Minimal auth header — logo + theme toggle only */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 h-14">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="relative w-6 h-6 border-[1.5px] border-primary/60 grid place-items-center bg-primary/5 group-hover:border-primary transition-colors duration-200">
              <div className="absolute inset-0.75 border-[1.5px] border-primary/40" />
              <div className="relative w-2 h-2 bg-primary z-10" />
            </div>
            <span className="font-mono text-[13px] font-bold tracking-[0.06em] text-foreground">
              GIT<span className="text-primary">SCOPE</span><span className="text-primary">.</span>
            </span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center pt-14">
        <div className="w-full max-w-md px-4 py-12">{children}</div>
      </main>
      <footer className="border-t border-border py-4 text-center">
        <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          &copy; {new Date().getFullYear()} GitScope &middot; Engineering Intelligence Platform
        </p>
      </footer>
    </div>
  );
}
