import { UserProfile } from "@/features/dashboard/user-profile";
import type { Metadata } from "next";

type Props = { params: Promise<{ owner: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner } = await params;
  return {
    title: `${owner}`,
    description: `View GitHub profile and repositories for ${owner}.`,
  };
}

export default async function UserDashboardPage({ params }: Props) {
  const { owner } = await params;
  return <UserProfile username={owner} />;
}
