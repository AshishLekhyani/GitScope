import { CommitsPage } from "@/features/dashboard/commits-page";

export default async function Page({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  return <CommitsPage owner={owner} repo={repo} />;
}
