"use client";

import { ROUTES } from "@/constants/routes";
import Link from "next/link";
import { useSession } from "next-auth/react";

export function MarketingFooter() {
  const { data: session } = useSession();
  const isAuthenticated = Boolean(session?.user);

  return (
    <footer className="border-t border-outline-variant/10 bg-surface-container-lowest/50">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="from-primary/25 to-primary-container/40 flex size-8 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br">
                <span className="font-heading text-sm font-black text-indigo-300">G</span>
              </div>
              <span className="font-heading font-bold text-foreground">GitScope</span>
            </Link>
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              Enterprise-grade telemetry for the world&apos;s most innovative engineering organizations.
              Master your architecture, optimize your delivery.
            </p>
          </div>

          <div>
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Platform</h4>
            <ul className="space-y-2 text-sm">
              {isAuthenticated ? (
                <>
                  <li><Link href={ROUTES.search} className="text-muted-foreground hover:text-foreground transition-colors">Repositories</Link></li>
                  <li><Link href={ROUTES.compare} className="text-muted-foreground hover:text-foreground transition-colors">Benchmarks</Link></li>
                  <li><Link href={ROUTES.trending} className="text-muted-foreground hover:text-foreground transition-colors">Intelligence</Link></li>
                </>
              ) : (
                <>
                  <li><Link href={ROUTES.features} className="text-muted-foreground hover:text-foreground transition-colors">Capabilities</Link></li>
                  <li><Link href={`${ROUTES.features}#solutions`} className="text-muted-foreground hover:text-foreground transition-colors">Solutions</Link></li>
                  <li><Link href={ROUTES.blog} className="text-muted-foreground hover:text-foreground transition-colors">Engineering Insights</Link></li>
                </>
              )}
              <li><Link href={ROUTES.pricing} className="text-muted-foreground hover:text-foreground transition-colors">Pricing</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Resources</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href={ROUTES.docs} className="text-muted-foreground hover:text-foreground transition-colors">Documentation</Link></li>
              <li><Link href={ROUTES.api} className="text-muted-foreground hover:text-foreground transition-colors">API Reference</Link></li>
              <li><Link href={ROUTES.blog} className="text-muted-foreground hover:text-foreground transition-colors">Engineer&apos;s Log</Link></li>
              <li><Link href={ROUTES.status} className="text-muted-foreground hover:text-foreground transition-colors">System Status</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href={ROUTES.privacy} className="text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</Link></li>
              <li><Link href={ROUTES.terms} className="text-muted-foreground hover:text-foreground transition-colors">Terms of Service</Link></li>
              <li><Link href={ROUTES.security} className="text-muted-foreground hover:text-foreground transition-colors">Security Protocol</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-14 border-t border-white/5 pt-8 text-center text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          © {new Date().getFullYear()} GitScope Intelligence Labs // Architected for Enterprise
        </div>
      </div>
    </footer>
  );
}
// MarketingFooter v1
