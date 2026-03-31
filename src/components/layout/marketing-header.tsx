"use client";

import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { performLogout } from "@/lib/client-auth";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import NextImage from "next/image";

import { ThemeToggle } from "./theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { MaterialIcon } from "@/components/material-icon";
import { Session } from "next-auth";

export function MarketingHeader({ session: serverSession }: { session?: Session | null }) {
  const { data: clientSession } = useSession();
  const session = serverSession || clientSession;
  const isAuthenticated = !!session?.user;
  const displayName = session?.user?.name || session?.user?.email?.split('@')[0] || "User";

  const userInitials = (session?.user?.name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() ||
    session?.user?.email?.charAt(0).toUpperCase() ||
    "U";

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <NextImage 
            src="/logo.png" 
            width={36} 
            height={36} 
            alt="GitScope Logo" 
            className="size-9 rounded-lg shadow-xl shadow-primary/20 ring-1 ring-white/10"
          />
          <span className="font-heading text-lg font-bold tracking-tight text-foreground">GitScope</span>
        </Link>

        <nav className="hidden items-center gap-8 sm:flex">
          <Link href={ROUTES.pricing} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Pricing</Link>
          <Link href={ROUTES.docs} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Documentation</Link>
          <Link href={ROUTES.blog} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Log</Link>
        </nav>

        <div className="flex items-center gap-4">
          <ThemeToggle />
          {!isAuthenticated ? (
            <>
              <Link href={ROUTES.login} className="text-sm font-bold text-muted-foreground hover:text-foreground transition-colors mr-2">Log In</Link>
              <Link href={`${ROUTES.login}?mode=signup`} className={cn(buttonVariants({ size: "sm" }), "btn-gitscope-primary rounded-full px-5 font-bold tracking-tight shadow-xl")}>
                Sign Up
              </Link>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                href={ROUTES.overview}
                className={cn(
                  buttonVariants({ size: "sm", variant: "default" }),
                  "hidden sm:flex rounded-full bg-indigo-600 hover:bg-indigo-500 font-bold px-4"
                )}
              >
                Go to Dashboard
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger render={
                  <button className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-[11px] font-black text-primary border border-primary/20 hover:bg-primary/20 transition-all uppercase tracking-tighter outline-none">
                    {session?.user?.image ? (
                      <NextImage src={session.user.image} width={32} height={32} alt="Avatar" className="size-full rounded-full object-cover" />
                    ) : userInitials}
                  </button>
                } />
                <DropdownMenuContent align="end" className="w-56 border-outline-variant/20 bg-surface-container/95 backdrop-blur-md">
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
                  <DropdownMenuItem render={
                    <Link href={ROUTES.overview}>
                      <MaterialIcon name="dashboard" size={16} className="mr-2 text-indigo-400" />
                      Dashboard
                    </Link>
                  } />
                  <DropdownMenuItem render={
                    <Link href={ROUTES.settings}>
                      <MaterialIcon name="settings" size={16} className="mr-2" />
                      Settings
                    </Link>
                  } />
                  <DropdownMenuSeparator className="opacity-10" />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:text-destructive font-bold"
                    onClick={() => {
                      void performLogout();
                    }}
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
    </header>
  );
}
// MarketingHeader v1
