/**
 * Negative target-guard E2E: unmarked posts/users must not receive bot actions
 * under BOTS_TARGET_POLICY=test_fixtures_only.
 *
 * milox_bots_e2e only. Main .env worker stays false.
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BotActivityPlanner } from "../../src/modules/bots/application/bot-activity-planner.js";
import { BOTS_TEST_FIXTURE_MARKER } from "../../src/modules/bots/application/bot-target-policy.js";
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

describeE2e("bots target policy negative guards", () => {
  let database: PrismaClient;
  let fixtures: E2eFixtures;
  let services: ReturnType<typeof createE2eServices>;
  let unmarkedPostId = "";
  let unmarkedUserId = "";

  beforeAll(async () => {
    assertBotsE2eEnabled();
    const safe = assertSafeBotsE2eDatabaseUrl(process.env.BOTS_E2E_DATABASE_URL);
    database = new PrismaClient({
      datasources: { db: { url: safe.url } },
    });
    await database.$connect();
    fixtures = await seedE2eFixtures(database);
    services = createE2eServices(database);

    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: {
        status: "ACTIVE",
        permissions: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: true,
          viewsEnabled: false,
          maxLikesPerDay: 10,
          maxCommentsPerDay: 10,
          maxFollowsPerDay: 10,
        },
      },
    });
    await database.botSettings.update({
      where: { id: "default" },
      data: {
        killSwitch: false,
        globalPause: false,
        commentTemplates: ["E2E approved comment template."],
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: true,
          viewsEnabled: false,
          maxJobsPerTick: 5,
          maxGlobalLikesPerHour: 50,
          maxGlobalCommentsPerHour: 50,
          maxGlobalFollowsPerHour: 50,
          plannerIntervalMs: 15_000,
        },
      },
    });

    unmarkedPostId = randomUUID();
    unmarkedUserId = randomUUID();
    const unmarkedUsername = `unmarked_${randomUUID().slice(0, 8)}`;
    await database.user.create({
      data: {
        id: unmarkedUserId,
        username: unmarkedUsername,
        usernameNormalized: unmarkedUsername.toLowerCase(),
        email: `${unmarkedUsername}@example.com`,
        passwordHash: "e2e-not-a-login",
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        status: "ACTIVE",
        role: "USER",
        isAutomatedAccount: false,
        isSystemAccount: false,
        isPrivateAccount: false,
        displayName: "Unmarked Ordinary User",
        bio: "Looks like a normal member — no fixture marker.",
      },
    });
    await database.post.create({
      data: {
        id: unmarkedPostId,
        authorId: unmarkedUserId,
        body: "Ordinary recent post without the approved fixture marker.",
        likeCount: 0,
        commentCount: 0,
        createdAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (database) {
      await database.botActivityJob.deleteMany({
        where: {
          OR: [
            { targetId: unmarkedPostId },
            { targetId: unmarkedUserId },
            { botAccountId: fixtures?.botAccountId },
          ],
        },
      });
      await database.postLike.deleteMany({
        where: { postId: unmarkedPostId },
      });
      await database.comment.deleteMany({ where: { postId: unmarkedPostId } });
      await database.follow.deleteMany({
        where: { followeeId: unmarkedUserId },
      });
      await database.post.deleteMany({ where: { id: unmarkedPostId } });
      await database.user.deleteMany({ where: { id: unmarkedUserId } });
      if (fixtures) await cleanupE2eFixtures(database, fixtures);
      await database.$disconnect();
    }
  });

  it("planner does not enqueue jobs for unmarked posts/users", async () => {
    await database.botActivityJob.updateMany({
      where: { botAccountId: fixtures.botAccountId, status: "PENDING" },
      data: { status: "CANCELLED", lastError: "neg_isolate" },
    });
    const planner = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "LIKE_POST",
      preferTargetId: unmarkedPostId,
      targetPolicy: "test_fixtures_only",
    });
    const likePlan = await planner.planTick();
    expect(likePlan.enqueued).toBe(0);
    expect(
      await database.botActivityJob.count({
        where: {
          botAccountId: fixtures.botAccountId,
          targetId: unmarkedPostId,
        },
      }),
    ).toBe(0);

    const followPlanner = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "FOLLOW_USER",
      preferTargetId: unmarkedUserId,
      targetPolicy: "test_fixtures_only",
    });
    expect((await followPlanner.planTick()).enqueued).toBe(0);
    expect(
      await database.botActivityJob.count({
        where: {
          botAccountId: fixtures.botAccountId,
          targetId: unmarkedUserId,
        },
      }),
    ).toBe(0);
  });

  it("executor skips unmarked post even if a job was inserted", async () => {
    await database.botActivityJob.updateMany({
      where: { botAccountId: fixtures.botAccountId, status: "PENDING" },
      data: { status: "CANCELLED", lastError: "neg_isolate" },
    });
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: unmarkedPostId,
      idempotencyKey: `${fixtures.runId}:neg:like:${randomUUID()}`,
    });
    const claimed = await claimNextBotActivityJob(database, {
      botAccountId: fixtures.botAccountId,
    });
    expect(claimed?.id).toBe(job.id);
    const result = await services.executor.execute(claimed!);
    expect(result).toEqual({
      outcome: "skipped",
      reason: "target_not_approved_fixture",
    });
    await finishBotActivityJob(
      database,
      claimed!.id,
      "SKIPPED",
      "target_not_approved_fixture",
    );
    expect(
      await database.postLike.count({
        where: { postId: unmarkedPostId, userId: fixtures.botUserId },
      }),
    ).toBe(0);
  });

  it("executor skips unmarked follow target", async () => {
    await database.botActivityJob.updateMany({
      where: { botAccountId: fixtures.botAccountId, status: "PENDING" },
      data: { status: "CANCELLED", lastError: "neg_isolate" },
    });
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "FOLLOW_USER",
      targetType: "user",
      targetId: unmarkedUserId,
      idempotencyKey: `${fixtures.runId}:neg:follow:${randomUUID()}`,
    });
    const claimed = await claimNextBotActivityJob(database, {
      botAccountId: fixtures.botAccountId,
    });
    expect(claimed?.id).toBe(job.id);
    const result = await services.executor.execute(claimed!);
    expect(result).toEqual({
      outcome: "skipped",
      reason: "target_not_approved_fixture",
    });
    await finishBotActivityJob(
      database,
      claimed!.id,
      "SKIPPED",
      "target_not_approved_fixture",
    );
    expect(
      await database.follow.count({
        where: {
          followerId: fixtures.botUserId,
          followeeId: unmarkedUserId,
        },
      }),
    ).toBe(0);
  });

  it("disabled policy blocks even marked fixtures", async () => {
    await database.botActivityJob.updateMany({
      where: { botAccountId: fixtures.botAccountId, status: "PENDING" },
      data: { status: "CANCELLED", lastError: "neg_isolate" },
    });
    const disabledExecutor = createE2eServices(database);
    const { BotActivityExecutor } = await import(
      "../../src/modules/bots/application/bot-activity-executor.js"
    );
    const executor = new BotActivityExecutor({
      database,
      posts: disabledExecutor.posts,
      comments: disabledExecutor.comments,
      follows: disabledExecutor.follows,
      targetPolicy: "disabled",
    });
    const job = await createJob(database, {
      botAccountId: fixtures.botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: fixtures.postId,
      idempotencyKey: `${fixtures.runId}:neg:disabled:${randomUUID()}`,
    });
    const postBody = (
      await database.post.findUniqueOrThrow({
        where: { id: fixtures.postId },
      })
    ).body;
    expect(postBody?.includes(BOTS_TEST_FIXTURE_MARKER)).toBe(true);

    const claimed = await claimNextBotActivityJob(database, {
      botAccountId: fixtures.botAccountId,
    });
    expect(claimed?.id).toBe(job.id);
    const result = await executor.execute(claimed!);
    expect(result).toEqual({
      outcome: "skipped",
      reason: "target_policy_disabled",
    });
    await finishBotActivityJob(
      database,
      claimed!.id,
      "SKIPPED",
      "target_policy_disabled",
    );
  });

  it("planner with disabled policy enqueues nothing", async () => {
    const planner = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "LIKE_POST",
      preferTargetId: fixtures.postId,
      targetPolicy: "disabled",
    });
    expect((await planner.planTick()).enqueued).toBe(0);
  });
});
