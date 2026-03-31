import { requireTier } from "@/lib/auth-tier";
import { IntelligenceClient } from "@/features/intelligence/intelligence-client";

export default async function IntelligencePage() {
  // Hard server-side gate — middleware catches most cases, this is the final lock
  await requireTier("github");
  return <IntelligenceClient />;
}
