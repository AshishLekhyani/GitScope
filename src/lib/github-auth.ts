import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function getGitHubToken() {
  const session = await getServerSession(authOptions);
  
  // First priority: User's session token
  if (session?.accessToken) {
    return session.accessToken;
  }

  // Second priority: Environment fallback for development/demo
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  return null;
}
