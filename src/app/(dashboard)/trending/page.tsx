import { TrendingReposPanel } from "@/features/trending/trending-repos";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trending",
  description: "Highly starred repositories (GitHub search proxy).",
};

export default function TrendingPage() {
  return <TrendingReposPanel />;
}
