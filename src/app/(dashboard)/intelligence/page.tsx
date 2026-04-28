export const dynamic = "force-dynamic";

import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Code Lens — GitScope",
  description: "AI-powered security scans, PR reviews, code analysis, and documentation generation.",
};

import { Suspense } from "react";
import { requireTier } from "@/lib/auth-tier";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { IntelligenceClient } from "@/features/intelligence/intelligence-client";

export default async function IntelligencePage() {
  await requireTier("credentials");
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? session?.user?.email ?? "anon";
  return (
    <Suspense>
      <IntelligenceClient userId={userId} />
    </Suspense>
  );
}
