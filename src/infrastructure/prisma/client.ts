import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * Shared Prisma client for the API process.
 * Soft-delete and privacy filtering belong in repositories, not here.
 *
 * Unique-constraint failures are expected application conflicts (signup,
 * username changes). They are handled as 409 responses and are not logged
 * again here. Other Prisma errors are still printed.
 */
function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      ...(process.env.PRISMA_LOG_QUERIES === "true"
        ? [{ emit: "stdout" as const, level: "query" as const }]
        : []),
      { emit: "stdout" as const, level: "warn" as const },
      { emit: "event" as const, level: "error" as const },
    ],
  });

  client.$on("error", (event) => {
    if (event.message.includes("Unique constraint failed")) return;
    console.error(event.message);
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
