export const dynamic = "force-dynamic";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { notFound } from "next/navigation";
import { AdminPanel } from "@/features/admin/admin-panel";

function isAdmin(email?: string | null) {
  if (!email) return false;
  const adminEnv = (process.env.AI_TIER_ADMIN_EMAILS ?? "").trim();
  // Dev bypass: when env var is not configured, first logged-in user can access in dev mode
  if (!adminEnv && process.env.NODE_ENV === "development") return true;
  if (!adminEnv) return false;
  const admins = new Set(adminEnv.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  return admins.has(email.toLowerCase());
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) notFound();
  if (!isAdmin(session.user.email)) {
    if (!process.env.AI_TIER_ADMIN_EMAILS?.trim()) {
      // Env var not set — show a helpful message in production
      return (
        <div className="min-h-screen flex items-center justify-center p-8">
          <div className="max-w-md space-y-3 text-center">
            <p className="text-lg font-black text-foreground">Admin access not configured</p>
            <p className="text-sm text-muted-foreground/70">
              Set <code className="font-mono text-amber-400">AI_TIER_ADMIN_EMAILS</code> in your environment to your email address to enable the admin panel.
            </p>
          </div>
        </div>
      );
    }
    notFound();
  }
  return <AdminPanel adminEmail={session.user.email!} />;
}
