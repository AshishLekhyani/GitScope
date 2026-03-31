import { PricingPageClient } from "@/features/pricing/pricing-page-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — GitScope",
  description: "GitScope plans and pricing for engineering teams.",
};

export default function PricingPage() {
  return <PricingPageClient />;
}
