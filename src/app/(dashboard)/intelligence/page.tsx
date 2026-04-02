export const dynamic = "force-dynamic";

import { requireTier } from "@/lib/auth-tier";
import { IntelligenceClient } from "@/features/intelligence/intelligence-client";

export default async function IntelligencePage() {
  // Intelligence hub is available to all signed-in users with tiered capabilities.
  await requireTier("credentials");
  return <IntelligenceClient />;
}
