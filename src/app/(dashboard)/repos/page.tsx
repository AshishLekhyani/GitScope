export const dynamic = "force-dynamic";

import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "My Repositories — GitScope",
  description: "Manage and monitor your GitHub repositories.",
};

import { requireTier } from "@/lib/auth-tier";
import { ReposClient } from "@/features/repos/repos-client";

export default async function MyReposPage() {
  await requireTier("credentials");
  return <ReposClient />;
}
