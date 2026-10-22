import type { BotActivityJob, Prisma, PrismaClient } from "@prisma/client";

export type ClaimBotJobOptions = {
  /** When set, only claim PENDING jobs for this bot account. */
  botAccountId?: string;
};

/**
 * Atomically claim the next pending bot activity job.
 * Mirrors outbox claiming with FOR UPDATE SKIP LOCKED.
 */
export async function claimNextBotActivityJob(
  database: PrismaClient,
  options: ClaimBotJobOptions = {},
): Promise<BotActivityJob | null> {
  const botAccountId = options.botAccountId ?? null;
  const rows = await database.$queryRaw<BotActivityJob[]>`
    UPDATE "bot_activity_jobs" AS j
    SET
      status = 'PROCESSING'::"BotActivityJobStatus",
      attempts = j.attempts + 1,
      "updatedAt" = NOW()
    WHERE j.id = (
      SELECT e.id
      FROM "bot_activity_jobs" AS e
      WHERE e.status = 'PENDING'::"BotActivityJobStatus"
        AND e."availableAt" <= NOW()
        AND (
          ${botAccountId}::uuid IS NULL
          OR e."botAccountId" = ${botAccountId}::uuid
        )
      ORDER BY e."availableAt" ASC, e."createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING
      j.id,
      j."botAccountId",
      j."activityType",
      j."targetType",
      j."targetId",
      j.status,
      j.attempts,
      j."availableAt",
      j."processedAt",
      j."lastError",
      j.metadata,
      j."idempotencyKey",
      j."createdAt",
      j."updatedAt"
  `;

  return rows[0] ?? null;
}

/** Return stale PROCESSING rows to PENDING after a timeout. */
export async function recoverStaleBotActivityJobs(
  database: PrismaClient,
  staleAfterMs: number,
  options: ClaimBotJobOptions = {},
): Promise<number> {
  const botAccountId = options.botAccountId ?? null;
  const result = await database.$executeRaw`
    UPDATE "bot_activity_jobs"
    SET
      status = 'PENDING'::"BotActivityJobStatus",
      "updatedAt" = NOW(),
      "lastError" = LEFT(COALESCE("lastError", '') || ' | stale_recovery', 500)
    WHERE status = 'PROCESSING'::"BotActivityJobStatus"
      AND "updatedAt" < NOW() - (${staleAfterMs}::bigint * INTERVAL '1 millisecond')
      AND (
        ${botAccountId}::uuid IS NULL
        OR "botAccountId" = ${botAccountId}::uuid
      )
  `;
  return Number(result);
}

export function botJobBackoffMs(attempts: number): number {
  const base = 5_000;
  const capped = Math.min(attempts, 6);
  return base * 2 ** Math.max(0, capped - 1);
}

/** Re-queue a failed job with delay (bounded by caller). */
export async function requeueBotActivityJob(
  database: PrismaClient,
  jobId: string,
  lastError: string,
  delayMs: number,
): Promise<void> {
  await database.$executeRaw`
    UPDATE "bot_activity_jobs"
    SET
      status = 'PENDING'::"BotActivityJobStatus",
      "availableAt" = NOW() + (${delayMs}::bigint * INTERVAL '1 millisecond'),
      "lastError" = ${lastError.slice(0, 500)},
      "updatedAt" = NOW()
    WHERE id = ${jobId}::uuid
  `;
}

export async function finishBotActivityJob(
  database: PrismaClient,
  jobId: string,
  status: "PROCESSED" | "FAILED" | "SKIPPED" | "CANCELLED",
  lastError?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await database.botActivityJob.update({
    where: { id: jobId },
    data: {
      status,
      processedAt: new Date(),
      ...(lastError !== undefined ? { lastError: lastError.slice(0, 500) } : {}),
      ...(metadata
        ? { metadata: metadata as Prisma.InputJsonValue }
        : {}),
    },
  });
}
