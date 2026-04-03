import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma v7 compatible initialization
const getPrisma = (): PrismaClient => {
  if (!globalForPrisma.prisma) {
    console.log("▲ [Prisma] Initializing Client...");
    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" 
        ? ["query", "error", "warn"] 
        : ["error"],
    });
  }
  return globalForPrisma.prisma;
};

// Export the Prisma client
// In v7, we use a simpler approach without Proxy for better compatibility
export const prisma = getPrisma();

// Handle graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
