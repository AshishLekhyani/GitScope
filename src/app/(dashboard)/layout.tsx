export const dynamic = 'force-dynamic';

import { DashboardShell } from "@/features/layout/dashboard-shell";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  return <DashboardShell session={session}>{children}</DashboardShell>;
}
