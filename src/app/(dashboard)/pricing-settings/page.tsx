export const dynamic = 'force-dynamic';

import { PricingPageClient } from "@/features/pricing/pricing-page-client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROUTES } from "@/constants/routes";

export default async function DashboardPricingPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect(ROUTES.login);
  }

  return <PricingPageClient variant="dashboard" />;
}
