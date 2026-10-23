import {
  AuditActorType,
  UserRole,
  UserStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { notifyIndexNow } from "../../../infrastructure/indexnow.js";
import {
  activitySignalSource,
  computeLastActivityAt,
  DEFAULT_INACTIVE_ACCOUNT_DAYS,
  INACTIVE_ACCOUNT_POLICY_VERSION,
  inactiveSuspensionReason,
  inactivityCutoff,
  isPastInactivityThreshold,
  type ActivitySignalSource,
} from "./inactive-account-policy.js";

/** Postgres advisory lock key namespace for this job. */
const ADVISORY_LOCK_KEY = 814_230_014;

export type InactiveSuspensionOptions = {
  /** When false (default), no writes. */
  apply?: boolean;
  inactiveDays?: number;
  batchSize?: number;
  /** Max accounts to suspend/scan this run (safety cap). */
  maxAccounts?: number;
  now?: Date;
  /** Skip IndexNow pings (tests). */
  skipIndexNow?: boolean;
};

export type InactiveCandidateSummary = {
  id: string;
  username: string;
  lastActivityAt: string;
  signal: ActivitySignalSource;
  createdAt: string;
};

export type InactiveSuspensionResult = {
  mode: "dry-run" | "apply";
  policyVersion: typeof INACTIVE_ACCOUNT_POLICY_VERSION;
  inactiveDays: number;
  cutoffIso: string;
  scanned: number;
  eligible: number;
  suspended: number;
  skippedAlreadyInactive: number;
  skippedNotEligible: number;
  lockAcquired: boolean;
  reason: string;
  sample: InactiveCandidateSummary[];
};

const candidateSelect = {
  id: true,
  username: true,
  lastSeenAt: true,
  lastLoginAt: true,
  createdAt: true,
  status: true,
  role: true,
  isSystemAccount: true,
  isAutomatedAccount: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

type CandidateRow = Prisma.UserGetPayload<{ select: typeof candidateSelect }>;

function eligibleAccountWhere(): Prisma.UserWhereInput {
  return {
    status: UserStatus.ACTIVE,
    role: UserRole.USER,
    deletedAt: null,
    isSystemAccount: false,
    isAutomatedAccount: false,
  };
}

/**
 * DB-side prefilter: last activity earlier than cutoff.
 * Mirrors computeLastActivityAt (max of signals, else createdAt).
 */
function inactivePrefilterWhere(cutoff: Date): Prisma.UserWhereInput {
  return {
    AND: [
      eligibleAccountWhere(),
      {
        OR: [
          {
            lastSeenAt: { lt: cutoff },
            lastLoginAt: { lt: cutoff },
          },
          {
            lastSeenAt: { lt: cutoff },
            lastLoginAt: null,
          },
          {
            lastSeenAt: null,
            lastLoginAt: { lt: cutoff },
          },
          {
            lastSeenAt: null,
            lastLoginAt: null,
            createdAt: { lt: cutoff },
          },
        ],
      },
    ],
  };
}

function isProtectedAccount(row: CandidateRow): boolean {
  return (
    row.role !== UserRole.USER ||
    row.isSystemAccount ||
    row.isAutomatedAccount ||
    row.deletedAt != null ||
    row.status !== UserStatus.ACTIVE
  );
}

async function tryAdvisoryLock(database: PrismaClient): Promise<boolean> {
  const rows = await database.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked
  `;
  return Boolean(rows[0]?.locked);
}

async function releaseAdvisoryLock(database: PrismaClient): Promise<void> {
  await database.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
}

/**
 * Dry-run by default. With apply=true, suspends eligible ACTIVE consumer
 * accounts and revokes refresh sessions. Never deletes content.
 */
export async function runInactiveAccountSuspension(
  database: PrismaClient,
  options: InactiveSuspensionOptions = {},
): Promise<InactiveSuspensionResult> {
  const apply = options.apply === true;
  const inactiveDays = options.inactiveDays ?? DEFAULT_INACTIVE_ACCOUNT_DAYS;
  const batchSize = Math.min(Math.max(options.batchSize ?? 100, 1), 500);
  const maxAccounts = Math.min(Math.max(options.maxAccounts ?? 5_000, 1), 50_000);
  const now = options.now ?? new Date();
  const cutoff = inactivityCutoff(now, inactiveDays);
  const reason = inactiveSuspensionReason(inactiveDays);

  const lockAcquired = await tryAdvisoryLock(database);
  if (!lockAcquired) {
    return {
      mode: apply ? "apply" : "dry-run",
      policyVersion: INACTIVE_ACCOUNT_POLICY_VERSION,
      inactiveDays,
      cutoffIso: cutoff.toISOString(),
      scanned: 0,
      eligible: 0,
      suspended: 0,
      skippedAlreadyInactive: 0,
      skippedNotEligible: 0,
      lockAcquired: false,
      reason,
      sample: [],
    };
  }

  let scanned = 0;
  let eligible = 0;
  let suspended = 0;
  let skippedAlreadyInactive = 0;
  let skippedNotEligible = 0;
  const sample: InactiveCandidateSummary[] = [];
  const indexPaths: string[] = [];

  try {
    let cursorId: string | undefined;

    while (eligible + skippedNotEligible < maxAccounts) {
      const batch = await database.user.findMany({
        where: {
          ...inactivePrefilterWhere(cutoff),
          ...(cursorId ? { id: { gt: cursorId } } : {}),
        },
        orderBy: { id: "asc" },
        take: batchSize,
        select: candidateSelect,
      });
      if (batch.length === 0) break;

      for (const row of batch) {
        scanned += 1;
        cursorId = row.id;

        if (isProtectedAccount(row)) {
          skippedNotEligible += 1;
          continue;
        }
        if (!isPastInactivityThreshold(row, cutoff)) {
          skippedNotEligible += 1;
          continue;
        }

        eligible += 1;
        const lastActivityAt = computeLastActivityAt(row);
        const signal = activitySignalSource(row);
        if (sample.length < 25) {
          sample.push({
            id: row.id,
            username: row.username,
            lastActivityAt: lastActivityAt.toISOString(),
            signal,
            createdAt: row.createdAt.toISOString(),
          });
        }

        if (!apply) continue;

        const outcome = await suspendOneInactiveAccount(database, {
          userId: row.id,
          username: row.username,
          reason,
          now,
          previousStatus: row.status,
        });
        if (outcome === "suspended") {
          suspended += 1;
          indexPaths.push(`/u/${row.username}`);
        } else if (outcome === "already") {
          skippedAlreadyInactive += 1;
        } else {
          skippedNotEligible += 1;
        }

        if (suspended + skippedAlreadyInactive >= maxAccounts) break;
      }

      if (batch.length < batchSize) break;
      if (apply && suspended >= maxAccounts) break;
      if (!apply && eligible >= maxAccounts) break;
    }

    if (apply && !options.skipIndexNow && indexPaths.length > 0) {
      void notifyIndexNow([...indexPaths, "/sitemap.xml"]);
    }
  } finally {
    await releaseAdvisoryLock(database).catch(() => undefined);
  }

  return {
    mode: apply ? "apply" : "dry-run",
    policyVersion: INACTIVE_ACCOUNT_POLICY_VERSION,
    inactiveDays,
    cutoffIso: cutoff.toISOString(),
    scanned,
    eligible,
    suspended,
    skippedAlreadyInactive,
    skippedNotEligible,
    lockAcquired: true,
    reason,
    sample,
  };
}

async function suspendOneInactiveAccount(
  database: PrismaClient,
  input: {
    userId: string;
    username: string;
    reason: string;
    now: Date;
    previousStatus: UserStatus;
  },
): Promise<"suspended" | "already" | "skipped"> {
  return database.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: {
        id: input.userId,
        ...eligibleAccountWhere(),
      },
      data: {
        status: UserStatus.SUSPENDED,
        banReason: input.reason,
        bannedAt: input.now,
      },
    });
    if (updated.count === 0) {
      const current = await tx.user.findUnique({
        where: { id: input.userId },
        select: { status: true },
      });
      if (current?.status === UserStatus.SUSPENDED) return "already";
      return "skipped";
    }

    await tx.refreshSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: input.now },
    });

    // ModerationAction.actorId is required (staff FK) — system job uses AuditLog only.
    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        actorUserId: null,
        action: "system.user.inactive_suspended",
        resourceType: "user",
        resourceId: input.userId,
        metadata: {
          username: input.username,
          reason: input.reason,
          policyVersion: INACTIVE_ACCOUNT_POLICY_VERSION,
          previousStatus: input.previousStatus,
          newStatus: UserStatus.SUSPENDED,
        },
      },
    });

    return "suspended";
  });
}
