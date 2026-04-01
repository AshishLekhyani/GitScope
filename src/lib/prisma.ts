import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Lazy initialization logic
const getPrisma = (): PrismaClient => {
  if (!globalForPrisma.prisma) {
    console.log("▲ [Prisma] Lazily initializing Client...");
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
};

// Create a proxy that points to the getter
export const prisma = new Proxy({} as PrismaClient, {
  get: (target, prop, receiver) => {
    return Reflect.get(getPrisma(), prop, receiver);
  }
});

if (process.env.NODE_ENV !== "production") {
  // In development, ensure we don't accidentally set the Proxy back to global
  // We leave globalForPrisma.prisma as the raw client (initialized on first call)
}
