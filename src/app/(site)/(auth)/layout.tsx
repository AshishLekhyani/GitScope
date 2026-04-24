import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ROUTES } from "@/constants/routes";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto grid h-14 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="relative shrink-0">
              <img
                src="/logo.png"
                alt="GitScope"
                width={28}
                height={28}
                className="size-7 hidden object-contain dark:block"
              />
              <img
                src="/logo-light.png"
                alt="GitScope"
                width={28}
                height={28}
                className="size-7 object-contain dark:hidden"
              />
            </div>
            <span className="font-mono text-[13px] font-bold tracking-[0.06em] text-foreground">
              GIT<span className="text-primary">SCOPE</span><span className="text-primary">.</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {[
              { href: "/", label: "Product" },
              { href: ROUTES.docs, label: "Docs" },
              { href: ROUTES.pricing, label: "Pricing" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="border-b-2 border-transparent px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex justify-end">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center pt-14">
        <div className="grid w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-16">
          <section className="hidden border border-border bg-surface-container-low p-8 lg:block">
            <p className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              GitScope Access
            </p>
            <h1 className="max-w-md font-heading text-4xl font-black leading-[0.95] tracking-tight text-foreground">
              Engineering intelligence, without noise.
            </h1>
            <p className="mt-5 max-w-sm font-mono text-xs leading-6 text-muted-foreground">
              Sign in to review repository health, workflow risk, security signals, and team velocity from one consistent command surface.
            </p>
            <div className="mt-10 grid grid-cols-2 border border-border">
              {[
                ["50K+", "Repos Indexed"],
                ["24/7", "Signals"],
                ["0", "Visual Noise"],
                ["v1.0", "Stable"],
              ].map(([value, label]) => (
                <div key={label} className="border-b border-r border-border p-4 odd:border-r last:border-b-0 even:border-r-0 [&:nth-last-child(-n+2)]:border-b-0">
                  <div className="font-heading text-2xl font-black text-foreground">{value}</div>
                  <div className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </section>
          <div className="w-full justify-self-center lg:max-w-md">
            {children}
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-4 text-center">
        <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          &copy; {new Date().getFullYear()} GitScope &middot; Engineering Intelligence Platform
        </p>
      </footer>
    </div>
  );
}
