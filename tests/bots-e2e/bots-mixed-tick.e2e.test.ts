/**
 * Mixed-action planner tick E2E on milox_bots_e2e.
 *
 * Production planner enqueues at most ONE job per ACTIVE bot per planTick.
 * To observe LIKE + COMMENT + FOLLOW in the same tick, this suite uses three
 * dedicated bots with complementary permissions (not forceActivityType).
 *
 * Does not touch milox_live_copy or main .env worker flag.
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../../src/config/env.js";
import { BotActivityWorker } from "../../src/jobs/bots/bot-activity-worker.js";
import { BotActivityPlanner } from "../../src/modules/bots/application/bot-activity-planner.js";
import { BOTS_TEST_FIXTURE_MARKER } from "../../src/modules/bots/application/bot-target-policy.js";
import { DEFAULT_BOT_PERMISSIONS } from "../../src/modules/bots/application/bot-username.js";
import { createE2eServices } from "./fixtures.js";
import { assertBotsE2eEnabled, assertSafeBotsE2eDatabaseUrl } from "./safety.js";
import { waitUntil } from "./wait.js";

const fixturePlanner = (database: ConstructorParameters<typeof BotActivityPlanner>[0]) =>
  new BotActivityPlanner(database, { targetPolicy: "test_fixtures_only" });

const optedIn = process.env.BOTS_E2E === "1";
const describeE2e = optedIn ? describe : describe.skip;

const COMMENT_TEMPLATE = "E2E mixed-tick approved comment.";

type BotBundle = {
  botAccountId: string;
  botUserId: string;
  username: string;
};

describeE2e("bots mixed planner tick (like+comment+follow)", () => {
  let database: PrismaClient;
  let services: ReturnType<typeof createE2eServices>;
  let runId = "";
  let authorUserId = "";
  let postId = "";
  let followTargetUserId = "";
  let likeBot: BotBundle;
  let commentBot: BotBundle;
  let followBot: BotBundle;
  const createdUserIds: string[] = [];
  const createdBotIds: string[] = [];

  beforeAll(async () => {
    assertBotsE2eEnabled();
    const safe = assertSafeBotsE2eDatabaseUrl(process.env.BOTS_E2E_DATABASE_URL);
    expect(safe.database).toBe("milox_bots_e2e");

    database = new PrismaClient({
      datasources: { db: { url: safe.url } },
    });
    await database.$connect();
    services = createE2eServices(database);
    runId = `mix_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

    await database.botAccount.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "PAUSED" },
    });
    await database.botActivityJob.updateMany({
      where: { status: "PENDING" },
      data: { status: "CANCELLED", lastError: "mixed_tick_isolate" },
    });

    authorUserId = randomUUID();
    followTargetUserId = randomUUID();
    postId = randomUUID();
    const authorUsername = `${runId}_auth`.slice(0, 32);
    const targetUsername = `${runId}_tgt`.slice(0, 32);

    await database.user.create({
      data: {
        id: authorUserId,
        username: authorUsername,
        usernameNormalized: authorUsername.toLowerCase(),
        email: `${runId}_author@bots-e2e.local`,
        passwordHash: "e2e-not-a-login",
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        status: "ACTIVE",
        role: "USER",
        isAutomatedAccount: false,
        isSystemAccount: false,
        displayName: "E2E Mixed Author",
      },
    });
    createdUserIds.push(authorUserId);

    await database.user.create({
      data: {
        id: followTargetUserId,
        username: targetUsername,
        usernameNormalized: targetUsername.toLowerCase(),
        email: `${runId}_target@bots-e2e.local`,
        passwordHash: "e2e-not-a-login",
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        status: "ACTIVE",
        role: "USER",
        isAutomatedAccount: false,
        isSystemAccount: false,
        isPrivateAccount: false,
        displayName: `E2E Mixed Follow Target ${BOTS_TEST_FIXTURE_MARKER}`,
        bio: `Approved follow fixture ${BOTS_TEST_FIXTURE_MARKER}`,
        createdAt: new Date(),
      },
    });
    createdUserIds.push(followTargetUserId);

    await database.post.create({
      data: {
        id: postId,
        authorId: authorUserId,
        body: `E2E mixed-tick fixture post — not a real user post. ${BOTS_TEST_FIXTURE_MARKER}`,
        likeCount: 0,
        commentCount: 0,
        createdAt: new Date(),
      },
    });

    likeBot = await createSpecializedBot(database, runId, "like", {
      likesEnabled: true,
      commentsEnabled: false,
      followsEnabled: false,
      viewsEnabled: false,
      maxLikesPerDay: 2,
      maxCommentsPerDay: 0,
      maxFollowsPerDay: 0,
    });
    commentBot = await createSpecializedBot(database, runId, "cmt", {
      likesEnabled: false,
      commentsEnabled: true,
      followsEnabled: false,
      viewsEnabled: false,
      maxLikesPerDay: 0,
      maxCommentsPerDay: 2,
      maxFollowsPerDay: 0,
    });
    followBot = await createSpecializedBot(database, runId, "fol", {
      likesEnabled: false,
      commentsEnabled: false,
      followsEnabled: true,
      viewsEnabled: false,
      maxLikesPerDay: 0,
      maxCommentsPerDay: 0,
      maxFollowsPerDay: 2,
    });
    createdBotIds.push(
      likeBot.botAccountId,
      commentBot.botAccountId,
      followBot.botAccountId,
    );
    createdUserIds.push(
      likeBot.botUserId,
      commentBot.botUserId,
      followBot.botUserId,
    );

    await database.botSettings.update({
      where: { id: "default" },
      data: {
        killSwitch: false,
        globalPause: false,
        maxConcurrency: 3,
        commentTemplates: [COMMENT_TEMPLATE],
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: true,
          viewsEnabled: false,
          maxJobsPerTick: 10,
          maxGlobalLikesPerHour: 20,
          maxGlobalCommentsPerHour: 20,
          maxGlobalFollowsPerHour: 20,
          plannerIntervalMs: 15_000,
        },
      },
    });
  });

  afterAll(async () => {
    if (!database) return;
    await database.botActivityJob.deleteMany({
      where: { botAccountId: { in: createdBotIds } },
    });
    await database.postLike.deleteMany({
      where: { OR: [{ postId }, { userId: { in: createdUserIds } }] },
    });
    await database.comment.deleteMany({
      where: { OR: [{ postId }, { authorId: { in: createdUserIds } }] },
    });
    await database.follow.deleteMany({
      where: {
        OR: [
          { followerId: { in: createdUserIds } },
          { followeeId: followTargetUserId },
        ],
      },
    });
    await database.post.deleteMany({ where: { id: postId } });
    await database.botAccount.deleteMany({
      where: { id: { in: createdBotIds } },
    });
    await database.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false, globalPause: false },
    });
    await database.$disconnect();
  });

  it("one planTick schedules LIKE, COMMENT and FOLLOW via three specialized bots", async () => {
    // No forceActivityType / preferTargetId — normal planner selection.
    const planner = fixturePlanner(database);
    const result = await planner.planTick();
    expect(result.enqueued).toBe(3);

    const jobs = await database.botActivityJob.findMany({
      where: {
        botAccountId: { in: createdBotIds },
        status: "PENDING",
      },
    });
    expect(jobs).toHaveLength(3);
    const types = new Set(jobs.map((j) => j.activityType));
    expect(types.has("LIKE_POST")).toBe(true);
    expect(types.has("COMMENT_POST")).toBe(true);
    expect(types.has("FOLLOW_USER")).toBe(true);

    const likeJob = jobs.find((j) => j.activityType === "LIKE_POST")!;
    const commentJob = jobs.find((j) => j.activityType === "COMMENT_POST")!;
    const followJob = jobs.find((j) => j.activityType === "FOLLOW_USER")!;
    expect(likeJob.botAccountId).toBe(likeBot.botAccountId);
    expect(commentJob.botAccountId).toBe(commentBot.botAccountId);
    expect(followJob.botAccountId).toBe(followBot.botAccountId);
    expect(likeJob.idempotencyKey.startsWith("like:")).toBe(true);
    expect(commentJob.idempotencyKey.startsWith("comment:")).toBe(true);
    expect(followJob.idempotencyKey.startsWith("follow:")).toBe(true);

    const beforePost = await database.post.findUniqueOrThrow({
      where: { id: postId },
      select: { likeCount: true, commentCount: true },
    });
    const beforeTarget = await database.user.findUniqueOrThrow({
      where: { id: followTargetUserId },
      select: { followerCount: true },
    });

    const worker = new BotActivityWorker(
      database,
      { ...services.config, BOTS_WORKER_ENABLED: true } as AppConfig,
      services.posts,
      services.comments,
      services.follows,
      { pollMs: 80 },
    );
    worker.start();
    await waitUntil(
      async () => {
        const anyDone = await database.botActivityJob.count({
          where: {
            botAccountId: { in: createdBotIds },
            status: "PROCESSED",
          },
        });
        return anyDone >= 3;
      },
      { label: "mixed worker finishes 3 jobs", timeoutMs: 10_000 },
    );
    worker.stop();

    const processed = await database.botActivityJob.findMany({
      where: {
        botAccountId: { in: createdBotIds },
        status: "PROCESSED",
      },
    });
    expect(processed.length).toBeGreaterThanOrEqual(3);
    const processedTypes = new Set(processed.map((j) => j.activityType));
    expect(processedTypes.has("LIKE_POST")).toBe(true);
    expect(processedTypes.has("COMMENT_POST")).toBe(true);
    expect(processedTypes.has("FOLLOW_USER")).toBe(true);

    const afterPost = await database.post.findUniqueOrThrow({
      where: { id: postId },
      select: { likeCount: true, commentCount: true },
    });
    const afterTarget = await database.user.findUniqueOrThrow({
      where: { id: followTargetUserId },
      select: { followerCount: true },
    });
    expect(afterPost.likeCount).toBeGreaterThanOrEqual(beforePost.likeCount + 1);
    expect(afterPost.commentCount).toBeGreaterThanOrEqual(
      beforePost.commentCount + 1,
    );
    expect(afterTarget.followerCount).toBeGreaterThanOrEqual(
      beforeTarget.followerCount + 1,
    );

    const likeKeys = await database.botActivityJob.groupBy({
      by: ["idempotencyKey"],
      where: {
        botAccountId: likeBot.botAccountId,
        activityType: "LIKE_POST",
      },
      _count: true,
    });
    for (const row of likeKeys) {
      expect(row._count).toBe(1);
    }
  });

  it("a single multi-eligible bot gets at most one job per planTick", async () => {
    await database.botAccount.updateMany({
      where: { id: { in: createdBotIds } },
      data: { status: "PAUSED" },
    });
    await database.botActivityJob.updateMany({
      where: {
        botAccountId: { in: createdBotIds },
        status: "PENDING",
      },
      data: { status: "CANCELLED", lastError: "single_bot_probe" },
    });

    const multiBot = await createSpecializedBot(database, runId, "multi", {
      likesEnabled: true,
      commentsEnabled: true,
      followsEnabled: true,
      viewsEnabled: false,
      maxLikesPerDay: 5,
      maxCommentsPerDay: 5,
      maxFollowsPerDay: 5,
    });
    createdBotIds.push(multiBot.botAccountId);
    createdUserIds.push(multiBot.botUserId);

    const probePostId = randomUUID();
    await database.post.create({
      data: {
        id: probePostId,
        authorId: authorUserId,
        body: `E2E single-bot-per-tick probe post. ${BOTS_TEST_FIXTURE_MARKER}`,
        likeCount: 0,
        commentCount: 0,
        createdAt: new Date(),
      },
    });

    await database.botSettings.update({
      where: { id: "default" },
      data: {
        killSwitch: false,
        globalPause: false,
        commentTemplates: [COMMENT_TEMPLATE],
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: true,
          viewsEnabled: false,
          maxJobsPerTick: 10,
          maxGlobalLikesPerHour: 20,
          maxGlobalCommentsPerHour: 20,
          maxGlobalFollowsPerHour: 20,
          plannerIntervalMs: 15_000,
        },
      },
    });

    const result = await fixturePlanner(database).planTick();
    expect(result.enqueued).toBe(1);
    const pending = await database.botActivityJob.findMany({
      where: { botAccountId: multiBot.botAccountId, status: "PENDING" },
    });
    expect(pending).toHaveLength(1);

    await database.botActivityJob.deleteMany({
      where: { botAccountId: multiBot.botAccountId },
    });
    await database.post.delete({ where: { id: probePostId } });
    await database.botAccount.update({
      where: { id: multiBot.botAccountId },
      data: { status: "PAUSED" },
    });
    await database.botAccount.updateMany({
      where: {
        id: {
          in: [
            likeBot.botAccountId,
            commentBot.botAccountId,
            followBot.botAccountId,
          ],
        },
      },
      data: { status: "ACTIVE" },
    });
  });

  it("mixed tick respects maxJobsPerTick, global like budget, pause and toggles", async () => {
    await database.botActivityJob.updateMany({
      where: {
        botAccountId: { in: createdBotIds },
        status: "PENDING",
      },
      data: { status: "CANCELLED", lastError: "mixed_limit_isolate" },
    });
    await database.botAccount.updateMany({
      where: { id: { in: createdBotIds } },
      data: { status: "ACTIVE" },
    });

    await database.botSettings.update({
      where: { id: "default" },
      data: {
        killSwitch: false,
        globalPause: false,
        commentTemplates: [COMMENT_TEMPLATE],
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: true,
          viewsEnabled: false,
          maxJobsPerTick: 2,
          maxGlobalLikesPerHour: 20,
          maxGlobalCommentsPerHour: 20,
          maxGlobalFollowsPerHour: 20,
          plannerIntervalMs: 15_000,
        },
      },
    });
    const capped = await fixturePlanner(database).planTick();
    expect(capped.enqueued).toBeLessThanOrEqual(2);
    expect(capped.enqueued).toBeGreaterThan(0);

    await database.botActivityJob.updateMany({
      where: {
        botAccountId: { in: createdBotIds },
        status: "PENDING",
      },
      data: { status: "CANCELLED", lastError: "mixed_budget_isolate" },
    });
    await database.botSettings.update({
      where: { id: "default" },
      data: {
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: true,
          viewsEnabled: false,
          maxJobsPerTick: 10,
          maxGlobalLikesPerHour: 0,
          maxGlobalCommentsPerHour: 20,
          maxGlobalFollowsPerHour: 20,
          plannerIntervalMs: 15_000,
        },
      },
    });
    const budget = await fixturePlanner(database).planTick();
    const pending = await database.botActivityJob.findMany({
      where: {
        botAccountId: { in: createdBotIds },
        status: "PENDING",
      },
    });
    expect(pending.every((j) => j.activityType !== "LIKE_POST")).toBe(true);
    expect(budget.enqueued).toBeGreaterThanOrEqual(0);

    await database.botSettings.update({
      where: { id: "default" },
      data: {
        globalPause: true,
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: true,
          viewsEnabled: false,
          maxJobsPerTick: 10,
          maxGlobalLikesPerHour: 20,
          maxGlobalCommentsPerHour: 20,
          maxGlobalFollowsPerHour: 20,
          plannerIntervalMs: 15_000,
        },
      },
    });
    expect((await fixturePlanner(database).planTick()).enqueued).toBe(
      0,
    );

    await database.botSettings.update({
      where: { id: "default" },
      data: {
        globalPause: false,
        killSwitch: true,
      },
    });
    expect((await fixturePlanner(database).planTick()).enqueued).toBe(
      0,
    );

    await database.botSettings.update({
      where: { id: "default" },
      data: {
        killSwitch: false,
        globalPause: false,
        activityLimits: {
          likesEnabled: false,
          commentsEnabled: false,
          followsEnabled: false,
          viewsEnabled: false,
          maxJobsPerTick: 10,
          maxGlobalLikesPerHour: 20,
          maxGlobalCommentsPerHour: 20,
          maxGlobalFollowsPerHour: 20,
          plannerIntervalMs: 15_000,
        },
      },
    });
    expect((await fixturePlanner(database).planTick()).enqueued).toBe(
      0,
    );

    await database.botAccount.updateMany({
      where: { id: { in: createdBotIds } },
      data: { status: "PAUSED" },
    });
    await database.botSettings.update({
      where: { id: "default" },
      data: {
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: true,
          viewsEnabled: false,
          maxJobsPerTick: 10,
          maxGlobalLikesPerHour: 20,
          maxGlobalCommentsPerHour: 20,
          maxGlobalFollowsPerHour: 20,
          plannerIntervalMs: 15_000,
        },
      },
    });
    expect((await fixturePlanner(database).planTick()).enqueued).toBe(
      0,
    );
  });
});

async function createSpecializedBot(
  database: PrismaClient,
  runId: string,
  suffix: string,
  permissions: Record<string, unknown>,
): Promise<BotBundle> {
  const botUserId = randomUUID();
  const botAccountId = randomUUID();
  const username = `${runId}_${suffix}`.slice(0, 32);
  await database.user.create({
    data: {
      id: botUserId,
      username,
      usernameNormalized: username.toLowerCase(),
      email: `${runId}_${suffix}@bots-e2e.local`,
      passwordHash: "e2e-not-a-login",
      ageRange: "AGE_25_28",
      gender: "PREFER_NOT_TO_SAY",
      country: "India",
      status: "ACTIVE",
      role: "USER",
      isAutomatedAccount: true,
      isSystemAccount: false,
      displayName: `E2E Mixed ${suffix}`,
      emailVerifiedAt: new Date(),
    },
  });
  await database.botAccount.create({
    data: {
      id: botAccountId,
      userId: botUserId,
      status: "ACTIVE",
      permissions: {
        ...DEFAULT_BOT_PERMISSIONS,
        ...permissions,
      },
    },
  });
  return { botAccountId, botUserId, username };
}
