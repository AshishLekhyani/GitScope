import { NextResponse } from "next/server";
import { githubFetch } from "@/lib/github";
import { getGitHubToken } from "@/lib/github-auth";
import type { CommitActivityWeek } from "@/types/github";

type Params = { owner: string; repo: string };

/** Weekly commit totals; may be empty until GitHub computes stats. */
export async function GET(
  _req: Request,
  context: { params: Promise<Params> }
) {
  const { owner, repo } = await context.params;
  try {
    const userToken = await getGitHubToken();
    const { data, rateLimitRemaining } = await githubFetch<{ all: number[]; owner: number[] }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/participation`,
      { userToken }
    );
    
    // Convert participation to the CommitActivityWeek format for UI
    let mappedData: CommitActivityWeek[] = [];
    if (data && Array.isArray(data.all)) {
      // Participation returns 52 weeks of commits. We mock the `week` timestamp by subtracting days from now.
      const now = Math.floor(Date.now() / 1000);
      mappedData = data.all.map((total, index) => {
        const weekTimestamp = now - (52 - index) * 7 * 24 * 60 * 60;
        return {
          total,
          week: weekTimestamp,
          days: [0,0,0,0,0,0,0], // We don't get daily breakdown from participation
        };
      });
    }

    return NextResponse.json({ data: mappedData, rateLimitRemaining }, { status: 200 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message },
      { status: err.status ?? 500 }
    );
  }
}
