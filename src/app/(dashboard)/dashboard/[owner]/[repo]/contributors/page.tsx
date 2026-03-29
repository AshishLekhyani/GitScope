import { ContributorsPageClient } from "@/features/dashboard/contributors-page";
import type { Metadata } from "next";

type Props = { params: Promise<{ owner: string; repo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Contributors · ${owner}/${repo}` };
}

export default async function ContributorsPage({ params }: Props) {
  const { owner, repo } = await params;
  return <ContributorsPageClient owner={owner} repo={repo} />;
}
