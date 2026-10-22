import { AuditActorType, type PrismaClient } from "@prisma/client";

/**
 * Record a successful bot activity job in audit_logs (once per job id).
 * Idempotent so retries / double-finish cannot duplicate the event.
 */
export async function writeBotJobProcessedAudit(
  database: PrismaClient,
  job: {
    id: string;
    botAccountId: string;
    activityType: string;
    targetType: string;
    targetId: string;
  },
  detail?: string,
): Promise<void> {
  const existing = await database.auditLog.findFirst({
    where: {
      action: "bots.jobs.processed",
      resourceType: "bot_activity_job",
      resourceId: job.id,
    },
    select: { id: true },
  });
  if (existing) return;

  const bot = await database.botAccount.findUnique({
    where: { id: job.botAccountId },
    select: { userId: true },
  });

  await database.auditLog.create({
    data: {
      actorType: AuditActorType.SYSTEM,
      actorUserId: bot?.userId ?? null,
      action: "bots.jobs.processed",
      resourceType: "bot_activity_job",
      resourceId: job.id,
      metadata: {
        activityType: job.activityType,
        botAccountId: job.botAccountId,
        targetType: job.targetType,
        targetId: job.targetId,
        ...(detail ? { detail } : {}),
      },
    },
  });
}
