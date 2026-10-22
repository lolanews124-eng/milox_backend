/**
 * Proves one LIKE job is enqueued, claimed, and processed exactly once under
 * scheduling + test_fixtures_only — on milox_bots_e2e only.
 *
 * Does not touch milox_live_copy. Skipped unless BOTS_E2E=1.
 *
 *   $env:BOTS_E2E="1"
 *   $env:BOTS_E2E_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/milox_bots_e2e?schema=public"
 *   npx vitest run tests/bots-e2e/bots-schedule-enqueue.e2e.test.ts
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../../src/config/env.js";
import { BotActivityWorker } from "../../src/jobs/bots/bot-activity-worker.js";
import { BotActivityPlanner } from "../../src/modules/bots/application/bot-activity-planner.js";
import { DEFAULT_SCHEDULING } from "../../src/modules/bots/application/bot-scheduling.js";
import { BOTS_TEST_FIXTURE_MARKER } from "../../src/modules/bots/application/bot-target-policy.js";
import { DEFAULT_BOT_PERMISSIONS } from "../../src/modules/bots/application/bot-username.js";
import { createE2eServices } from "./fixtures.js";
import { assertBotsE2eEnabled, assertSafeBotsE2eDatabaseUrl } from "./safety.js";
import { waitUntil } from "./wait.js";

const optedIn = process.env.BOTS_E2E === "1";
const describeE2e = optedIn ? describe : describe.skip;

describeE2e("bots schedule window enqueue + process once", () => {
  let database: PrismaClient;
  let services: ReturnType<typeof createE2eServices>;
  let runId = "";
  let botAccountId = "";
  let botUserId = "";
  let authorUserId = "";
  let postId = "";
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    assertBotsE2eEnabled();
    const safe = assertSafeBotsE2eDatabaseUrl(process.env.BOTS_E2E_DATABASE_URL);
    expect(safe.database).toBe("milox_bots_e2e");

    database = new PrismaClient({
      datasources: { db: { url: safe.url } },
    });
    await database.$connect();
    services = createE2eServices(database);
    runId = `sch_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

    await database.botAccount.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "PAUSED" },
    });
    await database.botActivityJob.updateMany({
      where: { status: "PENDING" },
      data: { status: "CANCELLED", lastError: "schedule_enqueue_isolate" },
    });

    botUserId = randomUUID();
    botAccountId = randomUUID();
    authorUserId = randomUUID();
    postId = randomUUID();
    const botUsername = `${runId}_bot`.slice(0, 32);
    const authorUsername = `${runId}_auth`.slice(0, 32);

    // Always-open window so the test is timezone-stable.
    await database.botSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        killSwitch: false,
        globalPause: false,
        maxConcurrency: 1,
        commentTemplates: [],
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: false,
          followsEnabled: false,
          viewsEnabled: false,
          maxJobsPerTick: 5,
          maxGlobalLikesPerHour: 50,
          plannerIntervalMs: 15_000,
          scheduling: {
            ...DEFAULT_SCHEDULING,
            enabled: true,
            timezone: "UTC",
            likesEnabled: true,
            commentsEnabled: false,
            followsEnabled: false,
            windows: {
              // start===end ⇒ full-day window (timezone-stable for CI).
              morning: {
                enabled: true,
                start: "00:00",
                end: "00:00",
                accountQuota: 10,
                maxJobs: 1,
              },
              afternoon: {
                enabled: false,
                start: "11:00",
                end: "16:00",
                accountQuota: 0,
                maxJobs: 0,
              },
              evening: {
                enabled: false,
                start: "16:00",
                end: "21:00",
                accountQuota: 0,
                maxJobs: 0,
              },
              night: {
                enabled: false,
                start: "21:00",
                end: "06:00",
                accountQuota: 0,
                maxJobs: 0,
              },
            },
          },
        },
      },
      update: {
        killSwitch: false,
        globalPause: false,
        maxConcurrency: 1,
        commentTemplates: [],
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: false,
          followsEnabled: false,
          viewsEnabled: false,
          maxJobsPerTick: 5,
          maxGlobalLikesPerHour: 50,
          plannerIntervalMs: 15_000,
          scheduling: {
            ...DEFAULT_SCHEDULING,
            enabled: true,
            timezone: "UTC",
            likesEnabled: true,
            commentsEnabled: false,
            followsEnabled: false,
            windows: {
              morning: {
                enabled: true,
                start: "00:00",
                end: "00:00",
                accountQuota: 10,
                maxJobs: 1,
              },
              afternoon: {
                enabled: false,
                start: "11:00",
                end: "16:00",
                accountQuota: 0,
                maxJobs: 0,
              },
              evening: {
                enabled: false,
                start: "16:00",
                end: "21:00",
                accountQuota: 0,
                maxJobs: 0,
              },
              night: {
                enabled: false,
                start: "21:00",
                end: "06:00",
                accountQuota: 0,
                maxJobs: 0,
              },
            },
          },
        },
      },
    });

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
        displayName: "Schedule Enqueue Author",
      },
    });
    createdUserIds.push(authorUserId);

    await database.post.create({
      data: {
        id: postId,
        authorId: authorUserId,
        body: `Designated fixture post ${BOTS_TEST_FIXTURE_MARKER}`,
        likeCount: 0,
        commentCount: 0,
      },
    });

    await database.user.create({
      data: {
        id: botUserId,
        username: botUsername,
        usernameNormalized: botUsername.toLowerCase(),
        email: `${runId}_bot@bots-e2e.local`,
        passwordHash: "e2e-not-a-login",
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        status: "ACTIVE",
        role: "USER",
        isAutomatedAccount: true,
        isSystemAccount: false,
        displayName: "Schedule Enqueue Bot",
      },
    });
    createdUserIds.push(botUserId);

    await database.botAccount.create({
      data: {
        id: botAccountId,
        userId: botUserId,
        status: "ACTIVE",
        permissions: {
          ...DEFAULT_BOT_PERMISSIONS,
          commentsEnabled: false,
          followsEnabled: false,
          maxLikesPerDay: 5,
        },
      },
    });
  });

  afterAll(async () => {
    if (!database) return;
    await database.botActivityJob.deleteMany({
      where: { botAccountId },
    });
    await database.postLike.deleteMany({
      where: { OR: [{ postId }, { userId: botUserId }] },
    });
    await database.post.deleteMany({ where: { id: postId } });
    await database.botAccount.deleteMany({ where: { id: botAccountId } });
    await database.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
    await database.$disconnect();
  });

  it("enqueues exactly one LIKE against the fixture post, then processes once", async () => {
    const planner = new BotActivityPlanner(database, {
      targetPolicy: "test_fixtures_only",
      scopeBotAccountId: botAccountId,
      forceActivityType: "LIKE_POST",
      preferTargetId: postId,
    });

    const first = await planner.planTick();
    expect(first.enqueued).toBe(1);

    const pending = await database.botActivityJob.findMany({
      where: { botAccountId, status: "PENDING" },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.activityType).toBe("LIKE_POST");
    expect(pending[0]?.targetId).toBe(postId);
    expect(pending[0]?.idempotencyKey).toBe(`like:${botAccountId}:${postId}`);

    // Idempotent: second planTick must not create a duplicate.
    const second = await planner.planTick();
    expect(second.enqueued).toBe(0);
    expect(
      await database.botActivityJob.count({
        where: { botAccountId, activityType: "LIKE_POST" },
      }),
    ).toBe(1);

    const unmarked = await database.post.count({
      where: {
        id: postId,
        NOT: { body: { contains: BOTS_TEST_FIXTURE_MARKER } },
      },
    });
    expect(unmarked).toBe(0);

    const worker = new BotActivityWorker(
      database,
      { ...services.config, BOTS_WORKER_ENABLED: true } as AppConfig,
      services.posts,
      services.comments,
      services.follows,
      {
        pollMs: 80,
        claimBotAccountId: botAccountId,
        planner: {
          targetPolicy: "test_fixtures_only",
          scopeBotAccountId: botAccountId,
        },
      },
    );
    worker.start();
    await waitUntil(
      async () => {
        const done = await database.botActivityJob.count({
          where: { botAccountId, status: "PROCESSED" },
        });
        return done === 1;
      },
      { label: "schedule enqueue job processed", timeoutMs: 10_000 },
    );
    worker.stop();

    const jobs = await database.botActivityJob.findMany({
      where: { botAccountId },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("PROCESSED");

    const likes = await database.postLike.count({
      where: { postId, userId: botUserId },
    });
    expect(likes).toBe(1);
  });
});

describe("bots schedule enqueue e2e gate", () => {
  it("skips unless BOTS_E2E=1", () => {
    if (!optedIn) {
      expect(optedIn).toBe(false);
    }
  });
});
