import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Create a proxy to lazily initialize Prisma only when first accessed.
// This prevents build-time crashes during static analysis when the DB is unreachable.
export const prisma = globalForPrisma.prisma ?? new Proxy({} as PrismaClient, {
  get: (target, prop, receiver) => {
    if (!globalForPrisma.prisma) {
      console.log("▲ [Prisma] Lazily initializing Client...");
      globalForPrisma.prisma = new PrismaClient();
    }
    return Reflect.get(globalForPrisma.prisma, prop, receiver);
  }
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
