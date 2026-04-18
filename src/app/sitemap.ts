import type { MetadataRoute } from "next";

const BASE = (process.env.NEXTAUTH_URL ?? "https://git-scope-pi.vercel.app").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/features`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/security`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/api-reference`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/status`, lastModified: now, changeFrequency: "daily", priority: 0.4 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  return staticRoutes;
}
