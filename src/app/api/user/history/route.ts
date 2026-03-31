import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

type HistoryItem = {
  query: string;
  type: string;
  avatar: string | null;
  timestamp: Date;
};

// GET: Fetch last 10 history items
export async function GET() {
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
    console.error("Failed to fetch history:", error);
    // Return empty history instead of 500 to keep UI stable
    return NextResponse.json({ history: [] });
  }
}

// DELETE: Clear all history for the current user
export async function DELETE() {
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
    console.error("Failed to clear history:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST: Upsert history item
export async function POST(req: Request) {
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
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json({ error: "Database request failed" }, { status: 500 });
    }
    console.error("Failed to save history:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
