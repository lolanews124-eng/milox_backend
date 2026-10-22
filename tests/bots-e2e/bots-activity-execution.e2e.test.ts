/**
 * Actual bot activity execution E2E (likes / comments / follows).
 *
 * Safety:
 * - Requires BOTS_E2E=1
 * - Requires BOTS_E2E_DATABASE_URL → dedicated local DB `milox_bots_e2e` only
 * - Refuses milox_live_copy, remote hosts, and production-looking names
 * - Creates isolated fixtures; cleanup deletes only those records
 *
 * Setup:
 *   node scripts/setup-bots-e2e-db.mjs
 *   $env:BOTS_E2E="1"
 *   $env:BOTS_E2E_DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:5432/milox_bots_e2e?schema=public"
 *   npx vitest run tests/bots-e2e/bots-activity-execution.e2e.test.ts
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../../src/config/env.js";
import { BotActivityWorker } from "../../src/jobs/bots/bot-activity-worker.js";
import {
  claimNextBotActivityJob,
  finishBotActivityJob,
} from "../../src/shared/claim-bot-activity-job.js";
import {
  cleanupE2eFixtures,
  createE2eServices,
  createJob,
  seedE2eFixtures,
  type E2eFixtures,
} from "./fixtures.js";
import { assertBotsE2eEnabled, assertSafeBotsE2eDatabaseUrl } from "./safety.js";

const optedIn = process.env.BOTS_E2E === "1";
const describeE2e = optedIn ? describe : describe.skip;

describeE2e("bots activity actual execution E2E", () => {
  let database: PrismaClient;
  let fixtures: E2eFixtures;
  let services: ReturnType<typeof createE2eServices>;
  let dbTarget = "";

  beforeAll(async () => {
    assertBotsE2eEnabled();
    const safe = assertSafeBotsE2eDatabaseUrl(process.env.BOTS_E2E_DATABASE_URL);
    dbTarget = `${safe.hostname}/${safe.database}`;
    database = new PrismaClient({
      datasources: { db: { url: safe.url } },
    });
    await database.$connect();
    fixtures = await seedE2eFixtures(database);
    services = createE2eServices(database);
    console.info(`[bots-e2e] database target: ${dbTarget}`);
    console.info(`[bots-e2e] runId: ${fixtures.runId}`);
  });

  afterAll(async () => {
    if (database && fixtures) {
      await cleanupE2eFixtures(database, fixtures);
    }
    await database?.$disconnect();
  });

  async function claimAndExecute(jobIdHint?: string) {
    // Isolate from leftover PENDING rows (e.g. planner output from other suites).
    if (jobIdHint) {
      await database.botActivityJob.updateMany({
        where: {
          botAccountId: fixtures.botAccountId,
          status: "PENDING",
          id: { not: jobIdHint },
        },
        data: { status: "CANCELLED", lastError: "e2e_isolate" },
      });
    }
    const claimed = await claimNextBotActivityJob(database, {
      botAccountId: fixtures.botAccountId,
    });
    expect(claimed).toBeTruthy();
    if (jobIdHint) expect(claimed!.id).toBe(jobIdHint);
    const result = await services.executor.execute(claimed!);
    return { claimed: claimed!, result };
  }

  it("reports the dedicated database target", () => {
    expect(dbTarget).toContain("milox_bots_e2e");
    expect(dbTarget).not.toContain("live_copy");
  });

  it("executes a real like via PostService and increments total likeCount once", async () => {
    const before = await database.post.findUniqueOrThrow({
      where: { id: fixtures.postId },
      select: { likeCount: true },
    });

    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: fixtures.postId,
      idempotencyKey: `${fixtures.runId}:like:1`,
    });

    const { claimed, result } = await claimAndExecute(job.id);
    expect(result).toEqual({ outcome: "processed", detail: "liked" });
    await finishBotActivityJob(database, claimed.id, "PROCESSED", undefined, {
      detail: "liked",
    });

    const like = await database.postLike.findUnique({
      where: {
        postId_userId: {
          postId: fixtures.postId,
          userId: fixtures.botUserId,
        },
      },
    });
    expect(like).toBeTruthy();

    const after = await database.post.findUniqueOrThrow({
      where: { id: fixtures.postId },
      select: { likeCount: true },
    });
    expect(after.likeCount).toBe(before.likeCount + 1);
    const organicLikes = await database.postLike.count({
      where: {
        postId: fixtures.postId,
        user: { isAutomatedAccount: false },
      },
    });
    expect(organicLikes).toBe(0);

    const terminal = await database.botActivityJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(terminal.status).toBe("PROCESSED");

    // Retry path: domain already liked → skipped, no duplicate row / double-count
    const retryJob = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: fixtures.postId,
      idempotencyKey: `${fixtures.runId}:like:retry`,
    });
    const retry = await claimAndExecute(retryJob.id);
    expect(retry.result.outcome).toBe("skipped");
    expect(String((retry.result as { reason?: string }).reason)).toMatch(
      /already_liked/i,
    );
    await finishBotActivityJob(
      database,
      retry.claimed.id,
      "SKIPPED",
      "already_liked",
    );

    const likeCount = await database.postLike.count({
      where: { postId: fixtures.postId, userId: fixtures.botUserId },
    });
    expect(likeCount).toBe(1);
    const afterRetry = await database.post.findUniqueOrThrow({
      where: { id: fixtures.postId },
      select: { likeCount: true },
    });
    expect(afterRetry.likeCount).toBe(after.likeCount);
  });

  it("executes a real comment and increments total commentCount once", async () => {
    const body = "E2E approved comment template.";
    const before = await database.post.findUniqueOrThrow({
      where: { id: fixtures.postId },
      select: { commentCount: true },
    });

    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "COMMENT_POST",
      targetType: "post",
      targetId: fixtures.postId,
      idempotencyKey: `${fixtures.runId}:comment:1`,
      metadata: { body, templatePreview: body.slice(0, 80) },
    });

    const { claimed, result } = await claimAndExecute(job.id);
    expect(result).toEqual({ outcome: "processed", detail: "commented" });
    await finishBotActivityJob(database, claimed.id, "PROCESSED");

    const comment = await database.comment.findFirst({
      where: {
        postId: fixtures.postId,
        authorId: fixtures.botUserId,
        body,
        deletedAt: null,
      },
    });
    expect(comment).toBeTruthy();

    const after = await database.post.findUniqueOrThrow({
      where: { id: fixtures.postId },
      select: { commentCount: true },
    });
    expect(after.commentCount).toBe(before.commentCount + 1);

    const retryJob = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "COMMENT_POST",
      targetType: "post",
      targetId: fixtures.postId,
      idempotencyKey: `${fixtures.runId}:comment:retry`,
      metadata: { body },
    });
    const retry = await claimAndExecute(retryJob.id);
    expect(retry.result).toEqual({
      outcome: "skipped",
      reason: "duplicate_comment_body",
    });
    await finishBotActivityJob(
      database,
      retry.claimed.id,
      "SKIPPED",
      "duplicate_comment_body",
    );

    const comments = await database.comment.count({
      where: {
        postId: fixtures.postId,
        authorId: fixtures.botUserId,
        body,
        deletedAt: null,
      },
    });
    expect(comments).toBe(1);
  });

  it("executes a real follow and increments total followerCount once", async () => {
    const before = await database.user.findUniqueOrThrow({
      where: { id: fixtures.followTargetUserId },
      select: { followerCount: true },
    });

    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "FOLLOW_USER",
      targetType: "user",
      targetId: fixtures.followTargetUserId,
      idempotencyKey: `${fixtures.runId}:follow:1`,
    });

    const { claimed, result } = await claimAndExecute(job.id);
    expect(result).toEqual({ outcome: "processed", detail: "followed" });
    await finishBotActivityJob(database, claimed.id, "PROCESSED");

    const follow = await database.follow.findUnique({
      where: {
        followerId_followeeId: {
          followerId: fixtures.botUserId,
          followeeId: fixtures.followTargetUserId,
        },
      },
    });
    expect(follow?.status).toBe("ACTIVE");

    const after = await database.user.findUniqueOrThrow({
      where: { id: fixtures.followTargetUserId },
      select: { followerCount: true },
    });
    expect(after.followerCount).toBe(before.followerCount + 1);

    const retryJob = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "FOLLOW_USER",
      targetType: "user",
      targetId: fixtures.followTargetUserId,
      idempotencyKey: `${fixtures.runId}:follow:retry`,
    });
    const retry = await claimAndExecute(retryJob.id);
    expect(retry.result.outcome).toBe("skipped");
    expect(String((retry.result as { reason?: string }).reason)).toMatch(
      /already_following/i,
    );
    await finishBotActivityJob(
      database,
      retry.claimed.id,
      "SKIPPED",
      "already_following",
    );
  });

  it("skips when bot is paused or disabled", async () => {
    for (const status of ["PAUSED", "DISABLED"] as const) {
      await database.botAccount.update({
        where: { id: fixtures.botAccountId },
        data: { status },
      });
      const extraPostId = cryptoRandomUuid();
      await database.post.create({
        data: {
          id: extraPostId,
          authorId: fixtures.authorUserId,
          body: `${status.toLowerCase()}-check post`,
        },
      });
      const job = await createJob(database, {
        botAccountId: fixtures.botAccountId,
        activityType: "LIKE_POST",
        targetType: "post",
        targetId: extraPostId,
        idempotencyKey: `${fixtures.runId}:like:${status.toLowerCase()}`,
      });
      const { claimed, result } = await claimAndExecute(job.id);
      expect(result).toEqual({
        outcome: "skipped",
        reason: `bot_status_${status.toLowerCase()}`,
      });
      await finishBotActivityJob(
        database,
        claimed.id,
        "SKIPPED",
        `bot_status_${status.toLowerCase()}`,
      );
      await database.post.delete({ where: { id: extraPostId } });
    }
    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: { status: "ACTIVE" },
    });
  });

  it("planner respects global hourly like budget of zero", async () => {
    const { BotActivityPlanner } = await import(
      "../../src/modules/bots/application/bot-activity-planner.js"
    );
    await database.botSettings.update({
      where: { id: "default" },
      data: {
        killSwitch: false,
        globalPause: false,
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: false,
          followsEnabled: false,
          viewsEnabled: false,
          maxJobsPerTick: 10,
          maxGlobalLikesPerHour: 0,
          maxGlobalCommentsPerHour: 0,
          maxGlobalFollowsPerHour: 0,
          plannerIntervalMs: 15_000,
        },
      },
    });
    const before = await database.botActivityJob.count({
      where: { botAccountId: fixtures.botAccountId, status: "PENDING" },
    });
    const planner = new BotActivityPlanner(database, {
      targetPolicy: "test_fixtures_only",
    });
    const result = await planner.planTick();
    expect(result.enqueued).toBe(0);
    const after = await database.botActivityJob.count({
      where: { botAccountId: fixtures.botAccountId, status: "PENDING" },
    });
    expect(after).toBe(before);
  });

  it("enforces per-bot daily like limit", async () => {
    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: {
        permissions: {
          ...DEFAULT_PERMS,
          maxLikesPerDay: 0,
        },
      },
    });
    const extraPostId = cryptoRandomUuid();
    await database.post.create({
      data: {
        id: extraPostId,
        authorId: fixtures.authorUserId,
        body: "limit-check post",
      },
    });
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: extraPostId,
      idempotencyKey: `${fixtures.runId}:like:limit`,
    });
    const { claimed, result } = await claimAndExecute(job.id);
    expect(result).toEqual({
      outcome: "skipped",
      reason: "daily_limit_like_post",
    });
    await finishBotActivityJob(
      database,
      claimed.id,
      "SKIPPED",
      "daily_limit_like_post",
    );
    await database.post.delete({ where: { id: extraPostId } });
    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: { permissions: { ...DEFAULT_PERMS, maxLikesPerDay: 5 } },
    });
  });

  it("worker tick is a no-op when BOTS_WORKER_ENABLED=false", async () => {
    const disabledConfig = {
      ...services.config,
      BOTS_WORKER_ENABLED: false,
    } as AppConfig;
    const worker = new BotActivityWorker(
      database,
      disabledConfig,
      services.posts,
      services.comments,
      services.follows,
    );
    const pendingBefore = await database.botActivityJob.count({
      where: { botAccountId: fixtures.botAccountId, status: "PENDING" },
    });
    await worker.tick();
    const pendingAfter = await database.botActivityJob.count({
      where: { botAccountId: fixtures.botAccountId, status: "PENDING" },
    });
    expect(pendingAfter).toBe(pendingBefore);
    worker.stop();
  });

  it("worker tick claims and executes when enabled and kill/pause are off", async () => {
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false, globalPause: false },
    });
    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: {
        status: "ACTIVE",
        permissions: { ...DEFAULT_PERMS, maxLikesPerDay: 20 },
      },
    });

    const extraPostId = cryptoRandomUuid();
    await database.post.create({
      data: {
        id: extraPostId,
        authorId: fixtures.authorUserId,
        body: "worker tick post",
        likeCount: 0,
      },
    });
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: extraPostId,
      idempotencyKey: `${fixtures.runId}:like:worker`,
    });

    // Cancel foreign PENDING so a single tick claims this job (global claim queue).
    await database.botActivityJob.updateMany({
      where: { status: "PENDING", id: { not: job.id } },
      data: { status: "CANCELLED", lastError: "e2e_isolate" },
    });

    const enabledConfig = {
      ...services.config,
      BOTS_WORKER_ENABLED: true,
    } as AppConfig;
    const worker = new BotActivityWorker(
      database,
      enabledConfig,
      services.posts,
      services.comments,
      services.follows,
    );
    await database.botSettings.update({
      where: { id: "default" },
      data: {
        killSwitch: false,
        globalPause: false,
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: false,
          followsEnabled: false,
          viewsEnabled: false,
          maxJobsPerTick: 0,
          plannerIntervalMs: 3_600_000,
          maxGlobalLikesPerHour: 100,
          maxGlobalCommentsPerHour: 0,
          maxGlobalFollowsPerHour: 0,
        },
      },
    });

    await worker.tick();
    worker.stop();

    const row = await database.botActivityJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(["PROCESSED", "SKIPPED"]).toContain(row.status);
    if (row.status === "PROCESSED") {
      const like = await database.postLike.findUnique({
        where: {
          postId_userId: {
            postId: extraPostId,
            userId: fixtures.botUserId,
          },
        },
      });
      expect(like).toBeTruthy();
      const post = await database.post.findUniqueOrThrow({
        where: { id: extraPostId },
        select: { likeCount: true },
      });
      expect(post.likeCount).toBe(1);
    }

    await database.postLike.deleteMany({ where: { postId: extraPostId } });
    await database.botActivityJob.deleteMany({
      where: { targetId: extraPostId },
    });
    await database.post.delete({ where: { id: extraPostId } });
  });

  it("kill switch cancels a claimed job on the worker path", async () => {
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: true, globalPause: false },
    });
    const extraPostId = cryptoRandomUuid();
    await database.post.create({
      data: {
        id: extraPostId,
        authorId: fixtures.authorUserId,
        body: "kill-switch post",
      },
    });
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: extraPostId,
      idempotencyKey: `${fixtures.runId}:like:kill`,
    });

    const worker = new BotActivityWorker(
      database,
      { ...services.config, BOTS_WORKER_ENABLED: true } as AppConfig,
      services.posts,
      services.comments,
      services.follows,
    );
    // With kill switch on, tick returns before claim — job stays PENDING
    await worker.tick();
    worker.stop();
    const row = await database.botActivityJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe("PENDING");

    await database.botActivityJob.delete({ where: { id: job.id } });
    await database.post.delete({ where: { id: extraPostId } });
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false, globalPause: false },
    });
  });

  it("global pause prevents worker execution", async () => {
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false, globalPause: true },
    });
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: fixtures.postId,
      idempotencyKey: `${fixtures.runId}:like:gpause`,
    });
    const worker = new BotActivityWorker(
      database,
      { ...services.config, BOTS_WORKER_ENABLED: true } as AppConfig,
      services.posts,
      services.comments,
      services.follows,
    );
    await worker.tick();
    worker.stop();
    const row = await database.botActivityJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe("PENDING");
    await database.botActivityJob.delete({ where: { id: job.id } });
    await database.botSettings.update({
      where: { id: "default" },
      data: { globalPause: false },
    });
  });
});

describe("bots E2E gate", () => {
  it("documents how to enable the suite", () => {
    if (!optedIn) {
      console.info(
        [
          "Skipped actual execution E2E.",
          "1) node scripts/setup-bots-e2e-db.mjs",
          '2) $env:BOTS_E2E="1"',
          '3) $env:BOTS_E2E_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/milox_bots_e2e?schema=public"',
          "4) npx vitest run tests/bots-e2e/bots-activity-execution.e2e.test.ts",
        ].join("\n"),
      );
    }
    expect(true).toBe(true);
  });

  it("refuses milox_live_copy as E2E target", () => {
    expect(() =>
      assertSafeBotsE2eDatabaseUrl(
        "postgresql://postgres:x@127.0.0.1:5432/milox_live_copy?schema=public",
      ),
    ).toThrow(/milox_bots_e2e/);
  });

  it("refuses remote hosts", () => {
    expect(() =>
      assertSafeBotsE2eDatabaseUrl(
        "postgresql://u:p@db.milox.in:5432/milox_bots_e2e?schema=public",
      ),
    ).toThrow(/local loopback|refused|remote/i);
  });
});

const DEFAULT_PERMS = {
  likesEnabled: true,
  commentsEnabled: true,
  followsEnabled: true,
  viewsEnabled: false,
  maxLikesPerDay: 5,
  maxCommentsPerDay: 5,
  maxFollowsPerDay: 5,
};

function cryptoRandomUuid(): string {
  return globalThis.crypto.randomUUID();
}
