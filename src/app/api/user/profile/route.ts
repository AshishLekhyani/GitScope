import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

async function getHandler() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, bio: true, githubHandle: true, image: true, email: true, password: true, githubApiKey: true },
  });

  if (!user) return NextResponse.json({});
  const { password, githubApiKey, ...rest } = user;
  return NextResponse.json({ ...rest, hasPassword: !!password, hasGithubApiKey: !!githubApiKey });
}

async function patchHandler(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    displayName?: string; bio?: string; gitHandle?: string; avatarUrl?: string;
    profileMeta?: { location?: string; website?: string; role?: string; company?: string; timezone?: string; primaryStack?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { displayName, bio, gitHandle, avatarUrl, profileMeta } = body;

  // Avatar URL: https only, trusted image CDN hosts only, image extension only.
  // github.com is intentionally excluded — it can serve HTML pages, not just images.
  const ALLOWED_AVATAR_HOSTS = new Set([
    "avatars.githubusercontent.com",     // GitHub avatars
    "lh3.googleusercontent.com",         // Google profile photos
    "lh4.googleusercontent.com",
    "lh5.googleusercontent.com",
    "lh6.googleusercontent.com",
    "api.dicebear.com",                  // DiceBear avatar generator
  ]);
  const ALLOWED_AVATAR_EXTS = /\.(png|jpg|jpeg|webp|gif|svg)(\?|$)/i;
  let sanitizedAvatar: string | undefined;
  if (avatarUrl) {
    try {
      const parsed = new URL(avatarUrl);
      if (
        parsed.protocol === "https:" &&
        ALLOWED_AVATAR_HOSTS.has(parsed.hostname) &&
        (ALLOWED_AVATAR_EXTS.test(parsed.pathname) || parsed.hostname === "api.dicebear.com")
      ) {
        sanitizedAvatar = avatarUrl.slice(0, 500);
      }
    } catch {
      // invalid URL — ignore
    }
  }

  // Sanitize profileMeta fields
  let sanitizedMeta: string | undefined;
  if (profileMeta) {
    const safe = {
      location:     (profileMeta.location     ?? "").slice(0, 100),
      website:      (profileMeta.website      ?? "").slice(0, 200),
      role:         (profileMeta.role         ?? "").slice(0, 100),
      company:      (profileMeta.company      ?? "").slice(0, 100),
      timezone:     (profileMeta.timezone     ?? "").slice(0, 60),
      primaryStack: (profileMeta.primaryStack ?? "").slice(0, 200),
    };
    sanitizedMeta = JSON.stringify(safe);
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(displayName !== undefined && { name: displayName.slice(0, 100) }),
      ...(bio !== undefined && { bio: bio.slice(0, 500) }),
      ...(gitHandle !== undefined && { githubHandle: gitHandle.slice(0, 50) }),
      ...(sanitizedAvatar !== undefined && { image: sanitizedAvatar }),
      ...(sanitizedMeta !== undefined && { profileMeta: sanitizedMeta }),
    },
  });

  return NextResponse.json({ ok: true });
}

// Apply security middleware - GET is read-only, PATCH requires CSRF
export const GET = withRouteSecurity(getHandler, { ...SecurityPresets.public, csrf: false });
export const PATCH = withRouteSecurity(patchHandler, SecurityPresets.standard);
