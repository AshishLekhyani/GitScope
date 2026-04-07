export const dynamic = 'force-dynamic';

import { DashboardShell } from "@/features/layout/dashboard-shell";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ErrorBoundary } from "@/components/error-boundary";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  // Blanket auth guard — no page inside (dashboard) is accessible without a session.
  // Individual pages may add further tier checks (e.g. GitHub-only).
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <DashboardShell session={session}>
      <ErrorBoundary>
        {children}
      </ErrorBoundary>
    </DashboardShell>
  );
}
