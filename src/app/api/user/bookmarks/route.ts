import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

/* GET /api/user/bookmarks — list all bookmarks for the authed user */
export async function GET(_req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const bookmarks = await prisma.bookmark.findMany({
    where: { userId: auth.session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    bookmarks: bookmarks.map((b) => ({
      owner: b.owner,
      repo: b.repo,
      avatar: b.avatar,
      stars: b.stars,
      description: b.description,
      bookmarkedAt: b.createdAt.toISOString(),
    })),
  });
}

/* POST /api/user/bookmarks — add or update a bookmark */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { owner?: string; repo?: string; avatar?: string; stars?: number; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { owner, repo, avatar = "", stars = 0, description = "" } = body;
  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  }

  // Sanitise inputs
  const safeOwner = String(owner).slice(0, 100).replace(/[^a-zA-Z0-9_.-]/g, "");
  const safeRepo  = String(repo).slice(0, 100).replace(/[^a-zA-Z0-9_.-]/g, "");

  await prisma.bookmark.upsert({
    where: { userId_owner_repo: { userId: auth.session.user.id, owner: safeOwner, repo: safeRepo } },
    update: {
      avatar: String(avatar).slice(0, 500),
      stars: Math.max(0, Number(stars) || 0),
      description: String(description).slice(0, 500),
    },
    create: {
      userId: auth.session.user.id,
      owner: safeOwner,
      repo: safeRepo,
      avatar: String(avatar).slice(0, 500),
      stars: Math.max(0, Number(stars) || 0),
      description: String(description).slice(0, 500),
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

/* DELETE /api/user/bookmarks — remove a bookmark by owner + repo */
export async function DELETE(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { owner?: string; repo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { owner, repo } = body;
  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  }

  await prisma.bookmark.deleteMany({
    where: { userId: auth.session.user.id, owner: String(owner), repo: String(repo) },
  });

  return NextResponse.json({ ok: true });
}
