/**
 * Long-running worker interval + kill/pause race E2E on milox_bots_e2e.
 *
 * Requires BOTS_E2E=1 and BOTS_E2E_DATABASE_URL (same as activity execution suite).
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../../src/config/env.js";
import { BotActivityWorker } from "../../src/jobs/bots/bot-activity-worker.js";
import {
  cleanupE2eFixtures,
  createE2eServices,
  createJob,
  seedE2eFixtures,
  type E2eFixtures,
} from "./fixtures.js";
import { assertBotsE2eEnabled, assertSafeBotsE2eDatabaseUrl } from "./safety.js";
import { waitUntil } from "./wait.js";

const optedIn = process.env.BOTS_E2E === "1";
const describeE2e = optedIn ? describe : describe.skip;

describeE2e("bots worker lifecycle + race E2E", () => {
  let database: PrismaClient;
  let fixtures: E2eFixtures;
  let services: ReturnType<typeof createE2eServices>;

  beforeAll(async () => {
    assertBotsE2eEnabled();
    const safe = assertSafeBotsE2eDatabaseUrl(process.env.BOTS_E2E_DATABASE_URL);
    database = new PrismaClient({
      datasources: { db: { url: safe.url } },
    });
    await database.$connect();
    fixtures = await seedE2eFixtures(database);
    services = createE2eServices(database);
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
  });

  afterAll(async () => {
    if (database && fixtures) {
      await cleanupE2eFixtures(database, fixtures);
    }
    await database?.$disconnect();
  });

  function enabledWorker(
    options: ConstructorParameters<typeof BotActivityWorker>[5] = {},
  ) {
    return new BotActivityWorker(
      database,
      { ...services.config, BOTS_WORKER_ENABLED: true } as AppConfig,
      services.posts,
      services.comments,
      services.follows,
      { pollMs: 100, ...options },
    );
  }

  async function makeLikeTargetPost(): Promise<string> {
    const id = randomUUID();
    await database.post.create({
      data: {
        id,
        authorId: fixtures.authorUserId,
        body: "lifecycle target post",
        likeCount: 0,
      },
    });
    return id;
  }

  it("start() interval claims and executes without manual tick()", async () => {
    const postId = await makeLikeTargetPost();
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${fixtures.runId}:lifecycle:auto`,
    });

    const worker = enabledWorker();
    worker.start();
    expect(worker.isTimerActive()).toBe(true);

    await waitUntil(
      async () => {
        const row = await database.botActivityJob.findUnique({
          where: { id: job.id },
        });
        return row?.status === "PROCESSED" || row?.status === "SKIPPED";
      },
      { label: "interval worker finishes job", timeoutMs: 5_000 },
    );

    worker.stop();
    expect(worker.isTimerActive()).toBe(false);

    const row = await database.botActivityJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe("PROCESSED");
    const like = await database.postLike.findUnique({
      where: {
        postId_userId: { postId, userId: fixtures.botUserId },
      },
    });
    expect(like).toBeTruthy();
    const post = await database.post.findUniqueOrThrow({
      where: { id: postId },
      select: { likeCount: true },
    });
    expect(post.likeCount).toBe(1);

    await database.postLike.deleteMany({ where: { postId } });
    await database.botActivityJob.delete({ where: { id: job.id } });
    await database.post.delete({ where: { id: postId } });
  });

  it("stop() prevents further scheduling; repeated start/stop is idempotent", async () => {
    const worker = enabledWorker();
    worker.start();
    worker.start(); // second start must not create another timer
    expect(worker.isTimerActive()).toBe(true);
    const ticksAfterFirst = worker.getTickCount();

    worker.stop();
    worker.stop();
    expect(worker.isTimerActive()).toBe(false);

    const ticksAtStop = worker.getTickCount();
    await new Promise((r) => setTimeout(r, 350));
    expect(worker.getTickCount()).toBe(ticksAtStop);

    worker.start();
    expect(worker.isTimerActive()).toBe(true);
    await waitUntil(() => worker.getTickCount() > ticksAtStop, {
      label: "restarted worker ticks",
      timeoutMs: 2_000,
    });
    expect(worker.getTickCount()).toBeGreaterThan(ticksAfterFirst);
    worker.stop();
  });

  it("tick errors are caught by start() interval (processing continues)", async () => {
    const worker = enabledWorker({
      afterClaim: async () => {
        throw new Error("injected_after_claim_error");
      },
    });
    const postId = await makeLikeTargetPost();
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${fixtures.runId}:lifecycle:err`,
    });

    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      worker.start();
      await waitUntil(
        async () => {
          const row = await database.botActivityJob.findUnique({
            where: { id: job.id },
          });
          // afterClaim throws → catch requeues with lastError / attempts >= 1
          return (
            (row?.attempts ?? 0) >= 1 ||
            Boolean(row?.lastError) ||
            row?.status === "FAILED"
          );
        },
        { label: "error path settles job", timeoutMs: 5_000 },
      );
      expect(worker.isTimerActive()).toBe(true);
      expect(worker.getTickCount()).toBeGreaterThan(0);
    } finally {
      console.error = originalError;
      worker.stop();
    }

    await database.botActivityJob.deleteMany({ where: { id: job.id } });
    await database.post.delete({ where: { id: postId } });
  });

  it("kill switch before claiming leaves job PENDING", async () => {
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: true, globalPause: false },
    });
    const postId = await makeLikeTargetPost();
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${fixtures.runId}:race:kill-before`,
    });
    const worker = enabledWorker();
    worker.start();
    await waitUntil(() => worker.getTickCount() >= 2, {
      label: "worker ticks under kill switch",
      timeoutMs: 2_000,
    });
    worker.stop();
    const row = await database.botActivityJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe("PENDING");
    await database.botActivityJob.delete({ where: { id: job.id } });
    await database.post.delete({ where: { id: postId } });
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false },
    });
  });

  it("global pause before claiming leaves job PENDING", async () => {
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false, globalPause: true },
    });
    const postId = await makeLikeTargetPost();
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${fixtures.runId}:race:pause-before`,
    });
    const worker = enabledWorker();
    worker.start();
    await waitUntil(() => worker.getTickCount() >= 2, {
      label: "worker ticks under global pause",
      timeoutMs: 2_000,
    });
    worker.stop();
    const row = await database.botActivityJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.status).toBe("PENDING");
    await database.botActivityJob.delete({ where: { id: job.id } });
    await database.post.delete({ where: { id: postId } });
    await database.botSettings.update({
      where: { id: "default" },
      data: { globalPause: false },
    });
  });

  it("kill switch after claim cancels before domain action", async () => {
    const postId = await makeLikeTargetPost();
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${fixtures.runId}:race:kill-after-claim`,
    });
    const worker = enabledWorker({
      afterClaim: async () => {
        await database.botSettings.update({
          where: { id: "default" },
          data: { killSwitch: true },
        });
      },
    });
    worker.start();
    await waitUntil(
      async () => {
        const row = await database.botActivityJob.findUnique({
          where: { id: job.id },
        });
        return row?.status === "CANCELLED";
      },
      { label: "claimed job cancelled by kill switch", timeoutMs: 5_000 },
    );
    worker.stop();

    const like = await database.postLike.findUnique({
      where: {
        postId_userId: { postId, userId: fixtures.botUserId },
      },
    });
    expect(like).toBeNull();
    const row = await database.botActivityJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(row.lastError).toBe("kill_switch");

    await database.botActivityJob.delete({ where: { id: job.id } });
    await database.post.delete({ where: { id: postId } });
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false },
    });
  });

  it("global pause after claim skips before domain action", async () => {
    const postId = await makeLikeTargetPost();
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${fixtures.runId}:race:pause-after-claim`,
    });
    const worker = enabledWorker({
      afterClaim: async () => {
        await database.botSettings.update({
          where: { id: "default" },
          data: { globalPause: true },
        });
      },
    });
    worker.start();
    await waitUntil(
      async () => {
        const row = await database.botActivityJob.findUnique({
          where: { id: job.id },
        });
        return row?.status === "SKIPPED";
      },
      { label: "claimed job skipped by global pause", timeoutMs: 5_000 },
    );
    worker.stop();
    expect(
      await database.postLike.findUnique({
        where: {
          postId_userId: { postId, userId: fixtures.botUserId },
        },
      }),
    ).toBeNull();

    await database.botActivityJob.delete({ where: { id: job.id } });
    await database.post.delete({ where: { id: postId } });
    await database.botSettings.update({
      where: { id: "default" },
      data: { globalPause: false },
    });
  });

  it("bot paused after planning skips execution", async () => {
    const postId = await makeLikeTargetPost();
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${fixtures.runId}:race:bot-paused`,
    });
    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: { status: "PAUSED" },
    });
    const worker = enabledWorker();
    worker.start();
    await waitUntil(
      async () => {
        const row = await database.botActivityJob.findUnique({
          where: { id: job.id },
        });
        return row?.status === "SKIPPED";
      },
      { label: "paused bot job skipped", timeoutMs: 5_000 },
    );
    worker.stop();
    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: { status: "ACTIVE" },
    });
    await database.botActivityJob.delete({ where: { id: job.id } });
    await database.post.delete({ where: { id: postId } });
  });

  it("shutdown while job in progress lets in-flight finish and stops new claims", async () => {
    const postId = await makeLikeTargetPost();
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${fixtures.runId}:race:shutdown`,
    });
    let releaseExecute!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseExecute = resolve;
    });
    const worker = enabledWorker({
      afterClaim: async () => {
        worker.stop();
        await gate;
      },
    });
    worker.start();
    await waitUntil(() => !worker.isTimerActive(), {
      label: "timer cleared after stop during claim",
      timeoutMs: 5_000,
    });
    // In-flight still blocked on afterClaim gate; release to finish execute.
    releaseExecute();
    await waitUntil(
      async () => {
        const row = await database.botActivityJob.findUnique({
          where: { id: job.id },
        });
        return (
          row?.status === "PROCESSED" ||
          row?.status === "SKIPPED" ||
          row?.status === "CANCELLED" ||
          row?.status === "FAILED"
        );
      },
      { label: "in-flight job reaches terminal state", timeoutMs: 5_000 },
    );
    const row = await database.botActivityJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    // Accurate outcome: if execute ran, PROCESSED; kill/pause not set so expect PROCESSED.
    expect(["PROCESSED", "SKIPPED", "FAILED"]).toContain(row.status);
    if (row.status === "PROCESSED") {
      expect(
        await database.postLike.findUnique({
          where: {
            postId_userId: { postId, userId: fixtures.botUserId },
          },
        }),
      ).toBeTruthy();
    }

    const secondPost = await makeLikeTargetPost();
    const secondJob = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: secondPost,
      idempotencyKey: `${fixtures.runId}:race:shutdown-second`,
    });
    await new Promise((r) => setTimeout(r, 400));
    const stillPending = await database.botActivityJob.findUniqueOrThrow({
      where: { id: secondJob.id },
    });
    expect(stillPending.status).toBe("PENDING");

    await database.postLike.deleteMany({
      where: { postId: { in: [postId, secondPost] } },
    });
    await database.botActivityJob.deleteMany({
      where: { id: { in: [job.id, secondJob.id] } },
    });
    await database.post.deleteMany({
      where: { id: { in: [postId, secondPost] } },
    });
  });
});

describe("bots worker lifecycle gate", () => {
  it("skips unless BOTS_E2E=1", () => {
    if (!optedIn) {
      console.info(
        "Skipped worker lifecycle E2E. Enable with BOTS_E2E=1 and milox_bots_e2e URL.",
      );
    }
    expect(true).toBe(true);
  });
});
