import {
  AuditActorType,
  UserRole,
  UserStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  INACTIVE_ACCOUNT_POLICY_VERSION,
  INACTIVE_SUSPENSION_REASON,
} from "./inactive-account-policy.js";

/** Distinct advisory lock from the suspend job. */
const ADVISORY_LOCK_KEY = 814_230_015;

export const INACTIVE_SUSPENDED_AUDIT_ACTION =
  "system.user.inactive_suspended" as const;
export const INACTIVE_RESTORED_AUDIT_ACTION =
  "system.user.inactive_restored" as const;

/** Prefix shared by default and custom-day inactivity ban reasons. */
export const INACTIVE_SUSPENSION_REASON_PREFIX =
  "Automatic suspension: no qualifying activity for";

export type InactiveRestoreSkipReason =
  | "no_inactive_audit"
  | "already_restored"
  | "not_suspended"
  | "banned_or_deleted"
  | "reason_mismatch"
  | "superseded_by_admin"
  | "race_or_changed"
  | "protected_account";

export type InactiveRestoreOptions = {
  apply?: boolean;
  batchSize?: number;
  maxAccounts?: number;
  now?: Date;
};

export type InactiveRestoreCandidate = {
  userId: string;
  username: string;
  banReason: string;
  bannedAt: string | null;
  inactiveAuditId: string;
  inactiveAuditAt: string;
  policyVersion: string | null;
};

export type InactiveRestoreResult = {
  mode: "dry-run" | "apply";
  policyVersion: typeof INACTIVE_ACCOUNT_POLICY_VERSION;
  lockAcquired: boolean;
  scannedUsers: number;
  eligible: number;
  restored: number;
  skipped: Record<InactiveRestoreSkipReason, number>;
  sampleEligible: InactiveRestoreCandidate[];
  sampleSkipped: Array<{
    userId: string;
    username?: string;
    reason: InactiveRestoreSkipReason;
  }>;
};

function isInactiveBanReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  if (reason === INACTIVE_SUSPENSION_REASON) return true;
  return reason.startsWith(INACTIVE_SUSPENSION_REASON_PREFIX);
}

function metadataObject(
  metadata: Prisma.JsonValue,
): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function emptySkipCounts(): Record<InactiveRestoreSkipReason, number> {
  return {
    no_inactive_audit: 0,
    already_restored: 0,
    not_suspended: 0,
    banned_or_deleted: 0,
    reason_mismatch: 0,
    superseded_by_admin: 0,
    race_or_changed: 0,
    protected_account: 0,
  };
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

const candidateUserSelect = {
  id: true,
  username: true,
  status: true,
  banReason: true,
  bannedAt: true,
  deletedAt: true,
  role: true,
  isSystemAccount: true,
  isAutomatedAccount: true,
} satisfies Prisma.UserSelect;

type CandidateUser = Prisma.UserGetPayload<{
  select: typeof candidateUserSelect;
}>;

/**
 * Candidate prefilter: currently suspended with the inactivity reason string.
 * Final eligibility still requires a matching AuditLog (never status alone).
 */
function restorePrefilterWhere(): Prisma.UserWhereInput {
  return {
    status: UserStatus.SUSPENDED,
    deletedAt: null,
    role: UserRole.USER,
    isSystemAccount: false,
    isAutomatedAccount: false,
    banReason: { startsWith: INACTIVE_SUSPENSION_REASON_PREFIX },
  };
}

async function loadLatestAuditsByUser(
  database: PrismaClient,
  userIds: string[],
  action: string,
): Promise<Map<string, { id: string; createdAt: Date; metadata: Prisma.JsonValue }>> {
  if (userIds.length === 0) return new Map();
  const rows = await database.auditLog.findMany({
    where: {
      action,
      resourceType: "user",
      resourceId: { in: userIds },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      resourceId: true,
      createdAt: true,
      metadata: true,
    },
  });
  const map = new Map<
    string,
    { id: string; createdAt: Date; metadata: Prisma.JsonValue }
  >();
  for (const row of rows) {
    if (!row.resourceId || map.has(row.resourceId)) continue;
    map.set(row.resourceId, {
      id: row.id,
      createdAt: row.createdAt,
      metadata: row.metadata,
    });
  }
  return map;
}

async function loadSupersededUserIds(
  database: PrismaClient,
  pairs: Array<{ userId: string; after: Date }>,
): Promise<Set<string>> {
  const superseded = new Set<string>();
  if (pairs.length === 0) return superseded;

  const userIds = pairs.map((p) => p.userId);
  const afterByUser = new Map(pairs.map((p) => [p.userId, p.after]));

  const adminChanges = await database.auditLog.findMany({
    where: {
      action: "admin.user.status_changed",
      resourceType: "user",
      resourceId: { in: userIds },
    },
    select: { resourceId: true, createdAt: true },
  });
  for (const row of adminChanges) {
    if (!row.resourceId) continue;
    const after = afterByUser.get(row.resourceId);
    if (after && row.createdAt.getTime() > after.getTime()) {
      superseded.add(row.resourceId);
    }
  }

  const remaining = userIds.filter((id) => !superseded.has(id));
  if (remaining.length === 0) return superseded;

  const moderation = await database.moderationAction.findMany({
    where: {
      targetUserId: { in: remaining },
      actionCode: {
        in: ["USER_SUSPENDED", "USER_BANNED", "SUSPEND", "BAN"],
      },
    },
    select: { targetUserId: true, createdAt: true },
  });
  for (const row of moderation) {
    if (!row.targetUserId) continue;
    const after = afterByUser.get(row.targetUserId);
    if (after && row.createdAt.getTime() > after.getTime()) {
      superseded.add(row.targetUserId);
    }
  }

  return superseded;
}

function evaluateBatchUser(
  user: CandidateUser,
  inactiveAudit:
    | { id: string; createdAt: Date; metadata: Prisma.JsonValue }
    | undefined,
  restoreAudit: { createdAt: Date } | undefined,
  superseded: boolean,
):
  | { kind: "eligible"; candidate: InactiveRestoreCandidate }
  | { kind: "skip"; reason: InactiveRestoreSkipReason } {
  if (
    user.role !== UserRole.USER ||
    user.isSystemAccount ||
    user.isAutomatedAccount
  ) {
    return { kind: "skip", reason: "protected_account" };
  }
  if (user.deletedAt || user.status === UserStatus.BANNED) {
    return { kind: "skip", reason: "banned_or_deleted" };
  }
  if (!inactiveAudit) {
    return { kind: "skip", reason: "no_inactive_audit" };
  }
  if (
    restoreAudit &&
    restoreAudit.createdAt.getTime() >= inactiveAudit.createdAt.getTime()
  ) {
    return { kind: "skip", reason: "already_restored" };
  }
  if (user.status !== UserStatus.SUSPENDED) {
    return { kind: "skip", reason: "not_suspended" };
  }
  if (!isInactiveBanReason(user.banReason) || !user.banReason) {
    return { kind: "skip", reason: "reason_mismatch" };
  }
  const meta = metadataObject(inactiveAudit.metadata);
  const auditReason =
    typeof meta.reason === "string" ? meta.reason : INACTIVE_SUSPENSION_REASON;
  if (user.banReason !== auditReason) {
    return { kind: "skip", reason: "reason_mismatch" };
  }
  if (superseded) {
    return { kind: "skip", reason: "superseded_by_admin" };
  }

  return {
    kind: "eligible",
    candidate: {
      userId: user.id,
      username: user.username,
      banReason: user.banReason,
      bannedAt: user.bannedAt?.toISOString() ?? null,
      inactiveAuditId: inactiveAudit.id,
      inactiveAuditAt: inactiveAudit.createdAt.toISOString(),
      policyVersion:
        typeof meta.policyVersion === "string" ? meta.policyVersion : null,
    },
  };
}

async function restoreOne(
  database: PrismaClient,
  candidate: InactiveRestoreCandidate,
  now: Date,
): Promise<"restored" | "skipped"> {
  return database.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: {
        id: candidate.userId,
        status: UserStatus.SUSPENDED,
        banReason: candidate.banReason,
        deletedAt: null,
      },
      data: {
        status: UserStatus.ACTIVE,
        banReason: null,
        bannedAt: null,
      },
    });
    if (updated.count === 0) {
      return "skipped";
    }

    // Leave refresh sessions revoked — users must sign in again.
    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        actorUserId: null,
        action: INACTIVE_RESTORED_AUDIT_ACTION,
        resourceType: "user",
        resourceId: candidate.userId,
        metadata: {
          username: candidate.username,
          previousStatus: UserStatus.SUSPENDED,
          newStatus: UserStatus.ACTIVE,
          previousBanReason: candidate.banReason,
          previousBannedAt: candidate.bannedAt,
          sourceInactiveAuditId: candidate.inactiveAuditId,
          sourceInactiveAuditAt: candidate.inactiveAuditAt,
          policyVersion:
            candidate.policyVersion ?? INACTIVE_ACCOUNT_POLICY_VERSION,
          restoredAt: now.toISOString(),
        },
      },
    });

    return "restored";
  });
}

/**
 * Restore accounts suspended by the inactivity automation only.
 * Dry-run by default. Requires AuditLog proof — never status alone.
 */
export async function runInactiveAccountRestore(
  database: PrismaClient,
  options: InactiveRestoreOptions = {},
): Promise<InactiveRestoreResult> {
  const apply = options.apply === true;
  const batchSize = Math.min(Math.max(options.batchSize ?? 100, 1), 500);
  const maxAccounts = Math.min(
    Math.max(options.maxAccounts ?? 50_000, 1),
    100_000,
  );
  const now = options.now ?? new Date();

  const lockAcquired = await tryAdvisoryLock(database);
  if (!lockAcquired) {
    return {
      mode: apply ? "apply" : "dry-run",
      policyVersion: INACTIVE_ACCOUNT_POLICY_VERSION,
      lockAcquired: false,
      scannedUsers: 0,
      eligible: 0,
      restored: 0,
      skipped: emptySkipCounts(),
      sampleEligible: [],
      sampleSkipped: [],
    };
  }

  let scannedUsers = 0;
  let eligible = 0;
  let restored = 0;
  const skipped = emptySkipCounts();
  const sampleEligible: InactiveRestoreCandidate[] = [];
  const sampleSkipped: InactiveRestoreResult["sampleSkipped"] = [];

  try {
    let cursorId: string | undefined;

    while (scannedUsers < maxAccounts) {
      const batch = await database.user.findMany({
        where: {
          ...restorePrefilterWhere(),
          ...(cursorId ? { id: { gt: cursorId } } : {}),
        },
        orderBy: { id: "asc" },
        take: batchSize,
        select: candidateUserSelect,
      });
      if (batch.length === 0) break;

      const userIds = batch.map((u) => u.id);
      const [inactiveAudits, restoreAudits] = await Promise.all([
        loadLatestAuditsByUser(
          database,
          userIds,
          INACTIVE_SUSPENDED_AUDIT_ACTION,
        ),
        loadLatestAuditsByUser(
          database,
          userIds,
          INACTIVE_RESTORED_AUDIT_ACTION,
        ),
      ]);

      const supersedePairs = batch
        .map((user) => {
          const audit = inactiveAudits.get(user.id);
          return audit
            ? { userId: user.id, after: audit.createdAt }
            : null;
        })
        .filter((p): p is { userId: string; after: Date } => p !== null);
      const supersededIds = await loadSupersededUserIds(
        database,
        supersedePairs,
      );

      for (const user of batch) {
        scannedUsers += 1;
        cursorId = user.id;

        const outcome = evaluateBatchUser(
          user,
          inactiveAudits.get(user.id),
          restoreAudits.get(user.id),
          supersededIds.has(user.id),
        );

        if (outcome.kind === "skip") {
          skipped[outcome.reason] += 1;
          if (sampleSkipped.length < 25) {
            sampleSkipped.push({
              userId: user.id,
              username: user.username,
              reason: outcome.reason,
            });
          }
          continue;
        }

        eligible += 1;
        if (sampleEligible.length < 25) {
          sampleEligible.push(outcome.candidate);
        }

        if (!apply) {
          if (eligible >= maxAccounts) break;
          continue;
        }

        const result = await restoreOne(database, outcome.candidate, now);
        if (result === "restored") {
          restored += 1;
        } else {
          skipped.race_or_changed += 1;
          if (sampleSkipped.length < 25) {
            sampleSkipped.push({
              userId: outcome.candidate.userId,
              username: outcome.candidate.username,
              reason: "race_or_changed",
            });
          }
        }

        if (restored >= maxAccounts) break;
      }

      if (batch.length < batchSize) break;
      if (!apply && eligible >= maxAccounts) break;
      if (apply && restored >= maxAccounts) break;
    }
  } finally {
    await releaseAdvisoryLock(database).catch(() => undefined);
  }

  return {
    mode: apply ? "apply" : "dry-run",
    policyVersion: INACTIVE_ACCOUNT_POLICY_VERSION,
    lockAcquired: true,
    scannedUsers,
    eligible,
    restored,
    skipped,
    sampleEligible,
    sampleSkipped,
  };
}

/** Safe DB target label for logs (no credentials). */
export function describeDatabaseTarget(databaseUrl: string | undefined): string {
  if (!databaseUrl) return "(DATABASE_URL not set)";
  try {
    const parsed = new URL(databaseUrl);
    const db = parsed.pathname.replace(/^\//, "") || "(unknown-db)";
    const host = parsed.hostname || "(unknown-host)";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${host}${port}/${db}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}
