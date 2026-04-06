import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  decryptGitHubToken,
  encryptGitHubToken,
  isEncryptedGitHubToken,
} from "@/lib/github-token-crypto";

export type GitHubTokenSource =
  | "session-oauth"
  | "user-pat"
  | "shared-env"
  | "none";

function defaultAllowEnvFallback(): boolean {
  return process.env.GITHUB_SHARED_FALLBACK === "1" || process.env.GITHUB_SHARED_FALLBACK === "true";
}

async function getGitHubTokenFromDb(userId: string): Promise<string | null> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: "github" },
      select: { 
        access_token: true,
        refresh_token: true,
      },
    });
    return account?.access_token ?? null;
  } catch (err) {
    console.error("[GitHub Auth] Error fetching token from DB:", err);
    return null;
  }
}

export async function getGitHubTokenWithSource(options?: {
  allowEnvFallback?: boolean;
  session?: Session | null;
  userId?: string;
}) {
  const {
    allowEnvFallback = defaultAllowEnvFallback(),
    session: providedSession,
    userId: explicitUserId,
  } = options ?? {};
  const session = providedSession ?? (await getServerSession(authOptions));
  const userId = explicitUserId ?? session?.user?.id;

  // Check if user has GitHub connected via session (current provider is GitHub)
  if (session?.accessToken && session?.provider === "github") {
    return { token: session.accessToken, source: "session-oauth" as GitHubTokenSource };
  }

  // If user has GitHub connected in database but signed in with different provider,
  // fetch the GitHub token from the Account table
  if (userId) {
    const gitHubTokenFromDb = await getGitHubTokenFromDb(userId);
    if (gitHubTokenFromDb) {
      return { token: gitHubTokenFromDb, source: "session-oauth" as GitHubTokenSource };
    }
  }

  // If user has a stored personal GitHub API key, use that next
  if (userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { githubApiKey: true },
      });

      if (user?.githubApiKey) {
        const decrypted = decryptGitHubToken(user.githubApiKey);
        if (decrypted) {
          // Opportunistic one-way migration for legacy plaintext rows.
          if (!isEncryptedGitHubToken(user.githubApiKey)) {
            const encrypted = encryptGitHubToken(decrypted);
            if (encrypted) {
              await prisma.user
                .update({
                  where: { id: userId },
                  data: { githubApiKey: encrypted },
                })
                .catch(() => {});
            }
          }
          return { token: decrypted, source: "user-pat" as GitHubTokenSource };
        }
      }
    } catch {
      // DB unavailable - fall through to env fallback
    }
  }

  // Fall back to shared env token (development/demo)
  if (allowEnvFallback && process.env.GITHUB_TOKEN) {
    return { token: process.env.GITHUB_TOKEN, source: "shared-env" as GitHubTokenSource };
  }

  return { token: null, source: "none" as GitHubTokenSource };
}

export async function getGitHubToken(options?: {
  allowEnvFallback?: boolean;
  session?: Session | null;
  userId?: string;
}) {
  const { token } = await getGitHubTokenWithSource(options);
  return token;
}
