export const dynamic = 'force-dynamic';

import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Docs & Reference — GitScope",
  description: "API documentation, keyboard shortcuts, and feature guides.",
};

import { DocsPageClient } from "@/features/docs/docs-page-client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";

export default async function DashboardDocsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect(ROUTES.login);
  }

  return <DocsPageClient variant="dashboard" />;
}
