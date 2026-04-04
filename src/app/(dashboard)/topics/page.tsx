export const dynamic = 'force-dynamic';

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { TopicsPageClient } from "@/features/topics/topics-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Topic Explorer",
  description: "Discover and explore GitHub topics across all repositories.",
};

interface TopicApiResponse {
  names: string[];
}

// Popular GitHub topics to seed the explorer
const POPULAR_TOPICS = [
  "javascript", "typescript", "python", "go", "rust", "java", "cpp", "csharp",
  "react", "vue", "angular", "svelte", "nextjs", "nuxt", "remix",
  "nodejs", "deno", "bun", "express", "fastify", "nestjs",
  "docker", "kubernetes", "terraform", "ansible", "github-actions",
  "aws", "gcp", "azure", "vercel", "netlify",
  "postgresql", "mysql", "mongodb", "redis", "sqlite", "supabase", "firebase",
  "graphql", "rest-api", "websocket", "grpc", "microservices",
  "machine-learning", "ai", "deep-learning", "tensorflow", "pytorch", "opencv",
  "blockchain", "web3", "solidity", "ethereum", "bitcoin",
  "security", "cryptography", "oauth", "jwt", "auth",
  "testing", "jest", "cypress", "playwright", "vitest",
  "tailwindcss", "bootstrap", "material-ui", "shadcn", "chakra-ui",
  "figma", "design-system", "ui", "ux",
  "documentation", "open-source", "hacktoberfest", "awesome",
  "cli", "gui", "mobile", "ios", "android", "flutter", "react-native",
  "desktop", "electron", "tauri",
  "game-development", "unity", "unreal-engine", "godot",
  "data-science", "data-visualization", "pandas", "numpy", "jupyter",
  "devops", "ci-cd", "monitoring", "observability", "logging",
  "performance", "optimization", "caching", "cdn",
  "pwa", "webassembly", "wasm", "ecommerce", "cms", "blog",
];

async function fetchTopics(owner: string, repo: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/topics`,
      {
        headers: {
          Accept: "application/vnd.github.mercy-preview+json",
        },
        next: { revalidate: 600 },
      }
    );
    if (!res.ok) return [];
    const data: TopicApiResponse = await res.json();
    return data.names ?? [];
  } catch {
    return [];
  }
}

// Fetch trending repositories to discover new topics
async function fetchTrendingRepos(): Promise<Array<{ owner: string; repo: string; stars: number; topics: string[] }>> {
  try {
    // Fetch popular repos from GitHub
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const res = await fetch(
      `https://api.github.com/search/repositories?q=stars:>1000+created:>${thirtyDaysAgo}&sort=stars&order=desc&per_page=50`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
        next: { revalidate: 3600 },
      }
    );
    
    if (!res.ok) return [];
    const data = await res.json();
    
    return data.items?.map((item: any) => ({
      owner: item.owner.login,
      repo: item.name,
      stars: item.stargazers_count,
      topics: item.topics || [],
    })) || [];
  } catch {
    return [];
  }
}

export default async function TopicsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(ROUTES.login);

  /* Fetch ALL unique repo searches (no limit!) */
  let repoQueries: string[] = [];
  try {
    if (session.user.id) {
      const rows = await prisma.searchHistory.findMany({
        where: { userId: session.user.id, type: "repo" },
        orderBy: { timestamp: "desc" },
        select: { query: true },
        distinct: ["query"],
      });
      repoQueries = rows.map((r) => r.query);
    }
  } catch {
    // DB unavailable
  }

  /* Aggregate topics from user repos */
  const topicCounts = new Map<string, number>();
  const repoTopics: { query: string; topics: string[] }[] = [];

  if (repoQueries.length > 0) {
    const results = await Promise.all(
      repoQueries.map(async (query) => {
        const [owner, repo] = query.split("/");
        if (!owner || !repo) return { query, topics: [] as string[] };
        const topics = await fetchTopics(owner, repo);
        return { query, topics };
      })
    );

    for (const { query, topics } of results) {
      if (topics.length > 0) {
        repoTopics.push({ query, topics });
        for (const topic of topics) {
          topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
        }
      }
    }
  }

  /* Fetch trending repos for topic discovery */
  const trendingRepos = await fetchTrendingRepos();
  const trendingTopics = new Map<string, { count: number; repos: string[] }>();
  
  for (const repo of trendingRepos) {
    for (const topic of repo.topics) {
      const existing = trendingTopics.get(topic);
      if (existing) {
        existing.count++;
        if (!existing.repos.includes(`${repo.owner}/${repo.repo}`)) {
          existing.repos.push(`${repo.owner}/${repo.repo}`);
        }
      } else {
        trendingTopics.set(topic, { 
          count: 1, 
          repos: [`${repo.owner}/${repo.repo}`] 
        });
      }
    }
  }

  /* Combine user topics with popular/trending topics */
  const allTopics = new Map<string, { count: number; source: 'user' | 'trending' | 'popular' }>();
  
  for (const [topic, count] of topicCounts) {
    allTopics.set(topic, { count, source: 'user' });
  }
  
  for (const [topic, data] of trendingTopics) {
    const existing = allTopics.get(topic);
    if (existing) {
      existing.count += data.count;
    } else {
      allTopics.set(topic, { count: data.count, source: 'trending' });
    }
  }
  
  for (const topic of POPULAR_TOPICS) {
    if (!allTopics.has(topic)) {
      allTopics.set(topic, { count: 0, source: 'popular' });
    }
  }

  const rankedTopics = Array.from(allTopics.entries())
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([name, data]) => ({ 
      name, 
      count: data.count,
      source: data.source 
    }));

  const topTrending = Array.from(trendingTopics.entries())
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 20)
    .map(([name, data]) => ({ name, ...data }));

  return (
    <TopicsPageClient
      repoQueries={repoQueries}
      repoTopics={repoTopics}
      rankedTopics={rankedTopics}
      trendingTopics={topTrending}
      popularTopics={POPULAR_TOPICS}
    />
  );
}
