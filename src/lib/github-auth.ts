import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function getGitHubToken() {
  const session = await getServerSession(authOptions);

  // Only use session accessToken if the active provider is GitHub
  if (session?.accessToken && session?.provider === "github") {
    return session.accessToken;
  }

  // If user has a stored personal GitHub API key, use that next
  if (session?.user?.id) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { githubApiKey: true },
      });
      if (user?.githubApiKey) return user.githubApiKey;
    } catch {
      // DB unavailable — fall through to env fallback
    }
  }

  // Fall back to shared env token (development/demo)
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  return null;
}
