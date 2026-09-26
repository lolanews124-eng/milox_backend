import { Prisma, type PrismaClient } from "@prisma/client";

function isRetryableSerializationError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function backoffMs(attempt: number): number {
  // 25, 50, 100, 200… + small jitter — avoids thundering herd on P2034.
  const base = Math.min(25 * 2 ** (attempt - 1), 400);
  return base + Math.floor(Math.random() * 40);
}

export async function runSerializableTransaction<T>(
  database: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  attempts = 8,
): Promise<T> {
  return runTransactionWithRetry(database, operation, {
    attempts,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

/** Retries Postgres write conflicts and deadlocks (Prisma P2034). */
export async function runTransactionWithRetry<T>(
  database: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  options: {
    attempts?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await database.$transaction(
        operation,
        options.isolationLevel
          ? { isolationLevel: options.isolationLevel }
          : undefined,
      );
    } catch (error) {
      lastError = error;
      if (attempt < attempts && isRetryableSerializationError(error)) {
        await new Promise((resolve) =>
          setTimeout(resolve, backoffMs(attempt)),
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Transaction retry exhausted");
}
