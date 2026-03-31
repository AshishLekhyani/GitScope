import { RepoOverview } from "@/features/dashboard/repo-overview";
import type { Metadata } from "next";

type Props = { params: Promise<{ owner: string; repo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, repo } = await params;
  return {
    title: `${owner}/${repo}`,
    description: `Overview and analytics for ${owner}/${repo} on GitHub.`,
  };
}

export default async function RepoDashboardPage({ params }: Props) {
  const { owner, repo } = await params;
  return <RepoOverview owner={owner} repo={repo} />;
}
