import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  AuditActorType,
  BotAccountStatus,
  BotActivityJobStatus,
  MediaKind,
  MediaVisibility,
  Prisma,
  UserRole,
  UserStatus,
  type AgeRange,
  type Gender,
  type PrismaClient,
} from "@prisma/client";

import type {
  BotAccountDetail,
  BotAccountListItem,
  BotAuditListItem,
  BotCandidateBatchRecord,
  BotJobListItem,
  BotMetrics,
  BotSettingsRecord,
  BotsRepository,
  CandidateRow,
  CreateAutomatedBotInput,
  CreatedBotRecord,
  ProvisionSourceRow,
} from "../application/ports/bots-repository.js";

const SETTINGS_ID = "default";

const defaultActivityLimits = {
  likesEnabled: true,
  commentsEnabled: true,
  followsEnabled: true,
  viewsEnabled: false,
} as const;

function mapSettings(row: {
  id: string;
  killSwitch: boolean;
  globalPause: boolean;
  maxConcurrency: number;
  activityLimits: unknown;
  commentTemplates: unknown;
  usernameSuffix: string;
  updatedAt: Date;
}): BotSettingsRecord {
  return {
    id: row.id,
    killSwitch: row.killSwitch,
    globalPause: row.globalPause,
    maxConcurrency: row.maxConcurrency,
    activityLimits: row.activityLimits,
    commentTemplates: row.commentTemplates,
    usernameSuffix: row.usernameSuffix,
    updatedAt: row.updatedAt,
  };
}

function mapBatch(row: {
  id: string;
  criteriaVersion: string;
  criteria: unknown;
  rankedAt: Date;
  previewSnapshot: unknown;
  eligibleCount: number;
  previewCount: number;
  selectedUserIds: string[];
  status: BotCandidateBatchRecord["status"];
  createdByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
}): BotCandidateBatchRecord {
  return {
    id: row.id,
    criteriaVersion: row.criteriaVersion,
    criteria: row.criteria,
    rankedAt: row.rankedAt,
    previewSnapshot: row.previewSnapshot,
    eligibleCount: row.eligibleCount,
    previewCount: row.previewCount,
    selectedUserIds: row.selectedUserIds,
    status: row.status,
    createdByAdminId: row.createdByAdminId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function eligibleCandidateWhere(): Prisma.UserWhereInput {
  return {
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    deletedAt: null,
    isSystemAccount: false,
    isAutomatedAccount: false,
  };
}

export class PrismaBotsRepository implements BotsRepository {
  constructor(private readonly database: PrismaClient) {}

  async countEligibleCandidates(): Promise<number> {
    return this.database.user.count({ where: eligibleCandidateWhere() });
  }

  /**
   * Fetch a generous pool ordered by presence estimate, then the service
   * re-ranks in memory for a stable presence_v1 ordering.
   */
  async listEligibleCandidates(limit: number): Promise<CandidateRow[]> {
    // Oversized pool so in-memory presence_v1 ranking (COALESCE lastSeen/created)
    // is not skewed by SQL NULLS FIRST on lastSeenAt alone.
    const pool = Math.min(Math.max(limit * 10, limit), 5_000);
    const rows = await this.database.user.findMany({
      where: eligibleCandidateWhere(),
      select: {
        id: true,
        username: true,
        country: true,
        createdAt: true,
        lastSeenAt: true,
        profilePhotoMediaId: true,
      },
      orderBy: [
        { lastSeenAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
      take: pool,
    });
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      country: row.country,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      hasProfilePhoto: row.profilePhotoMediaId != null,
    }));
  }

  async ensureSettings(): Promise<BotSettingsRecord> {
    const row = await this.database.botSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        killSwitch: true,
        globalPause: true,
        maxConcurrency: 3,
        activityLimits: defaultActivityLimits,
        commentTemplates: [],
        usernameSuffix: "_mx",
      },
      update: {},
    });
    return mapSettings(row);
  }

  async updateSettings(
    data: Partial<{
      killSwitch: boolean;
      globalPause: boolean;
      maxConcurrency: number;
      activityLimits: unknown;
      commentTemplates: unknown;
      usernameSuffix: string;
    }>,
  ): Promise<BotSettingsRecord> {
    await this.ensureSettings();
    const row = await this.database.botSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        ...(data.killSwitch !== undefined
          ? { killSwitch: data.killSwitch }
          : {}),
        ...(data.globalPause !== undefined
          ? { globalPause: data.globalPause }
          : {}),
        ...(data.maxConcurrency !== undefined
          ? { maxConcurrency: data.maxConcurrency }
          : {}),
        ...(data.activityLimits !== undefined
          ? { activityLimits: data.activityLimits as Prisma.InputJsonValue }
          : {}),
        ...(data.commentTemplates !== undefined
          ? {
              commentTemplates: data.commentTemplates as Prisma.InputJsonValue,
            }
          : {}),
        ...(data.usernameSuffix !== undefined
          ? { usernameSuffix: data.usernameSuffix }
          : {}),
      },
    });
    return mapSettings(row);
  }

  async createCandidateBatch(input: {
    id: string;
    criteriaVersion: string;
    criteria: unknown;
    rankedAt: Date;
    previewSnapshot: unknown;
    eligibleCount: number;
    previewCount: number;
    createdByAdminId: string;
  }): Promise<BotCandidateBatchRecord> {
    const row = await this.database.botCandidateBatch.create({
      data: {
        id: input.id,
        criteriaVersion: input.criteriaVersion,
        criteria: input.criteria as Prisma.InputJsonValue,
        rankedAt: input.rankedAt,
        previewSnapshot: input.previewSnapshot as Prisma.InputJsonValue,
        eligibleCount: input.eligibleCount,
        previewCount: input.previewCount,
        createdByAdminId: input.createdByAdminId,
        status: "PREVIEWED",
        selectedUserIds: [],
      },
    });
    return mapBatch(row);
  }

  async getCandidateBatch(id: string): Promise<BotCandidateBatchRecord | null> {
    const row = await this.database.botCandidateBatch.findUnique({
      where: { id },
    });
    return row ? mapBatch(row) : null;
  }

  async updateCandidateBatchSelection(input: {
    id: string;
    selectedUserIds: string[];
    status: BotCandidateBatchRecord["status"];
  }): Promise<BotCandidateBatchRecord> {
    const row = await this.database.botCandidateBatch.update({
      where: { id: input.id },
      data: {
        selectedUserIds: input.selectedUserIds,
        status: input.status,
      },
    });
    return mapBatch(row);
  }

  async updateCandidateBatchStatus(
    id: string,
    status: BotCandidateBatchRecord["status"],
  ): Promise<BotCandidateBatchRecord> {
    const row = await this.database.botCandidateBatch.update({
      where: { id },
      data: { status },
    });
    return mapBatch(row);
  }

  async listBotAccounts(input: {
    query?: string;
    status?: BotAccountStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: BotAccountListItem[]; total: number }> {
    const where: Prisma.BotAccountWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.query
        ? {
            user: {
              OR: [
                {
                  usernameNormalized: {
                    contains: input.query.trim().toLowerCase(),
                  },
                },
                {
                  displayName: {
                    contains: input.query.trim(),
                    mode: "insensitive",
                  },
                },
              ],
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.database.botAccount.count({ where }),
      this.database.botAccount.findMany({
        where,
        include: {
          user: {
            select: {
              username: true,
              displayName: true,
              profilePhotoMediaId: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit,
        skip: input.offset,
      }),
    ]);
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        username: row.user.username,
        displayName: row.user.displayName,
        status: row.status,
        sourceCandidateUserId: row.sourceCandidateUserId,
        candidateBatchId: row.candidateBatchId,
        createdAt: row.createdAt,
        profilePhotoMediaId: row.user.profilePhotoMediaId,
      })),
    };
  }

  async getBotAccount(id: string): Promise<BotAccountDetail | null> {
    const row = await this.database.botAccount.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            username: true,
            displayName: true,
            bio: true,
            emailVerifiedAt: true,
            isAutomatedAccount: true,
            profilePhotoMediaId: true,
          },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      username: row.user.username,
      displayName: row.user.displayName,
      bio: row.user.bio,
      status: row.status,
      sourceCandidateUserId: row.sourceCandidateUserId,
      candidateBatchId: row.candidateBatchId,
      permissions: row.permissions,
      provisionedByAdminId: row.provisionedByAdminId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      emailVerified: row.user.emailVerifiedAt != null,
      isAutomatedAccount: row.user.isAutomatedAccount,
      profilePhotoMediaId: row.user.profilePhotoMediaId,
    };
  }

  async updateBotAccountStatus(
    id: string,
    status: BotAccountStatus,
  ): Promise<BotAccountDetail> {
    await this.database.botAccount.update({
      where: { id },
      data: { status },
    });
    const detail = await this.getBotAccount(id);
    if (!detail) {
      throw new Error(`Bot account ${id} missing after status update`);
    }
    return detail;
  }

  async updateBotAccountPermissions(
    id: string,
    permissions: unknown,
  ): Promise<BotAccountDetail> {
    await this.database.botAccount.update({
      where: { id },
      data: { permissions: permissions as Prisma.InputJsonValue },
    });
    const detail = await this.getBotAccount(id);
    if (!detail) {
      throw new Error(`Bot account ${id} missing after permissions update`);
    }
    return detail;
  }

  async findProvisionSources(ids: string[]): Promise<ProvisionSourceRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.database.user.findMany({
      where: {
        id: { in: ids },
        ...eligibleCandidateWhere(),
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        ageRange: true,
        gender: true,
        country: true,
        profilePhotoMediaId: true,
      },
    });
    return rows;
  }

  async findExistingBotSourceIds(sourceIds: string[]): Promise<Set<string>> {
    if (sourceIds.length === 0) return new Set();
    const rows = await this.database.botAccount.findMany({
      where: { sourceCandidateUserId: { in: sourceIds } },
      select: { sourceCandidateUserId: true },
    });
    return new Set(
      rows
        .map((row) => row.sourceCandidateUserId)
        .filter((id): id is string => typeof id === "string"),
    );
  }

  async usernameTaken(usernameNormalized: string): Promise<boolean> {
    const existing = await this.database.user.findUnique({
      where: { usernameNormalized },
      select: { id: true },
    });
    return existing != null;
  }

  async createAutomatedBot(
    input: CreateAutomatedBotInput,
  ): Promise<CreatedBotRecord> {
    const existing = await this.database.botAccount.findFirst({
      where: { sourceCandidateUserId: input.sourceCandidateUserId },
      select: {
        id: true,
        userId: true,
        user: { select: { username: true } },
      },
    });
    if (existing) {
      return {
        botAccountId: existing.id,
        userId: existing.userId,
        username: existing.user.username,
        sourceCandidateUserId: input.sourceCandidateUserId,
        skipped: true,
        skipReason: "source_already_provisioned",
      };
    }

    try {
      await this.database.$transaction(async (tx) => {
        const raced = await tx.botAccount.findFirst({
          where: { sourceCandidateUserId: input.sourceCandidateUserId },
          select: { id: true },
        });
        if (raced) {
          throw new SourceAlreadyProvisionedError();
        }

        await tx.user.create({
          data: {
            id: input.userId,
            username: input.username,
            usernameNormalized: input.usernameNormalized,
            usernameChangedAt: new Date(),
            email: input.email,
            passwordHash: input.passwordHash,
            displayName: input.displayName,
            bio: input.bio,
            ageRange: input.ageRange as AgeRange,
            gender: input.gender as Gender,
            country: input.country,
            role: "USER",
            status: "ACTIVE",
            isSystemAccount: false,
            isAutomatedAccount: true,
            emailVerifiedAt: new Date(),
            marketingEmailOptOut: true,
          },
        });

        // Clone after the user row exists (media.ownerUserId FK). Never touch the source user.
        const profilePhotoMediaId = await cloneAuthorizedProfilePhoto(tx, {
          sourceMediaId: input.sourceProfilePhotoMediaId,
          botUserId: input.userId,
          uploadRoot: input.uploadRoot,
        });
        if (profilePhotoMediaId) {
          await tx.user.update({
            where: { id: input.userId },
            data: { profilePhotoMediaId },
          });
        }

        await tx.botAccount.create({
          data: {
            id: input.botAccountId,
            userId: input.userId,
            // Newly provisioned bots start ACTIVE; existing rows are never mutated here.
            status: "ACTIVE",
            sourceCandidateUserId: input.sourceCandidateUserId,
            candidateBatchId: input.candidateBatchId,
            permissions: input.permissions as Prisma.InputJsonValue,
            provisionedByAdminId: input.provisionedByAdminId,
          },
        });
      });
    } catch (error) {
      if (error instanceof SourceAlreadyProvisionedError) {
        const again = await this.database.botAccount.findFirst({
          where: { sourceCandidateUserId: input.sourceCandidateUserId },
          select: {
            id: true,
            userId: true,
            user: { select: { username: true } },
          },
        });
        if (again) {
          return {
            botAccountId: again.id,
            userId: again.userId,
            username: again.user.username,
            sourceCandidateUserId: input.sourceCandidateUserId,
            skipped: true,
            skipReason: "source_already_provisioned",
          };
        }
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = error.meta?.target;
        const fields = Array.isArray(target)
          ? target.map(String)
          : typeof target === "string"
            ? [target]
            : [];
        if (
          fields.some(
            (field) =>
              field.includes("username") || field.includes("usernameNormalized"),
          )
        ) {
          return {
            botAccountId: input.botAccountId,
            userId: input.userId,
            username: input.username,
            sourceCandidateUserId: input.sourceCandidateUserId,
            skipped: true,
            skipReason: "username_collision",
          };
        }
        const again = await this.database.botAccount.findFirst({
          where: { sourceCandidateUserId: input.sourceCandidateUserId },
          select: {
            id: true,
            userId: true,
            user: { select: { username: true } },
          },
        });
        if (again) {
          return {
            botAccountId: again.id,
            userId: again.userId,
            username: again.user.username,
            sourceCandidateUserId: input.sourceCandidateUserId,
            skipped: true,
            skipReason: "source_already_provisioned",
          };
        }
      }
      throw error;
    }

    return {
      botAccountId: input.botAccountId,
      userId: input.userId,
      username: input.username,
      sourceCandidateUserId: input.sourceCandidateUserId,
      skipped: false,
    };
  }

  async listActivityJobs(input: {
    limit: number;
    offset: number;
    botAccountId?: string;
    activityType?: string;
    status?: string;
    createdFrom?: Date;
    createdTo?: Date;
  }): Promise<{ items: BotJobListItem[]; total: number }> {
    const where: Prisma.BotActivityJobWhereInput = {
      ...(input.botAccountId
        ? { botAccountId: input.botAccountId }
        : {}),
      ...(input.activityType
        ? { activityType: input.activityType as never }
        : {}),
      ...(input.status ? { status: input.status as never } : {}),
      ...(input.createdFrom || input.createdTo
        ? {
            createdAt: {
              ...(input.createdFrom ? { gte: input.createdFrom } : {}),
              ...(input.createdTo ? { lte: input.createdTo } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.database.botActivityJob.count({ where }),
      this.database.botActivityJob.findMany({
        where,
        include: {
          botAccount: { include: { user: { select: { username: true } } } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit,
        skip: input.offset,
      }),
    ]);
    return {
      total,
      items: rows.map((row) => this.mapJob(row)),
    };
  }

  async getActivityJob(id: string): Promise<BotJobListItem | null> {
    const row = await this.database.botActivityJob.findUnique({
      where: { id },
      include: {
        botAccount: { include: { user: { select: { username: true } } } },
      },
    });
    return row ? this.mapJob(row) : null;
  }

  async cancelPendingJob(id: string): Promise<BotJobListItem | null> {
    const existing = await this.database.botActivityJob.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing || existing.status !== BotActivityJobStatus.PENDING) {
      return null;
    }
    const row = await this.database.botActivityJob.update({
      where: { id },
      data: {
        status: BotActivityJobStatus.CANCELLED,
        processedAt: new Date(),
        lastError: "cancelled_by_admin",
      },
      include: {
        botAccount: { include: { user: { select: { username: true } } } },
      },
    });
    return this.mapJob(row);
  }

  async retryFailedJob(id: string): Promise<BotJobListItem | null> {
    const existing = await this.database.botActivityJob.findUnique({
      where: { id },
      select: { status: true },
    });
    if (
      !existing ||
      (existing.status !== BotActivityJobStatus.FAILED &&
        existing.status !== BotActivityJobStatus.SKIPPED)
    ) {
      return null;
    }
    const row = await this.database.botActivityJob.update({
      where: { id },
      data: {
        status: BotActivityJobStatus.PENDING,
        availableAt: new Date(),
        processedAt: null,
        lastError: null,
        attempts: 0,
      },
      include: {
        botAccount: { include: { user: { select: { username: true } } } },
      },
    });
    return this.mapJob(row);
  }

  async cancelPendingJobsForBot(botAccountId: string): Promise<number> {
    const result = await this.database.botActivityJob.updateMany({
      where: {
        botAccountId,
        status: BotActivityJobStatus.PENDING,
      },
      data: {
        status: BotActivityJobStatus.CANCELLED,
        processedAt: new Date(),
        lastError: "bot_paused_or_disabled",
      },
    });
    return result.count;
  }

  private mapJob(row: {
    id: string;
    botAccountId: string;
    activityType: string;
    targetType: string;
    targetId: string;
    status: string;
    attempts: number;
    lastError: string | null;
    metadata: unknown;
    createdAt: Date;
    processedAt: Date | null;
    botAccount: { user: { username: string } };
  }): BotJobListItem {
    return {
      id: row.id,
      botAccountId: row.botAccountId,
      botUsername: row.botAccount.user.username,
      activityType: row.activityType,
      targetType: row.targetType,
      targetId: row.targetId,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      metadata: row.metadata,
      createdAt: row.createdAt,
      processedAt: row.processedAt,
    };
  }

  async listBotAuditLogs(input: {
    limit: number;
    offset: number;
  }): Promise<{ items: BotAuditListItem[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
      action: { startsWith: "bots." },
    };
    const [total, rows] = await Promise.all([
      this.database.auditLog.count({ where }),
      this.database.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit,
        skip: input.offset,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          metadata: true,
          actorUserId: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: row.metadata,
        actorUserId: row.actorUserId,
        createdAt: row.createdAt,
      })),
    };
  }

  async getMetrics(workerEnabled: boolean): Promise<BotMetrics> {
    const settings = await this.ensureSettings();
    const [
      totalBots,
      activeBots,
      pausedBots,
      disabledBots,
      jobsProcessed,
      jobsFailed,
      jobsPending,
      jobsProcessing,
      jobsCancelled,
      jobsSkipped,
    ] = await Promise.all([
      this.database.botAccount.count(),
      this.database.botAccount.count({
        where: { status: BotAccountStatus.ACTIVE },
      }),
      this.database.botAccount.count({
        where: { status: BotAccountStatus.PAUSED },
      }),
      this.database.botAccount.count({
        where: { status: BotAccountStatus.DISABLED },
      }),
      this.database.botActivityJob.count({
        where: { status: BotActivityJobStatus.PROCESSED },
      }),
      this.database.botActivityJob.count({
        where: { status: BotActivityJobStatus.FAILED },
      }),
      this.database.botActivityJob.count({
        where: { status: BotActivityJobStatus.PENDING },
      }),
      this.database.botActivityJob.count({
        where: { status: BotActivityJobStatus.PROCESSING },
      }),
      this.database.botActivityJob.count({
        where: { status: BotActivityJobStatus.CANCELLED },
      }),
      this.database.botActivityJob.count({
        where: { status: BotActivityJobStatus.SKIPPED },
      }),
    ]);
    const limits =
      settings.activityLimits &&
      typeof settings.activityLimits === "object" &&
      !Array.isArray(settings.activityLimits)
        ? (settings.activityLimits as Record<string, unknown>)
        : {};
    return {
      totalBots,
      activeBots,
      pausedBots,
      disabledBots,
      jobsProcessed,
      jobsFailed,
      jobsPending,
      jobsProcessing,
      jobsCancelled,
      jobsSkipped,
      killSwitch: settings.killSwitch,
      globalPause: settings.globalPause,
      workerEnabled,
      viewsEnabled: limits.viewsEnabled === true,
    };
  }

  /**
   * Atomically move a batch from SELECTION_LOCKED → PROVISIONING.
   * Returns false if another live provision already claimed it.
   */
  async claimBatchForProvisioning(batchId: string): Promise<boolean> {
    const updated = await this.database.botCandidateBatch.updateMany({
      where: { id: batchId, status: "SELECTION_LOCKED" },
      data: { status: "PROVISIONING" },
    });
    return updated.count === 1;
  }

  async writeAudit(input: {
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.database.auditLog.create({
      data: {
        actorType: AuditActorType.ADMIN,
        actorUserId: input.actorUserId,
        action: input.action,
        resourceType: input.resourceType,
        ...(input.resourceId !== undefined
          ? { resourceId: input.resourceId }
          : {}),
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}

/**
 * Reuse an authorized PUBLIC profile photo without transferring ownership of the
 * source MediaAsset (profilePhotoMediaId is unique per user). Copies public
 * storage bytes into a new bot-owned asset. Skips private / inaccessible assets.
 */
async function cloneAuthorizedProfilePhoto(
  tx: Prisma.TransactionClient,
  input: {
    sourceMediaId: string | null;
    botUserId: string;
    uploadRoot: string;
  },
): Promise<string | null> {
  if (!input.sourceMediaId) return null;

  const source = await tx.mediaAsset.findFirst({
    where: {
      id: input.sourceMediaId,
      kind: MediaKind.PROFILE_PHOTO,
      visibility: MediaVisibility.PUBLIC,
      deletedAt: null,
      storageKey: { startsWith: "public/" },
    },
  });
  if (!source) return null;

  const newId = randomUUID();
  const extension = path.extname(source.storageKey) || ".webp";
  // Match media-service PROFILE_PHOTO layout: public/profiles/{id}.webp
  const newStorageKey = `public/profiles/${newId}${extension}`;
  const sourcePath = path.resolve(input.uploadRoot, source.storageKey);
  const destPath = path.resolve(input.uploadRoot, newStorageKey);

  try {
    await mkdir(path.dirname(destPath), { recursive: true });
    await copyFile(sourcePath, destPath);
  } catch {
    // Source bytes missing or unreadable — provision without a photo.
    return null;
  }

  await tx.mediaAsset.create({
    data: {
      id: newId,
      ownerUserId: input.botUserId,
      kind: MediaKind.PROFILE_PHOTO,
      visibility: MediaVisibility.PUBLIC,
      storageKey: newStorageKey,
      mimeType: source.mimeType,
      byteSize: source.byteSize,
      width: source.width,
      height: source.height,
      blurHash: source.blurHash,
      checksumSha256: source.checksumSha256,
    },
  });
  return newId;
}

class SourceAlreadyProvisionedError extends Error {
  constructor() {
    super("source_already_provisioned");
    this.name = "SourceAlreadyProvisionedError";
  }
}
