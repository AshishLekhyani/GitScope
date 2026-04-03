import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

type HistoryItem = {
  query: string;
  type: string;
  avatar: string | null;
  timestamp: Date;
};

// GET: Fetch last 10 history items
async function getHandler() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ history: [] });
  }

  try {
    const history = await prisma.searchHistory.findMany({
      where: { userId: session.user.id },
      orderBy: { timestamp: "desc" },
      take: 10,
    });

    return NextResponse.json({ 
      history: history.map((h: HistoryItem) => ({
        id: h.query,
        name: h.query.includes('/') ? h.query.split('/')[1] : h.query,
        type: h.type,
        avatar: h.avatar,
        timestamp: h.timestamp.getTime()
      })) 
    });
  } catch (error) {
    // Log error only in development
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to fetch history:", error);
    }
    // Return empty history instead of 500 to keep UI stable
    return NextResponse.json({ history: [] });
  }
}

// DELETE: Clear all history for the current user
async function deleteHandler() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.searchHistory.deleteMany({
      where: { userId: session.user.id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    // Log error only in development
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to clear history:", error);
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST: Upsert history item
async function postHandler(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await req.json() as { id?: string; type?: string; avatar?: string };
    const { id, type, avatar } = payload;

    if (!id || !type) {
      return NextResponse.json({ error: "Missing id or type" }, { status: 400 });
    }

    if (type !== "repo" && type !== "user") {
      return NextResponse.json({ error: "Invalid history type" }, { status: 400 });
    }

    // Use pure Prisma upsert with the composite unique key
    const historyItem = await prisma.searchHistory.upsert({
      where: {
        userId_query: {
          userId: session.user.id,
          query: id
        }
      },
      update: {
        timestamp: new Date(),
        avatar: avatar
      },
      create: {
        userId: session.user.id,
        query: id,
        type: type,
        avatar: avatar,
        timestamp: new Date()
      }
    });

    return NextResponse.json({ success: true, item: historyItem });
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      return NextResponse.json({ error: "Database request failed" }, { status: 500 });
    }
    // Log error only in development
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to save history:", error);
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// Apply security middleware - GET is read-only (no CSRF), POST/DELETE require CSRF protection
export const GET = withRouteSecurity(getHandler, { ...SecurityPresets.public, csrf: false });
export const POST = withRouteSecurity(postHandler, SecurityPresets.standard);
export const DELETE = withRouteSecurity(deleteHandler, SecurityPresets.standard);
