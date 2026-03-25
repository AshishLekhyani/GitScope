import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export type AuthTier = "none" | "credentials" | "github";

/**
 * Returns the current user's auth tier:
 *   "github"      — signed in via GitHub OAuth (accessToken present, provider === "github")
 *   "credentials" — signed in via email/password or Google
 *   "none"        — not authenticated
 */
export async function getSessionTier(): Promise<AuthTier> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return "none";
  if (session.provider === "github") return "github";
  // Fallback: accessToken present means OAuth was used (covers edge cases)
  if (session.accessToken && !session.provider) return "github";
  return "credentials";
}

/**
 * Server-side gate. Redirects to /login or /unauthorized if tier is insufficient.
 * Usage: await requireTier("github") at the top of a Server Component or Route Handler.
 */
export async function requireTier(required: AuthTier): Promise<void> {
  if (required === "none") return;

  const tier = await getSessionTier();

  if (required === "credentials") {
    if (tier === "credentials" || tier === "github") return;
    redirect("/login?from=tier");
  }

  if (required === "github") {
    if (tier === "github") return;
    if (tier === "none") redirect("/login?from=tier");
    // credentials tier but needs github
    redirect("/unauthorized");
  }
}

/** Convenience: returns true if the current user signed in via GitHub OAuth. */
export async function isGitHubUser(): Promise<boolean> {
  return (await getSessionTier()) === "github";
}
