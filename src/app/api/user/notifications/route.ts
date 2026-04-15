import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGitHubToken } from "@/lib/github-auth";
import { NextResponse } from "next/server";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

// Type for local notifications from Prisma
interface LocalNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  link: string | null;
  createdAt: Date;
}

function convertGitHubApiUrl(apiUrl: string | null): string {
  if (!apiUrl) return "/notifications";
  // Convert GitHub REST API URL to browser-viewable HTML URL
  // e.g. https://api.github.com/repos/owner/repo/pulls/123 → https://github.com/owner/repo/pull/123
  return apiUrl
    .replace("https://api.github.com/repos/", "https://github.com/")
    .replace(/\/pulls\/(\d+)$/, "/pull/$1")
    .replace(/\/commits\/([a-f0-9]+)$/, "/commit/$1");
}

async function getHandler() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Fetch internal system notifications from Prisma
    const localNotifications = await prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20
    });

    // 2. Fetch GitHub notifications if available
    type NotificationItem = { id: string; title: string; message: string; type: string; isRead: boolean; link: string; createdAt: string; source: string };
    let githubNotifications: NotificationItem[] = [];
    const ghToken = await getGitHubToken();
    if (ghToken) {
      try {
        const ghRes = await fetch("https://api.github.com/notifications?participating=true", {
          headers: {
            Authorization: `Bearer ${ghToken}`,
            "Accept": "application/vnd.github.v3+json",
          },
          next: { revalidate: 60 } // Cache for 1 min
        });

        if (ghRes.ok) {
          const ghData: { id: string; subject: { title: string; type: string; url: string }; repository: { full_name: string }; reason: string; updated_at: string }[] = await ghRes.json();
          githubNotifications = ghData.map((n) => ({
            id: `gh-${n.id}`,
            title: n.subject.title,
            message: `${n.repository.full_name} - ${n.reason.replace(/_/g, ' ')}`,
            type: n.subject.type === "PullRequest" ? "info" : "warning",
            isRead: false,
            link: convertGitHubApiUrl(n.subject.url),
            createdAt: n.updated_at,
            source: "github"
          }));
        }
      } catch (e) {
        // Silently fail - GitHub notifications are optional
        if (process.env.NODE_ENV !== "production") {
          console.error("Failed to fetch GH notifications", e);
        }
      }
    }

    // Merge and sort
    const merged = [
      ...localNotifications.map((n: LocalNotification) => ({ ...n, source: "gitscope" })),
      ...githubNotifications
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json(merged);
  } catch (error) {
    // Log error only in development
    if (process.env.NODE_ENV !== "production") {
      console.error("Notification Fetch Error:", error);
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

async function patchHandler(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    if (id.startsWith("gh-")) {
      // For GitHub, we'd normally hit their 'mark as read' endpoint
      // But for now, we'll just acknowledge the request
      return NextResponse.json({ success: true });
    }

    await prisma.notification.update({
      where: { id, userId: session.user.id },
      data: { isRead: true }
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

// Apply security middleware - GET is read-only (no CSRF), PATCH requires CSRF protection
export const GET = withRouteSecurity(getHandler, { ...SecurityPresets.public, csrf: false });
export const PATCH = withRouteSecurity(patchHandler, SecurityPresets.standard);
