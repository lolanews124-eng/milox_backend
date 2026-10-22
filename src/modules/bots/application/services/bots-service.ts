import { randomBytes, randomUUID } from "node:crypto";

import { AppError } from "../../../../shared/errors/app-error.js";
import type { AppConfig } from "../../../../config/env.js";
import type { CryptoService } from "../../../auth/application/services/crypto-service.js";
import {
  assertBotsMutationsAllowed,
  assertNotProductionDatabaseHost,
} from "../bots-env-guard.js";
import {
  BOT_PROFILE_DEFAULTS,
  DEFAULT_BOT_PERMISSIONS,
  buildBotDisplayNameFromSource,
  buildBotUsernameCandidate,
  normalizeReusableBio,
} from "../bot-username.js";
import { BotActivityPlanner } from "../bot-activity-planner.js";
import {
  BOT_DAILY_LIMIT_TIMEZONE,
  readBotPermissions,
} from "../bot-daily-limits.js";
import { botProfilePhotoUrl } from "../bot-media-url.js";
import {
  buildSchedulePreview,
  mergeSchedulingConfig,
  readSchedulingFromActivityLimits,
} from "../bot-scheduling.js";
import { resolveBotsTargetPolicy } from "../bot-target-policy.js";
import {
  BOT_CANDIDATE_CRITERIA_VERSION,
  rankCandidatesByInactivity,
} from "../inactivity.js";
import type {
  BotCandidateBatchRecord,
  BotsRepository,
  CreatedBotRecord,
  RankedCandidatePreview,
} from "../ports/bots-repository.js";
import type { PrismaClient } from "@prisma/client";

const MAX_PREVIEW = 1_000;
const MAX_SELECTION = 200;
const MAX_USERNAME_ATTEMPTS = 24;
const PROVISION_CONFIRM_PHRASE = "PROVISION";

export class BotsService {
  constructor(
    private readonly repository: BotsRepository,
    private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly database?: PrismaClient,
  ) {}

  async previewUpcomingJobs(limit?: number) {
    if (!this.database) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Job preview requires database access",
        500,
      );
    }
    const targetPolicy = resolveBotsTargetPolicy(this.config);
    const planner = new BotActivityPlanner(this.database, { targetPolicy });
    const previewLimit = limit ?? 20;
    const [preview, targets] = await Promise.all([
      planner.previewUpcoming(previewLimit),
      planner.inspectTargetCandidates(previewLimit),
    ]);
    const settings = await this.repository.ensureSettings();
    const scheduling = readSchedulingFromActivityLimits(settings.activityLimits);
    const schedulePreview = buildSchedulePreview({
      scheduling,
      activeBots: preview.activeBots,
    });
    const metrics = await this.repository.getMetrics(
      this.config.BOTS_WORKER_ENABLED,
    );
    const plannerIntervalMs =
      preview.activityLimits &&
      typeof preview.activityLimits.plannerIntervalMs === "number"
        ? preview.activityLimits.plannerIntervalMs
        : 60_000;
    const blockReasons: string[] = [];
    if (!this.config.BOTS_WORKER_ENABLED) {
      blockReasons.push("BOTS_WORKER_ENABLED=false");
    }
    if (preview.killSwitch) blockReasons.push("kill_switch");
    if (preview.globalPause) blockReasons.push("global_pause");
    if (targetPolicy === "disabled") blockReasons.push("target_policy_disabled");
    if (scheduling.enabled && !schedulePreview.currentWindowId) {
      blockReasons.push("outside_schedule_window");
    }
    if (
      targetPolicy !== "disabled" &&
      preview.eligiblePostCount === 0 &&
      preview.eligibleUserCount === 0
    ) {
      blockReasons.push(
        targetPolicy === "test_fixtures_only"
          ? "no_fixture_targets"
          : "no_eligible_targets",
      );
    } else if (targetPolicy !== "disabled" && preview.eligiblePostCount === 0) {
      blockReasons.push(
        targetPolicy === "test_fixtures_only"
          ? "no_fixture_posts"
          : "no_eligible_posts",
      );
    }
    if (preview.templatesConfigured === 0) {
      blockReasons.push("no_comment_templates");
    }
    const policyHint =
      targetPolicy === "test_fixtures_only"
        ? "Under test_fixtures_only, posts/users must contain [[MILLOX_BOTS_TEST_FIXTURE]]."
        : targetPolicy === "fresh_public"
          ? "Under fresh_public, only recent eligible public posts / active users are targeted."
          : "Set BOTS_TARGET_POLICY=fresh_public (local) or test_fixtures_only (E2E) to enable targeting.";
    return {
      dryRun: true as const,
      /** Preview never writes jobs — real enqueue is BotActivityWorker → planTick. */
      enqueuesJobs: false as const,
      workerEnabled: this.config.BOTS_WORKER_ENABLED,
      targetPolicy,
      ...preview,
      targets,
      schedule: schedulePreview,
      plannerIntervalMs,
      pipeline: {
        preview: {
          writes: false,
          endpoint: "POST /admin/bots/jobs/preview",
          note: "Read-only. Lists bots, schedule, blockers, and ranked candidates.",
        },
        enqueue: {
          writes: true,
          mechanism: "BotActivityWorker → planTick",
          uiAction: null,
          requires: [
            "BOTS_WORKER_ENABLED=true",
            "killSwitch=false",
            "globalPause=false",
            "targetPolicy!=disabled",
            "inside schedule window when scheduling.enabled",
          ],
          note: "There is no dashboard button that enqueues. PENDING jobs are created only by the API worker planner tick.",
        },
        execute: {
          writes: true,
          mechanism: "BotActivityWorker claim → PostService/CommentService/FollowService",
          note: "Worker claims PENDING jobs and runs the same domain services as normal app actions. Inspect Activity Jobs for outcomes.",
        },
      },
      jobSummary: {
        pending: metrics.jobsPending,
        processing: metrics.jobsProcessing,
        processed: metrics.jobsProcessed,
        skipped: metrics.jobsSkipped,
        failed: metrics.jobsFailed,
        cancelled: metrics.jobsCancelled,
      },
      blockReasons,
      message:
        blockReasons.length > 0
          ? `Preview only (never enqueues). Blockers: ${blockReasons.join(", ")}. Real jobs are created by the worker planner tick when BOTS_WORKER_ENABLED=true and gates pass. ${policyHint} Zero templates only blocks COMMENT_POST.`
          : "Preview only (never enqueues). Worker planner ticks create PENDING jobs when gates pass; this endpoint does not.",
    };
  }

  async getMetrics() {
    return this.repository.getMetrics(this.config.BOTS_WORKER_ENABLED);
  }

  async getSettings() {
    const settings = await this.repository.ensureSettings();
    return this.serializeSettings(settings);
  }

  async updateSettings(
    actorUserId: string,
    patch: {
      killSwitch?: boolean;
      globalPause?: boolean;
      maxConcurrency?: number;
      activityLimits?: Record<string, unknown>;
      commentTemplates?: string[];
      usernameSuffix?: string;
    },
  ) {
    this.guardMutations("update_settings");
    if (patch.activityLimits?.viewsEnabled === true) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Automated views remain disabled until synthetic views are excluded from public view counts and trending",
        400,
      );
    }
    const current = await this.repository.ensureSettings();
    const currentLimits =
      current.activityLimits &&
      typeof current.activityLimits === "object" &&
      !Array.isArray(current.activityLimits)
        ? (current.activityLimits as Record<string, unknown>)
        : {};
    const nextLimits = patch.activityLimits
      ? {
          ...currentLimits,
          ...patch.activityLimits,
          viewsEnabled: false,
          scheduling: mergeSchedulingConfig({
            ...readSchedulingFromActivityLimits(currentLimits),
            ...(patch.activityLimits.scheduling ?? {}),
            windows: {
              ...readSchedulingFromActivityLimits(currentLimits).windows,
              ...((patch.activityLimits.scheduling as { windows?: object } | undefined)
                ?.windows ?? {}),
            },
          }),
        }
      : undefined;
    const settings = await this.repository.updateSettings({
      ...patch,
      ...(nextLimits !== undefined ? { activityLimits: nextLimits } : {}),
    });
    await this.repository.writeAudit({
      actorUserId,
      action: "bots.settings.update",
      resourceType: "bot_settings",
      resourceId: "default",
      metadata: {
        keys: Object.keys(patch),
        killSwitch: settings.killSwitch,
        globalPause: settings.globalPause,
      },
    });
    return this.serializeSettings(settings);
  }

  async previewCandidates(input: {
    limit?: number;
    persist?: boolean;
    actorUserId: string;
  }): Promise<{
    dryRun: true;
    criteriaVersion: typeof BOT_CANDIDATE_CRITERIA_VERSION;
    rankingNote: string;
    eligibleCount: number;
    previewCount: number;
    candidates: RankedCandidatePreview[];
    batchId: string | null;
  }> {
    const limit = Math.min(
      Math.max(input.limit ?? MAX_PREVIEW, 1),
      MAX_PREVIEW,
    );
    const [eligibleCount, rows] = await Promise.all([
      this.repository.countEligibleCandidates(),
      this.repository.listEligibleCandidates(limit),
    ]);
    const ranked = rankCandidatesByInactivity(rows).slice(0, limit);
    const candidates: RankedCandidatePreview[] = ranked.map((row) => ({
      id: row.id,
      username: row.username,
      country: row.country,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      inactiveAt: row.inactiveAt.toISOString(),
      inactivitySource: row.inactivitySource,
      hasProfilePhoto: row.hasProfilePhoto,
    }));

    let batchId: string | null = null;
    if (input.persist) {
      this.guardMutations("persist_candidate_batch");
      const batch = await this.repository.createCandidateBatch({
        id: randomUUID(),
        criteriaVersion: BOT_CANDIDATE_CRITERIA_VERSION,
        criteria: {
          ranking: "lastSeenAt_else_createdAt",
          estimate: true,
          excluded: [
            "deleted",
            "suspended",
            "banned",
            "pending_deletion",
            "system",
            "staff",
            "automated",
          ],
          limit,
        },
        rankedAt: new Date(),
        previewSnapshot: candidates.map((c) => ({
          id: c.id,
          inactiveAt: c.inactiveAt,
          inactivitySource: c.inactivitySource,
        })),
        eligibleCount,
        previewCount: candidates.length,
        createdByAdminId: input.actorUserId,
      });
      batchId = batch.id;
      await this.repository.writeAudit({
        actorUserId: input.actorUserId,
        action: "bots.candidates.preview_persisted",
        resourceType: "bot_candidate_batch",
        resourceId: batch.id,
        metadata: {
          eligibleCount,
          previewCount: candidates.length,
          criteriaVersion: BOT_CANDIDATE_CRITERIA_VERSION,
        },
      });
    }

    return {
      dryRun: true,
      criteriaVersion: BOT_CANDIDATE_CRITERIA_VERSION,
      rankingNote:
        "Estimate only: inactiveAt = lastSeenAt ?? createdAt. lastSeenAt is chat presence, not a full last-active clock.",
      eligibleCount,
      previewCount: candidates.length,
      candidates,
      batchId,
    };
  }

  async getCandidateBatch(id: string) {
    const batch = await this.requireBatch(id);
    return this.serializeBatch(batch);
  }

  async lockSelection(
    actorUserId: string,
    batchId: string,
    selectedUserIds: string[],
  ) {
    this.guardMutations("lock_candidate_selection");
    const batch = await this.requireBatch(batchId);
    if (
      batch.status !== "PREVIEWED" &&
      batch.status !== "SELECTION_LOCKED"
    ) {
      throw new AppError(
        "CONFLICT",
        `Batch status ${batch.status} does not allow selection changes`,
        409,
      );
    }
    if (selectedUserIds.length > MAX_SELECTION) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Select at most ${MAX_SELECTION} candidates`,
        400,
      );
    }
    const previewIds = new Set(
      Array.isArray(batch.previewSnapshot)
        ? (batch.previewSnapshot as Array<{ id?: string }>)
            .map((row) => row.id)
            .filter((id): id is string => typeof id === "string")
        : [],
    );
    for (const id of selectedUserIds) {
      if (!previewIds.has(id)) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Selected user is not in the preview snapshot",
          400,
        );
      }
    }
    const unique = [...new Set(selectedUserIds)];
    const updated = await this.repository.updateCandidateBatchSelection({
      id: batchId,
      selectedUserIds: unique,
      status: "SELECTION_LOCKED",
    });
    await this.repository.writeAudit({
      actorUserId,
      action: "bots.candidates.selection_locked",
      resourceType: "bot_candidate_batch",
      resourceId: batchId,
      metadata: { selectedCount: unique.length },
    });
    return this.serializeBatch(updated);
  }

  /**
   * Creates NEW automated users inspired by selected candidates.
   * Never converts or overwrites human accounts. Passwords are never returned.
   */
  async provisionPreview(
    actorUserId: string,
    batchId: string,
    input: {
      dryRun: boolean;
      limit?: number;
      confirm?: boolean;
      confirmPhrase?: string;
    },
  ) {
    const batch = await this.requireBatch(batchId);
    if (
      batch.status !== "SELECTION_LOCKED" &&
      batch.status !== "PROVISIONING" &&
      batch.status !== "DONE"
    ) {
      throw new AppError(
        "CONFLICT",
        "Lock a selection of up to 200 candidates before provisioning",
        409,
      );
    }
    if (batch.selectedUserIds.length === 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Batch has no selected candidates",
        400,
      );
    }

    const settings = await this.repository.ensureSettings();
    const limit = Math.min(
      Math.max(input.limit ?? 5, 1),
      Math.min(MAX_SELECTION, batch.selectedUserIds.length),
    );
    const plannedIds = batch.selectedUserIds.slice(0, limit);
    const [sources, already] = await Promise.all([
      this.repository.findProvisionSources(plannedIds),
      this.repository.findExistingBotSourceIds(plannedIds),
    ]);
    const sourceById = new Map(sources.map((row) => [row.id, row]));

    const plan = [];
    for (const sourceId of plannedIds) {
      if (already.has(sourceId)) {
        plan.push({
          sourceCandidateUserId: sourceId,
          action: "skip" as const,
          reason: "source_already_provisioned",
          proposedUsername: null as string | null,
        });
        continue;
      }
      const source = sourceById.get(sourceId);
      if (!source) {
        plan.push({
          sourceCandidateUserId: sourceId,
          action: "skip" as const,
          reason: "source_ineligible_or_missing",
          proposedUsername: null,
        });
        continue;
      }
      const proposedUsername = await this.allocateUsername(
        source.username,
        settings.usernameSuffix,
      );
      plan.push({
        sourceCandidateUserId: sourceId,
        action: "create" as const,
        reason: null as string | null,
        proposedUsername,
      });
    }

    const createCount = plan.filter((row) => row.action === "create").length;
    const isDryRun =
      input.dryRun ||
      !input.confirm ||
      input.confirmPhrase !== PROVISION_CONFIRM_PHRASE;

    if (isDryRun) {
      await this.repository.writeAudit({
        actorUserId,
        action: "bots.provision.dry_run",
        resourceType: "bot_candidate_batch",
        resourceId: batchId,
        metadata: {
          plannedCount: plannedIds.length,
          createCount,
          skipCount: plannedIds.length - createCount,
          dryRun: true,
        },
      });
      return {
        dryRun: true as const,
        created: false as const,
        batchId,
        plannedCount: plannedIds.length,
        createCount,
        plan,
        message:
          'Dry-run only. Live create requires dryRun=false, confirm=true, and confirmPhrase="PROVISION". Credentials are never returned.',
        confirmPhraseRequired: PROVISION_CONFIRM_PHRASE,
      };
    }

    this.guardMutations("provision_bots");
    if (this.config.MILOX_ENV === "production") {
      throw new AppError(
        "BOTS_ENV_BLOCKED",
        "Production provisioning is disabled until explicitly authorized",
        403,
      );
    }

    const claimed = await this.repository.claimBatchForProvisioning(batchId);
    if (!claimed) {
      throw new AppError(
        "CONFLICT",
        "This batch is already being provisioned by another request",
        409,
      );
    }

    const created = [];
    const skipped = [];
    for (const row of plan) {
      if (row.action !== "create" || !row.proposedUsername) {
        skipped.push({
          sourceCandidateUserId: row.sourceCandidateUserId,
          reason: row.reason ?? "skipped",
        });
        continue;
      }
      const source = sourceById.get(row.sourceCandidateUserId);
      let result: CreatedBotRecord | null = null;
      for (
        let collisionAttempt = 0;
        collisionAttempt < MAX_USERNAME_ATTEMPTS;
        collisionAttempt += 1
      ) {
        const username =
          collisionAttempt === 0
            ? row.proposedUsername
            : await this.allocateUsername(
                source?.username ?? row.proposedUsername,
                settings.usernameSuffix,
              );
        const passwordHash = await this.crypto.hashPassword(
          randomBytes(32).toString("base64url"),
        );
        const userId = this.crypto.createId();
        const botAccountId = this.crypto.createId();
        result = await this.repository.createAutomatedBot({
          userId,
          botAccountId,
          username,
          usernameNormalized: username.toLowerCase(),
          email: `bot.${userId.replace(/-/g, "")}@automated.milox.local`,
          passwordHash,
          displayName: buildBotDisplayNameFromSource(
            source?.displayName,
            source?.username ?? username,
          ),
          bio: normalizeReusableBio(source?.bio),
          ageRange: source?.ageRange ?? BOT_PROFILE_DEFAULTS.ageRange,
          gender: source?.gender ?? BOT_PROFILE_DEFAULTS.gender,
          country: source?.country ?? BOT_PROFILE_DEFAULTS.country,
          sourceProfilePhotoMediaId: source?.profilePhotoMediaId ?? null,
          uploadRoot: this.config.UPLOAD_ROOT,
          sourceCandidateUserId: row.sourceCandidateUserId,
          candidateBatchId: batchId,
          provisionedByAdminId: actorUserId,
          permissions: DEFAULT_BOT_PERMISSIONS,
        });
        if (!result.skipped || result.skipReason !== "username_collision") {
          break;
        }
      }
      if (!result) {
        skipped.push({
          sourceCandidateUserId: row.sourceCandidateUserId,
          reason: "username_collision",
        });
      } else if (result.skipped) {
        skipped.push({
          sourceCandidateUserId: row.sourceCandidateUserId,
          reason: result.skipReason ?? "skipped",
        });
      } else {
        created.push({
          botAccountId: result.botAccountId,
          userId: result.userId,
          username: result.username,
          sourceCandidateUserId: result.sourceCandidateUserId,
        });
      }
    }

    const remaining = await this.repository.findExistingBotSourceIds(
      batch.selectedUserIds,
    );
    const allDone = batch.selectedUserIds.every((id) => remaining.has(id));
    await this.repository.updateCandidateBatchStatus(
      batchId,
      allDone ? "DONE" : "SELECTION_LOCKED",
    );

    await this.repository.writeAudit({
      actorUserId,
      action: "bots.provision.completed",
      resourceType: "bot_candidate_batch",
      resourceId: batchId,
      metadata: {
        createdCount: created.length,
        skippedCount: skipped.length,
        limit,
        batchStatus: allDone ? "DONE" : "SELECTION_LOCKED",
      },
    });

    const createdCount = created.length;
    return {
      dryRun: false as const,
      /** True only when at least one new bot row was written. */
      created: createdCount > 0,
      batchId,
      createdCount,
      skippedCount: skipped.length,
      createdAccounts: created,
      skipped,
      message:
        createdCount > 0
          ? "Automated accounts created. Display name, bio, and authorized public profile photo are preserved from the source when available. Usernames use the smallest uniqueness change. Accounts start ACTIVE (activity still gated by kill switch, global pause, and worker)."
          : "No new bots were created — every selected candidate was skipped (already provisioned or ineligible).",
    };
  }

  async listBots(input: {
    query?: string;
    status?: "ACTIVE" | "PAUSED" | "DISABLED";
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const result = await this.repository.listBotAccounts({
      ...(input.query !== undefined ? { query: input.query } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      limit,
      offset,
    });
    return {
      total: result.total,
      limit,
      offset,
      items: result.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        profilePhotoUrl: botProfilePhotoUrl(
          item.profilePhotoMediaId,
          this.config,
        ),
        identityNote: "Automated account — not a converted human profile",
      })),
    };
  }

  async getBot(botId: string) {
    const bot = await this.repository.getBotAccount(botId);
    if (!bot) {
      throw new AppError("NOT_FOUND", "Bot account not found", 404);
    }
    return this.serializeBotDetail(bot);
  }

  async updateBot(
    actorUserId: string,
    botId: string,
    patch: {
      status?: "ACTIVE" | "PAUSED" | "DISABLED";
      permissions?: {
        likesEnabled?: boolean;
        commentsEnabled?: boolean;
        followsEnabled?: boolean;
        viewsEnabled?: false;
        maxLikesPerDay?: number;
        maxCommentsPerDay?: number;
        maxFollowsPerDay?: number;
      };
    },
  ) {
    this.guardMutations("update_bot");
    const existing = await this.repository.getBotAccount(botId);
    if (!existing) {
      throw new AppError("NOT_FOUND", "Bot account not found", 404);
    }

    let cancelledPending = 0;
    let updated = existing;

    if (patch.permissions) {
      const merged = {
        ...readBotPermissions(existing.permissions),
        ...patch.permissions,
        viewsEnabled: false as const,
      };
      updated = await this.repository.updateBotAccountPermissions(
        botId,
        merged,
      );
      await this.repository.writeAudit({
        actorUserId,
        action: "bots.account.permissions_updated",
        resourceType: "bot_account",
        resourceId: botId,
        metadata: {
          maxLikesPerDay: merged.maxLikesPerDay,
          maxCommentsPerDay: merged.maxCommentsPerDay,
          maxFollowsPerDay: merged.maxFollowsPerDay,
          dailyLimitTimezone: BOT_DAILY_LIMIT_TIMEZONE,
        },
      });
    }

    if (patch.status !== undefined) {
      updated = await this.repository.updateBotAccountStatus(
        botId,
        patch.status,
      );
      if (patch.status === "PAUSED" || patch.status === "DISABLED") {
        cancelledPending =
          await this.repository.cancelPendingJobsForBot(botId);
      }
      await this.repository.writeAudit({
        actorUserId,
        action: "bots.account.status_changed",
        resourceType: "bot_account",
        resourceId: botId,
        metadata: {
          from: existing.status,
          to: patch.status,
          cancelledPendingJobs: cancelledPending,
        },
      });
    }

    return {
      ...this.serializeBotDetail(updated),
      cancelledPendingJobs: cancelledPending,
    };
  }

  /** @deprecated Prefer updateBot — kept for call sites during transition. */
  async updateBotStatus(
    actorUserId: string,
    botId: string,
    status: "ACTIVE" | "PAUSED" | "DISABLED",
  ) {
    return this.updateBot(actorUserId, botId, { status });
  }

  private serializeBotDetail(bot: {
    id: string;
    userId: string;
    username: string;
    displayName: string | null;
    bio: string | null;
    status: "ACTIVE" | "PAUSED" | "DISABLED";
    sourceCandidateUserId: string | null;
    candidateBatchId: string | null;
    permissions: unknown;
    provisionedByAdminId: string | null;
    createdAt: Date;
    updatedAt: Date;
    emailVerified: boolean;
    isAutomatedAccount: boolean;
    profilePhotoMediaId: string | null;
  }) {
    const resolvedPermissions = readBotPermissions(bot.permissions);
    return {
      ...bot,
      permissions: bot.permissions,
      resolvedPermissions,
      profilePhotoUrl: botProfilePhotoUrl(bot.profilePhotoMediaId, this.config),
      dailyLimitTimezone: BOT_DAILY_LIMIT_TIMEZONE,
      dailyLimitNote:
        "Missing permission keys use documented defaults (not unlimited). Day boundary is UTC.",
      createdAt: bot.createdAt.toISOString(),
      updatedAt: bot.updatedAt.toISOString(),
      identityNote: "Automated account — not a converted human profile",
    };
  }

  async listJobs(input: {
    limit?: number;
    offset?: number;
    botAccountId?: string;
    activityType?: string;
    status?: string;
    createdFrom?: string;
    createdTo?: string;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const result = await this.repository.listActivityJobs({
      limit,
      offset,
      ...(input.botAccountId !== undefined
        ? { botAccountId: input.botAccountId }
        : {}),
      ...(input.activityType !== undefined
        ? { activityType: input.activityType }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.createdFrom
        ? { createdFrom: new Date(input.createdFrom) }
        : {}),
      ...(input.createdTo ? { createdTo: new Date(input.createdTo) } : {}),
    });
    return {
      total: result.total,
      items: result.items.map((item) => this.serializeJob(item)),
    };
  }

  async cancelJob(actorUserId: string, jobId: string) {
    this.guardMutations("cancel_job");
    const cancelled = await this.repository.cancelPendingJob(jobId);
    if (!cancelled) {
      throw new AppError(
        "CONFLICT",
        "Only PENDING jobs can be cancelled",
        409,
      );
    }
    await this.repository.writeAudit({
      actorUserId,
      action: "bots.jobs.cancelled",
      resourceType: "bot_activity_job",
      resourceId: jobId,
      metadata: {
        activityType: cancelled.activityType,
        botAccountId: cancelled.botAccountId,
      },
    });
    return this.serializeJob(cancelled);
  }

  async retryJob(actorUserId: string, jobId: string) {
    this.guardMutations("retry_job");
    const existing = await this.repository.getActivityJob(jobId);
    if (!existing) {
      throw new AppError("NOT_FOUND", "Job not found", 404);
    }
    if (existing.status === "PROCESSED") {
      throw new AppError(
        "CONFLICT",
        "Succeeded jobs cannot be retried",
        409,
      );
    }
    const retried = await this.repository.retryFailedJob(jobId);
    if (!retried) {
      throw new AppError(
        "CONFLICT",
        "Only FAILED or SKIPPED jobs can be retried",
        409,
      );
    }
    await this.repository.writeAudit({
      actorUserId,
      action: "bots.jobs.retried",
      resourceType: "bot_activity_job",
      resourceId: jobId,
      metadata: {
        previousStatus: existing.status,
        activityType: retried.activityType,
      },
    });
    return this.serializeJob(retried);
  }

  private serializeJob(item: {
    id: string;
    botAccountId: string;
    botUsername: string;
    activityType: string;
    targetType: string;
    targetId: string;
    status: string;
    attempts: number;
    lastError: string | null;
    metadata: unknown;
    createdAt: Date;
    processedAt: Date | null;
  }) {
    return {
      ...item,
      createdAt: item.createdAt.toISOString(),
      processedAt: item.processedAt?.toISOString() ?? null,
    };
  }

  async listAudit(input: { limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const result = await this.repository.listBotAuditLogs({ limit, offset });
    return {
      total: result.total,
      items: result.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  private serializeSettings(settings: {
    id: string;
    killSwitch: boolean;
    globalPause: boolean;
    maxConcurrency: number;
    activityLimits: unknown;
    commentTemplates: unknown;
    usernameSuffix: string;
    updatedAt: Date;
  }) {
    const scheduling = readSchedulingFromActivityLimits(settings.activityLimits);
    return {
      ...settings,
      updatedAt: settings.updatedAt.toISOString(),
      workerEnabled: this.config.BOTS_WORKER_ENABLED,
      targetPolicy: resolveBotsTargetPolicy(this.config),
      miloxEnv: this.config.MILOX_ENV,
      scheduling,
      rankingNote:
        "Inactivity is an estimate: lastSeenAt reflects chat presence only; null falls back to createdAt. lastLoginAt is not used because it is not written by the app yet.",
    };
  }

  private async allocateUsername(
    sourceUsername: string,
    suffix: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < MAX_USERNAME_ATTEMPTS; attempt += 1) {
      const candidate = buildBotUsernameCandidate(
        sourceUsername,
        suffix,
        attempt,
      );
      const taken = await this.repository.usernameTaken(candidate.toLowerCase());
      if (!taken) return candidate;
    }
    throw new AppError(
      "USERNAME_COLLISION",
      "Could not allocate a unique bot username after bounded retries",
      409,
    );
  }

  private async requireBatch(id: string): Promise<BotCandidateBatchRecord> {
    const batch = await this.repository.getCandidateBatch(id);
    if (!batch) {
      throw new AppError("NOT_FOUND", "Candidate batch not found", 404);
    }
    return batch;
  }

  private serializeBatch(batch: BotCandidateBatchRecord) {
    return {
      id: batch.id,
      criteriaVersion: batch.criteriaVersion,
      criteria: batch.criteria,
      rankedAt: batch.rankedAt.toISOString(),
      eligibleCount: batch.eligibleCount,
      previewCount: batch.previewCount,
      selectedUserIds: batch.selectedUserIds,
      selectedCount: batch.selectedUserIds.length,
      status: batch.status,
      createdByAdminId: batch.createdByAdminId,
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
      previewSnapshot: batch.previewSnapshot,
    };
  }

  private guardMutations(operation: string): void {
    assertNotProductionDatabaseHost(this.config.DATABASE_URL);
    assertBotsMutationsAllowed(this.config, operation);
  }
}
