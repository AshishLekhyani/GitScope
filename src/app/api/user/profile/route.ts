import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, bio: true, githubHandle: true, image: true, email: true, password: true },
  });

  if (!user) return NextResponse.json({});
  const { password, ...rest } = user;
  return NextResponse.json({ ...rest, hasPassword: !!password });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { displayName?: string; bio?: string; gitHandle?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { displayName, bio, gitHandle } = body;

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(displayName !== undefined && { name: displayName.slice(0, 100) }),
      ...(bio !== undefined && { bio: bio.slice(0, 500) }),
      ...(gitHandle !== undefined && { githubHandle: gitHandle.slice(0, 50) }),
    },
  });

  return NextResponse.json({ ok: true });
}
