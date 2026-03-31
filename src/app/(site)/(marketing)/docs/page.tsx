import { DocsPageClient } from "@/features/docs/docs-page-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentation — GitScope",
  description: "GitScope API documentation, guides, and engineering references.",
};

export default function DocsPage() {
  return <DocsPageClient />;
}
