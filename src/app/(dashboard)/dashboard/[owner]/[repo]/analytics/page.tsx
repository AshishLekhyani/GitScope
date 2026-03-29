import { AnalyticsRepoPanel } from "@/features/dashboard/analytics-repo";
import { CommitActivityChart } from "@/features/dashboard/charts/commit-activity-chart";
import { githubFetch } from "@/lib/github";
import type { CommitActivityWeek } from "@/types/github";
import type { Metadata } from "next";

type Props = { params: Promise<{ owner: string; repo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, repo } = await params;
  return {
    title: `Analytics · ${owner}/${repo}`,
  };
}

export default async function AnalyticsPage({ params }: Props) {
  const { owner, repo } = await params;
  let weeks: CommitActivityWeek[] = [];
  try {
    const { data } = await githubFetch<CommitActivityWeek[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/commit_activity`
    );
    weeks = data;
  } catch {
    weeks = [];
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pull request mix and weekly commit cadence.
        </p>
      </div>
      <AnalyticsRepoPanel owner={owner} repo={repo} />
      <CommitActivityChart weeks={weeks} />
    </div>
  );
}
