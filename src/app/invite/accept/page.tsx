export const dynamic = "force-dynamic";

import type { Metadata } from "next";
export const metadata: Metadata = { title: "Accept Workspace Invite — GitScope" };

import { InviteAcceptClient } from "@/features/organizations/invite-accept-client";

export default async function InviteAcceptPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <InviteAcceptClient token={typeof token === "string" ? token : ""} />;
}
