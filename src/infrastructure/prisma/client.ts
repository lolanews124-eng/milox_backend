import { PrismaClient } from "@prisma/client";

import {
  adminPerfEnabled,
  recordAdminQuery,
} from "../observability/admin-perf.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

/**
 * Cap the Prisma pool so workers + admin GETs don't exhaust Postgres
 * `max_connections` and stall every request behind pool wait.
 * Override with PRISMA_CONNECTION_LIMIT / PRISMA_POOL_TIMEOUT_SEC.
 */
function databaseUrlWithPool(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set(
        "connection_limit",
        process.env.PRISMA_CONNECTION_LIMIT?.trim() || "12",
      );
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set(
        "pool_timeout",
        process.env.PRISMA_POOL_TIMEOUT_SEC?.trim() || "10",
      );
    }
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * Shared Prisma client for the API process.
 * Soft-delete and privacy filtering belong in repositories, not here.
 *
 * Unique-constraint failures are expected application conflicts (signup,
 * username changes). They are handled as 409 responses and are not logged
 * again here. Other Prisma errors are still printed.
 */
function createPrismaClient(): PrismaClient {
  const url = databaseUrlWithPool();
  const logQueries =
    process.env.PRISMA_LOG_QUERIES === "true" || adminPerfEnabled();
  const client = new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: [
      ...(logQueries
        ? [
            {
              emit: (adminPerfEnabled()
                ? ("event" as const)
                : ("stdout" as const)),
              level: "query" as const,
            },
          ]
        : []),
      { emit: "stdout" as const, level: "warn" as const },
      { emit: "event" as const, level: "error" as const },
    ],
  });

  client.$on("error", (event) => {
    if (event.message.includes("Unique constraint failed")) return;
    console.error(event.message);
  });

  if (adminPerfEnabled()) {
    client.$on("query", (event) => {
      // Never log SQL text or params — duration + generic label only.
      recordAdminQuery({
        model: "sql",
        action: "query",
        durationMs: event.duration,
      });
    });
  }

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
