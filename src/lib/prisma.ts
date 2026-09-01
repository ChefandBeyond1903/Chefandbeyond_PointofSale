import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Reuse one client across invocations in every environment. On Vercel a warm
// serverless container keeps this module in memory, so pinning it here avoids
// opening a fresh DB connection on each request. (In dev this also survives HMR.)
globalForPrisma.prisma = prisma;
