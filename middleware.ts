import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/** Routes accessible to any authenticated user */
const PROTECTED_PREFIXES = [
  "/overview",
  "/activity",
  "/settings",
  "/pricing-settings",
  "/dashboard",
  "/search",
  "/analytics",
  "/compare",
  "/trending",
];

/** Routes that require GitHub OAuth (provider === "github") */
const GITHUB_ONLY_PREFIXES = [
  "/intelligence",
  "/organizations",
];

/** Public routes that do NOT need protection (explicitly allowed) */
const PUBLIC_PATHS = ["/guest"];

const AUTH_PAGES = ["/login", "/signup"];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const isAuthed = Boolean(token);

  // ── Redirect unauthenticated users away from all protected routes ──
  if ((matchesPrefix(pathname, PROTECTED_PREFIXES) || matchesPrefix(pathname, GITHUB_ONLY_PREFIXES)) && !isAuthed) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", `${pathname}${search}`);
    const res = NextResponse.redirect(loginUrl);
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res;
  }

  // ── GitHub-only routes: authenticated but wrong provider → /unauthorized ──
  if (isAuthed && matchesPrefix(pathname, GITHUB_ONLY_PREFIXES)) {
    const provider = token?.provider as string | undefined;
    // Accept "github" provider OR presence of accessToken (belt-and-suspenders)
    const isGitHubUser = provider === "github" || Boolean(token?.accessToken);
    if (!isGitHubUser) {
      const res = NextResponse.redirect(new URL("/unauthorized", req.url));
      res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      return res;
    }
  }

  // ── Redirect already-authed users away from login/signup ──
  if (isAuthed && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL("/overview", req.url));
  }

  const response = NextResponse.next();
  // Prevent stale dashboard state from bfcache
  if (matchesPrefix(pathname, PROTECTED_PREFIXES) || matchesPrefix(pathname, GITHUB_ONLY_PREFIXES)) {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    response.headers.set("Vary", "Cookie");
  }
  return response;
}

export const config = {
  matcher: [
    "/overview/:path*",
    "/activity/:path*",
    "/organizations/:path*",
    "/settings/:path*",
    "/pricing-settings/:path*",
    "/dashboard/:path*",
    "/search/:path*",
    "/analytics/:path*",
    "/compare/:path*",
    "/trending/:path*",
    "/intelligence/:path*",
    "/intelligence",
    "/organizations",
    "/login",
    "/signup",
  ],
};
