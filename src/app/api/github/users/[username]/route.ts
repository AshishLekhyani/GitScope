import { NextRequest, NextResponse } from "next/server";
import { getGitHubToken } from "@/lib/github-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    const token = await getGitHubToken();

    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "GitScope",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Fetch user details
    const userResponse = await fetch(`https://api.github.com/users/${username}`, {
      headers,
      next: { revalidate: 300 }, // Cache for 5 minutes
    });

    if (!userResponse.ok) {
      if (userResponse.status === 404) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 404 }
        );
      }
      if (userResponse.status === 403) {
        const rateLimitRemaining = userResponse.headers.get("X-RateLimit-Remaining");
        return NextResponse.json(
          { 
            error: "Rate limit exceeded",
            rateLimitRemaining 
          },
          { status: 403 }
        );
      }
      throw new Error(`GitHub API error: ${userResponse.statusText}`);
    }

    const userData = await userResponse.json();

    // Fetch user's repositories
    const reposResponse = await fetch(
      `https://api.github.com/users/${username}/repos?per_page=100&sort=updated&type=owner`,
      {
        headers,
        next: { revalidate: 600 }, // Cache for 10 minutes
      }
    );

    let repos = [];
    if (reposResponse.ok) {
      repos = await reposResponse.json();
    }

    // Fetch user's public events for contribution activity
    const eventsResponse = await fetch(
      `https://api.github.com/users/${username}/events/public?per_page=100`,
      {
        headers,
        next: { revalidate: 300 }, // Cache for 5 minutes
      }
    );

    let contributions: { date: string; count: number }[] = [];
    if (eventsResponse.ok) {
      const events = await eventsResponse.json();
      // Process events into daily contribution counts
      const contributionMap = new Map<string, number>();
      
      events.forEach((event: any) => {
        const date = event.created_at.split('T')[0];
        const count = contributionMap.get(date) || 0;
        // Weight different event types
        let weight = 1;
        if (event.type === 'PushEvent') weight = event.payload?.commits?.length || 1;
        if (event.type === 'PullRequestEvent') weight = 3;
        if (event.type === 'IssuesEvent') weight = 2;
        if (event.type === 'CreateEvent') weight = 1;
        contributionMap.set(date, count + weight);
      });
      
      contributions = Array.from(contributionMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    // If no events found, try to get commit activity from repos
    if (contributions.length === 0 && repos.length > 0) {
      // Get commit activity for the most active repos
      const topRepos = repos.slice(0, 3);
      for (const repo of topRepos) {
        try {
          const commitsResponse = await fetch(
            `https://api.github.com/repos/${username}/${repo.name}/commits?per_page=100&author=${username}`,
            { headers, next: { revalidate: 600 } }
          );
          if (commitsResponse.ok) {
            const commits = await commitsResponse.json();
            const contributionMap = new Map<string, number>();
            
            // Add existing contributions
            contributions.forEach(c => contributionMap.set(c.date, c.count));
            
            commits.forEach((commit: any) => {
              const date = commit.commit?.committer?.date?.split('T')[0] || 
                          commit.commit?.author?.date?.split('T')[0];
              if (date) {
                const count = contributionMap.get(date) || 0;
                contributionMap.set(date, count + 1);
              }
            });
            
            contributions = Array.from(contributionMap.entries())
              .map(([date, count]) => ({ date, count }))
              .sort((a, b) => a.date.localeCompare(b.date));
          }
        } catch {
          // Ignore errors for individual repos
        }
      }
    }

    const rateLimitRemaining = userResponse.headers.get("X-RateLimit-Remaining");

    // Fetch language statistics from repos for real code volume data
    const languageStats: Record<string, number> = {};
    
    // Get language stats for top 10 repos (to avoid rate limits)
    const reposToAnalyze = repos.slice(0, 10);
    
    for (const repo of reposToAnalyze) {
      try {
        const langResponse = await fetch(
          `https://api.github.com/repos/${username}/${repo.name}/languages`,
          { headers, next: { revalidate: 600 } }
        );
        
        if (langResponse.ok) {
          const langData = await langResponse.json();
          // Aggregate bytes per language across all repos
          Object.entries(langData).forEach(([lang, bytes]) => {
            languageStats[lang] = (languageStats[lang] || 0) + (bytes as number);
          });
        }
      } catch {
        // Ignore errors for individual repos
      }
    }

    return NextResponse.json({
      user: userData,
      repos,
      contributions,
      languageStats,
      rateLimitRemaining,
    });
  } catch (error) {
    console.error("Error fetching GitHub user:", error);
    return NextResponse.json(
      { error: "Failed to fetch user data" },
      { status: 500 }
    );
  }
}
