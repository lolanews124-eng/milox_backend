import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../config/env.js";
import { writeBotJobProcessedAudit } from "../../modules/bots/application/bot-activity-audit.js";
import { BotActivityExecutor } from "../../modules/bots/application/bot-activity-executor.js";
import {
  BotActivityPlanner,
  type BotActivityPlannerOptions,
} from "../../modules/bots/application/bot-activity-planner.js";
import {
  readSchedulingFromActivityLimits,
  resolveActiveScheduleWindow,
} from "../../modules/bots/application/bot-scheduling.js";
import { resolveBotsTargetPolicy } from "../../modules/bots/application/bot-target-policy.js";
import type { CommentService } from "../../modules/comments/application/services/comment-service.js";
import type { FollowService } from "../../modules/follows/application/services/follow-service.js";
import type { PostService } from "../../modules/posts/application/services/post-service.js";
import {
  botJobBackoffMs,
  claimNextBotActivityJob,
  finishBotActivityJob,
  recoverStaleBotActivityJobs,
  requeueBotActivityJob,
} from "../../shared/claim-bot-activity-job.js";

const STALE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const DEFAULT_POLL_MS = 5_000;

export type BotActivityWorkerOptions = {
  /** Poll interval for start(); default 5000. Tests may use a shorter value. */
  pollMs?: number;
  /**
   * Invoked after a job is claimed and before kill/pause re-check + execute.
   * Used by E2E race tests; production leaves this unset.
   */
  afterClaim?: (job: { id: string }) => Promise<void>;
  /**
   * Forwarded to BotActivityPlanner. Production leaves unset.
   * Used by isolated automatic-pipeline E2E for deterministic targeting.
   */
  planner?: BotActivityPlannerOptions;
  /**
   * When set, claim only jobs for this bot (test isolation).
   * Production leaves unset so the global claim queue is used.
   */
  claimBotAccountId?: string;
};

/**
 * Planner + claim/execute loop for bot activity.
 * Only runs when BOTS_WORKER_ENABLED=true.
 */
export class BotActivityWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;
  private readonly planner: BotActivityPlanner;
  private readonly executor: BotActivityExecutor;
  private activeClaims = 0;
  private lastPlanAt = 0;
  private tickCount = 0;
  private readonly pollMs: number;
  private readonly afterClaim: ((job: { id: string }) => Promise<void>) | undefined;
  private readonly claimBotAccountId: string | undefined;

  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
    posts: PostService,
    comments: CommentService,
    follows: FollowService,
    options: BotActivityWorkerOptions = {},
  ) {
    // Effective policy always comes from AppConfig (never from loose options).
    // Staging/production resolve to "disabled" even if misconfigured.
    const targetPolicy = resolveBotsTargetPolicy(config);
    this.planner = new BotActivityPlanner(database, {
      ...(options.planner ?? {}),
      targetPolicy,
    });
    this.executor = new BotActivityExecutor({
      database,
      posts,
      comments,
      follows,
      targetPolicy,
    });
    this.pollMs = Math.max(options.pollMs ?? DEFAULT_POLL_MS, 50);
    this.afterClaim = options.afterClaim;
    this.claimBotAccountId = options.claimBotAccountId;
  }

  /** Test/observability: number of tick() entries since construction. */
  getTickCount(): number {
    return this.tickCount;
  }

  /** Test/observability: whether an interval timer is currently scheduled. */
  isTimerActive(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    if (!this.config.BOTS_WORKER_ENABLED) {
      console.info("Bot activity worker disabled (BOTS_WORKER_ENABLED=false)");
      return;
    }
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        console.error("Bot activity worker tick failed", error);
      });
    }, this.pollMs);
    this.timer.unref();
    void this.tick().catch(() => undefined);
    console.info("Bot activity worker started");
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.stopping || this.running) return;
    if (!this.config.BOTS_WORKER_ENABLED) return;
    this.running = true;
    this.tickCount += 1;
    try {
      await recoverStaleBotActivityJobs(this.database, STALE_MS);

      const settings = await this.database.botSettings.upsert({
        where: { id: "default" },
        create: { id: "default" },
        update: {},
      });
      if (settings.killSwitch || settings.globalPause) {
        return;
      }

      const limits =
        settings.activityLimits &&
        typeof settings.activityLimits === "object" &&
        !Array.isArray(settings.activityLimits)
          ? (settings.activityLimits as Record<string, unknown>)
          : {};

      // When scheduling is enabled, skip plan+claim outside the active window
      // (missed windows are not caught up — same policy as the planner).
      const scheduling = readSchedulingFromActivityLimits(limits);
      if (
        scheduling.enabled &&
        !resolveActiveScheduleWindow(new Date(), scheduling)
      ) {
        return;
      }

      const planInterval = Math.max(
        Number(limits.plannerIntervalMs) || 60_000,
        15_000,
      );
      if (Date.now() - this.lastPlanAt >= planInterval) {
        await this.planner.planTick();
        this.lastPlanAt = Date.now();
      }

      const concurrency = Math.min(
        Math.max(settings.maxConcurrency || 1, 1),
        10,
      );
      const slots = concurrency - this.activeClaims;
      if (slots > 0 && !this.stopping) {
        await Promise.all(
          Array.from({ length: slots }, () => this.claimAndRun()),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async claimAndRun(): Promise<void> {
    const job = await claimNextBotActivityJob(
      this.database,
      this.claimBotAccountId
        ? { botAccountId: this.claimBotAccountId }
        : {},
    );
    if (!job) return;
    this.activeClaims += 1;
    try {
      if (this.afterClaim) {
        await this.afterClaim(job);
      }

      const settings = await this.database.botSettings.findUnique({
        where: { id: "default" },
      });
      if (settings?.killSwitch) {
        await finishBotActivityJob(
          this.database,
          job.id,
          "CANCELLED",
          "kill_switch",
        );
        return;
      }
      if (settings?.globalPause) {
        await finishBotActivityJob(
          this.database,
          job.id,
          "SKIPPED",
          "global_pause",
          { reason: "global_pause" },
        );
        return;
      }

      const result = await this.executor.execute(job);
      if (result.outcome === "processed") {
        await finishBotActivityJob(this.database, job.id, "PROCESSED", undefined, {
          detail: result.detail ?? "ok",
        });
        await writeBotJobProcessedAudit(
          this.database,
          {
            id: job.id,
            botAccountId: job.botAccountId,
            activityType: job.activityType,
            targetType: job.targetType,
            targetId: job.targetId,
          },
          result.detail,
        );
        return;
      }
      if (result.outcome === "skipped") {
        await finishBotActivityJob(
          this.database,
          job.id,
          "SKIPPED",
          result.reason,
          { reason: result.reason },
        );
        return;
      }
      if (result.retryable && job.attempts < MAX_ATTEMPTS) {
        await requeueBotActivityJob(
          this.database,
          job.id,
          result.error,
          botJobBackoffMs(job.attempts),
        );
        return;
      }
      await finishBotActivityJob(this.database, job.id, "FAILED", result.error);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "executor_crash";
      if (job.attempts < MAX_ATTEMPTS) {
        await requeueBotActivityJob(
          this.database,
          job.id,
          message.slice(0, 500),
          botJobBackoffMs(job.attempts),
        );
      } else {
        await finishBotActivityJob(
          this.database,
          job.id,
          "FAILED",
          message.slice(0, 500),
        );
      }
    } finally {
      this.activeClaims -= 1;
    }
  }
}
