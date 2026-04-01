import type { Metadata } from "next";
import { BlogPageClient } from "@/features/blog/blog-page-client";

export const metadata: Metadata = {
  title: "Blog — GitScope",
  description:
    "Deep-dives on engineering analytics, developer productivity, open-source health, and DORA metrics from the GitScope team.",
};

export default function BlogPage() {
  return <BlogPageClient />;
}
