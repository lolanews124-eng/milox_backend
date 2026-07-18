import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * Shared Prisma client for the API process.
 * Soft-delete and privacy filtering belong in repositories, not here.
 */
const prismaLog =
  process.env.PRISMA_LOG_QUERIES === "true"
    ? (["query", "warn", "error"] as const)
    : (["warn", "error"] as const);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [...prismaLog],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
