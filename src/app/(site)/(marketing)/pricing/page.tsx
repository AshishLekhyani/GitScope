import { PricingPageClient } from "@/features/pricing/pricing-page-client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — GitScope",
  description: "GitScope plans and pricing for engineering teams.",
};

export default async function PricingPage() {
  const session = await getServerSession(authOptions);
  return <PricingPageClient isAuthenticated={!!session?.user} />;
}
