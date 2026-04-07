"use client";

import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { performLogout } from "@/lib/client-auth";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import NextImage from "next/image";
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ThemeToggle } from "./theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MaterialIcon } from "@/components/material-icon";
import { Session } from "next-auth";
import { ChevronRight } from "lucide-react";

const NAV_LINKS = [
  { href: ROUTES.features,  label: "Features"  },
  { href: ROUTES.pricing,   label: "Pricing"   },
  { href: ROUTES.docs,      label: "Docs"      },
  { href: ROUTES.blog,      label: "Blog"      },
  { href: ROUTES.changelog, label: "Changelog" },
];

export function MarketingHeader({ session: serverSession }: { session?: Session | null }) {
  const { data: clientSession } = useSession();
  const session = serverSession || clientSession;
  const isAuthenticated = !!session?.user;
  const displayName = session?.user?.name || session?.user?.email?.split("@")[0] || "User";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const userInitials =
    (session?.user?.name || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ||
    session?.user?.email?.charAt(0).toUpperCase() ||
    "U";

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-outline-variant/10 bg-background/85 backdrop-blur-xl shadow-[0_1px_0_0_rgba(124,140,248,0.06)]"
          : "border-b border-transparent bg-transparent"
      )}
    >
      {/* Gradient top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-primary/40 to-transparent" />

      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="relative">
            <div className="absolute -inset-1 rounded-xl bg-primary/20 opacity-0 group-hover:opacity-100 blur-sm transition-opacity duration-300" />
            <NextImage
              src="/logo.png"
              width={36}
              height={36}
              alt="GitScope Logo"
              className="relative size-9 rounded-lg shadow-lg shadow-primary/20 ring-1 ring-white/10"
            />
          </div>
          <span className="font-heading text-lg font-bold tracking-tight text-foreground">
            Git<span className="text-primary">Scope</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="relative rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-white/5 group"
            >
              {l.label}
              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-px w-0 bg-primary transition-all duration-200 group-hover:w-4" />
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />

          {/* Mobile hamburger */}
          <button
            type="button"
            aria-label="Toggle navigation menu"
            className="flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent md:hidden"
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            <MaterialIcon name={mobileMenuOpen ? "close" : "menu"} size={22} />
          </button>

          {!isAuthenticated ? (
            <div className="hidden items-center gap-3 sm:flex">
              <Link
                href={ROUTES.login}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Log In
              </Link>
              <Link
                href={`${ROUTES.login}?mode=signup`}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "btn-gitscope-primary rounded-full px-5 font-bold tracking-tight shadow-lg shadow-primary/20 flex items-center gap-1"
                )}
              >
                Get Started
                <ChevronRight className="size-3.5" />
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                href={ROUTES.overview}
                className={cn(
                  buttonVariants({ size: "sm", variant: "default" }),
                  "hidden sm:flex rounded-full bg-primary hover:bg-primary/90 font-bold px-4 shadow-lg shadow-primary/20"
                )}
              >
                Dashboard
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label="User menu"
                      className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-[11px] font-black text-primary border border-primary/20 hover:bg-primary/20 transition-all uppercase tracking-tighter outline-none ring-0"
                    >
                      {session?.user?.image ? (
                        <NextImage
                          src={session.user.image}
                          width={32}
                          height={32}
                          alt="Avatar"
                          className="size-full rounded-full object-cover"
                        />
                      ) : (
                        userInitials
                      )}
                    </button>
                  }
                />
                <DropdownMenuContent
                  align="end"
                  className="w-56 border-outline-variant/20 bg-surface-container/95 backdrop-blur-md"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-bold leading-none truncate">{displayName}</p>
                        <p className="text-xs leading-none text-muted-foreground truncate opacity-70">
                          {session?.user?.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator className="bg-outline-variant/10" />
                  <DropdownMenuItem render={<Link href={ROUTES.overview}><MaterialIcon name="dashboard" size={16} className="mr-2 text-primary" />Dashboard</Link>} />
                  <DropdownMenuItem render={<Link href={ROUTES.settings}><MaterialIcon name="settings" size={16} className="mr-2" />Settings</Link>} />
                  <DropdownMenuSeparator className="opacity-10" />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:text-destructive font-bold"
                    onClick={() => { void performLogout(); }}
                  >
                    <MaterialIcon name="logout" size={16} className="mr-2" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-white/5 bg-background/95 backdrop-blur-xl md:hidden"
          >
            <div className="px-4 py-4 space-y-1">
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  {l.label}
                </Link>
              ))}
              <div className="border-t border-white/5 pt-3 mt-3 flex flex-col gap-2">
                {!isAuthenticated ? (
                  <>
                    <Link
                      href={ROUTES.login}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      Log In
                    </Link>
                    <Link
                      href={`${ROUTES.login}?mode=signup`}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        buttonVariants({ size: "sm" }),
                        "btn-gitscope-primary rounded-xl font-bold justify-center"
                      )}
                    >
                      Get Started Free
                    </Link>
                  </>
                ) : (
                  <Link
                    href={ROUTES.overview}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      buttonVariants({ size: "sm" }),
                      "rounded-xl bg-primary hover:bg-primary/90 font-bold justify-center"
                    )}
                  >
                    Go to Dashboard
                  </Link>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
