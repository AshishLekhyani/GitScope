"use client";

import { ROUTES } from "@/constants/routes";
import Link from "next/link";
import NextImage from "next/image";
import { Icon } from "@iconify/react";

const FOOTER_LINKS = {
  Platform: [
    { href: ROUTES.features,   label: "Capabilities" },
    { href: ROUTES.pricing,    label: "Pricing" },
    { href: ROUTES.blog,       label: "Engineering Blog" },
    { href: ROUTES.changelog,  label: "Changelog" },
    { href: "/guest",          label: "Try for Free" },
  ],
  Resources: [
    { href: ROUTES.docs,    label: "Documentation" },
    { href: ROUTES.api,     label: "API Reference" },
    { href: ROUTES.status,  label: "System Status" },
    { href: ROUTES.blog,    label: "Engineer's Log" },
  ],
  Legal: [
    { href: ROUTES.privacy,   label: "Privacy Policy" },
    { href: ROUTES.terms,     label: "Terms of Service" },
    { href: ROUTES.security,  label: "Security" },
  ],
};

const SOCIAL = [
  { icon: "mdi:github",  href: "https://github.com/AshishLekhyani", label: "GitHub" },
  { icon: "mdi:twitter", href: "https://twitter.com", label: "Twitter / X" },
];

const TECH_BADGES = [
  { icon: "logos:nextjs-icon",     label: "Next.js" },
  { icon: "logos:prisma",          label: "Prisma" },
  { icon: "logos:vercel-icon",     label: "Vercel" },
  { icon: "logos:tailwindcss-icon",label: "Tailwind" },
];

export function MarketingFooter() {
  return (
    <footer className="relative border-t border-outline-variant/10 overflow-hidden">
      {/* Gradient top accent */}
      <div className="absolute top-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-primary/30 to-transparent" />

      {/* Subtle bg gradient */}
      <div className="absolute inset-0 bg-linear-to-b from-surface-container-lowest/60 to-background pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-6 pt-16 pb-10">
        {/* Main grid */}
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-5">
          {/* Brand column — spans 2 on lg */}
          <div className="space-y-5 lg:col-span-2">
            <Link href="/" className="flex items-center gap-2.5 group w-fit">
              <div className="relative">
                <div className="absolute -inset-1 rounded-xl bg-primary/15 opacity-0 group-hover:opacity-100 blur-sm transition-opacity duration-300" />
                <NextImage
                  src="/logo.png"
                  alt="GitScope"
                  width={36}
                  height={36}
                  className="relative size-9 rounded-lg ring-1 ring-white/10 shadow-lg shadow-primary/15"
                />
              </div>
              <span className="font-heading text-lg font-bold tracking-tight">
                Git<span className="text-primary">Scope</span>
              </span>
            </Link>

            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              Enterprise-grade telemetry for the world&apos;s most innovative
              engineering organizations. Master your architecture, optimize your
              delivery.
            </p>

            {/* Social links */}
            <div className="flex items-center gap-3">
              {SOCIAL.map((s) => (
                <Link
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="flex size-8 items-center justify-center rounded-lg border border-outline-variant/20 text-muted-foreground hover:border-primary/30 hover:text-primary hover:bg-primary/5 transition-all duration-200"
                >
                  <Icon icon={s.icon} width={16} height={16} />
                </Link>
              ))}
            </div>

            {/* Built-with badges */}
            <div className="flex flex-wrap gap-2">
              {TECH_BADGES.map((b) => (
                <div
                  key={b.label}
                  className="flex items-center gap-1.5 rounded-full border border-outline-variant/15 bg-surface-container-lowest/50 px-2.5 py-1"
                >
                  <Icon icon={b.icon} width={12} height={12} />
                  <span className="font-mono text-[9px] tracking-widest text-muted-foreground/60 uppercase">{b.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(FOOTER_LINKS).map(([title, links]) => (
            <div key={title}>
              <h4 className="mb-4 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {title}
              </h4>
              <ul className="space-y-2.5">
                {links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 hover:translate-x-0.5 inline-block"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-14 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-white/5 pt-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
            © {new Date().getFullYear()} GitScope Intelligence Labs
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/30">
            Architected for Enterprise
          </p>
        </div>
      </div>
    </footer>
  );
}
