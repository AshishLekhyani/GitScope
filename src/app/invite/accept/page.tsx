export const dynamic = "force-dynamic";

import type { Metadata } from "next";
export const metadata: Metadata = { title: "Accept Workspace Invite — GitScope" };

import { InviteAcceptClient } from "@/features/organizations/invite-accept-client";

export default function InviteAcceptPage({ searchParams }: { searchParams: { token?: string } }) {
  return <InviteAcceptClient token={searchParams.token ?? ""} />;
}
