import { CodePageClient } from "@/features/code/code-page-client";
import type { Metadata } from "next";

type Props = { params: Promise<{ owner: string; repo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Code insights · ${owner}/${repo}` };
}

export default async function CodeInsightsPage({ params }: Props) {
  const { owner, repo } = await params;
  return <CodePageClient owner={owner} repo={repo} />;
}
