export const dynamic = "force-dynamic";

import { requireTier } from "@/lib/auth-tier";
import { ReposClient } from "@/features/repos/repos-client";

export default async function MyReposPage() {
  await requireTier("credentials");
  return <ReposClient />;
}
