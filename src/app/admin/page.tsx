export const dynamic = "force-dynamic";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminPanel } from "@/features/admin/admin-panel";

function isAdmin(email?: string | null) {
  if (!email) return false;
  const admins = new Set(
    (process.env.AI_TIER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
  return admins.has(email.toLowerCase());
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !isAdmin(session.user.email)) redirect("/unauthorized");
  return <AdminPanel adminEmail={session.user.email!} />;
}
