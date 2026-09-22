import {
  Prisma,
  type OutboxEvent,
  type PrismaClient,
} from "@prisma/client";

/**
 * Atomically claim the next pending outbox row for the given event types.
 * Uses PostgreSQL `FOR UPDATE SKIP LOCKED` so chat + notification workers
 * (and multiple app instances) never deadlock on the same claim.
 */
export async function claimNextOutboxEvent(
  database: PrismaClient,
  eventTypes: readonly string[],
): Promise<OutboxEvent | null> {
  if (eventTypes.length === 0) return null;

  const rows = await database.$queryRaw<OutboxEvent[]>`
    UPDATE "outbox_events" AS o
    SET
      status = 'PROCESSING'::"OutboxStatus",
      attempts = o.attempts + 1,
      "updatedAt" = NOW()
    WHERE o.id = (
      SELECT e.id
      FROM "outbox_events" AS e
      WHERE e.status = 'PENDING'::"OutboxStatus"
        AND e."availableAt" <= NOW()
        AND e."eventType" IN (${Prisma.join(eventTypes)})
      ORDER BY e."createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING
      o.id,
      o."eventType",
      o."aggregateType",
      o."aggregateId",
      o.payload,
      o.status,
      o.attempts,
      o."availableAt",
      o."processedAt",
      o."lastError",
      o."createdAt",
      o."updatedAt"
  `;

  return rows[0] ?? null;
}
