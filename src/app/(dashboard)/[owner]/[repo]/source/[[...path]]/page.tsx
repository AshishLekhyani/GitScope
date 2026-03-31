import { SourceExplorerClient } from "@/features/source/source-explorer";

export default async function SourcePage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; path?: string[] }>;
}) {
  const p = await params;
  const pathStr = p.path ? p.path.join("/") : "";
  return <SourceExplorerClient owner={p.owner} repo={p.repo} path={pathStr} />;
}
