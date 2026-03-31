import { BlogPageClient } from "../../../../features/blog/blog-page-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Engineer's Log — GitScope",
  description: "Architectural insights, telemetry methodologies, and platform engineering updates.",
};

export default function BlogPage() {
  return <BlogPageClient />;
}
