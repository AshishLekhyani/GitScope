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

  let body: { displayName?: string; bio?: string; gitHandle?: string; avatarUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { displayName, bio, gitHandle, avatarUrl } = body;

  // Avatar URL: must be https and from a trusted image host
  const ALLOWED_AVATAR_HOSTS = [
    "avatars.githubusercontent.com",
    "lh3.googleusercontent.com",
    "lh4.googleusercontent.com",
    "lh5.googleusercontent.com",
    "lh6.googleusercontent.com",
    "api.dicebear.com",
    "github.com",
  ];
  let sanitizedAvatar: string | undefined;
  if (avatarUrl) {
    try {
      const parsed = new URL(avatarUrl);
      if (parsed.protocol === "https:" && ALLOWED_AVATAR_HOSTS.includes(parsed.hostname)) {
        sanitizedAvatar = avatarUrl.slice(0, 500);
      }
    } catch {
      // invalid URL — ignore
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(displayName !== undefined && { name: displayName.slice(0, 100) }),
      ...(bio !== undefined && { bio: bio.slice(0, 500) }),
      ...(gitHandle !== undefined && { githubHandle: gitHandle.slice(0, 50) }),
      ...(sanitizedAvatar !== undefined && { image: sanitizedAvatar }),
    },
  });

  return NextResponse.json({ ok: true });
}

// Apply security middleware - GET is read-only, PATCH requires CSRF
export const GET = withRouteSecurity(getHandler, { ...SecurityPresets.public, csrf: false });
export const PATCH = withRouteSecurity(patchHandler, SecurityPresets.standard);
