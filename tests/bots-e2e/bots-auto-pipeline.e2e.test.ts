/**
 * Automatic pipeline E2E: Planner → job → worker claim → executor → Jobs API.
 * Covers LIKE_POST, COMMENT_POST, and FOLLOW_USER.
 *
 * Database: milox_bots_e2e only (never milox_live_copy).
 * Main .env BOTS_WORKER_ENABLED stays false; worker enabled only in-process.
 *
 * Successful pipeline tests use worker.start() only — no manual job insert,
 * claimNext, or executor.execute.
 *
 * Run:
 *   $env:BOTS_E2E="1"
 *   $env:BOTS_E2E_DATABASE_URL="postgresql://…@127.0.0.1:5432/milox_bots_e2e?schema=public"
 *   npx vitest run tests/bots-e2e/bots-auto-pipeline.e2e.test.ts
 */
import "dotenv/config";

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { PrismaClient, UserRole } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import { BotActivityWorker } from "../../src/jobs/bots/bot-activity-worker.js";
import { CryptoService } from "../../src/modules/auth/application/services/crypto-service.js";
import { BotActivityPlanner } from "../../src/modules/bots/application/bot-activity-planner.js";
import {
  cleanupE2eFixtures,
  createE2eServices,
  seedE2eFixtures,
  type E2eFixtures,
} from "./fixtures.js";
import { assertBotsE2eEnabled, assertSafeBotsE2eDatabaseUrl } from "./safety.js";
import { waitUntil } from "./wait.js";

const optedIn = process.env.BOTS_E2E === "1";
const describeE2e = optedIn ? describe : describe.skip;
const ADMIN_HEADERS = { "X-Client-Platform": "admin" } as const;
const EVIDENCE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "last-auto-pipeline-evidence.json",
);

type ActionType = "LIKE_POST" | "COMMENT_POST" | "FOLLOW_USER";

const COMMENT_TEMPLATE = "E2E approved comment template.";

describeE2e("bots automatic planner → worker pipeline E2E", () => {
  let database: PrismaClient;
  let fixtures: E2eFixtures;
  let services: ReturnType<typeof createE2eServices>;
  let safeDb: { url: string; hostname: string; database: string };
  let app: ReturnType<typeof createApp>;
  let accessToken = "";
  let adminUserId = "";
  const adminEmail = `auto_pipe_admin_${randomUUID().slice(0, 8)}@bots-e2e.local`;
  const adminPassword = "bots-e2e-auto-pipeline-admin-password";

  const evidence: Record<string, unknown> = {
    pipelines: {} as Record<string, unknown>,
  };

  beforeAll(async () => {
    assertBotsE2eEnabled();
    safeDb = assertSafeBotsE2eDatabaseUrl(process.env.BOTS_E2E_DATABASE_URL);
    expect(safeDb.database).toBe("milox_bots_e2e");
    evidence.database = safeDb.database;
    evidence.hostname = safeDb.hostname;

    database = new PrismaClient({
      datasources: { db: { url: safeDb.url } },
    });
    await database.$connect();
    fixtures = await seedE2eFixtures(database);
    services = createE2eServices(database);
    evidence.runId = fixtures.runId;
    evidence.botAccountId = fixtures.botAccountId;
    evidence.botUsername = fixtures.botUsername;

    await database.botAccount.updateMany({
      where: { status: "ACTIVE", id: { not: fixtures.botAccountId } },
      data: { status: "PAUSED" },
    });
    await database.botActivityJob.updateMany({
      where: { status: "PENDING" },
      data: { status: "CANCELLED", lastError: "auto_pipeline_isolate" },
    });

    const config = {
      NODE_ENV: "development",
      PORT: 3011,
      DATABASE_URL: safeDb.url,
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_WEB_ORIGIN: "http://localhost:3000",
      ADMIN_ORIGIN: "http://localhost:3002",
      BOTS_ORIGIN: "http://localhost:3003",
      MILOX_ENV: "test",
      BOTS_WORKER_ENABLED: false,
      BOTS_ALLOW_MUTATIONS: false,
      BOTS_TARGET_POLICY: "test_fixtures_only",
      CORS_ORIGINS: [],
      API_PUBLIC_URL: "http://localhost:3011",
      UPLOAD_ROOT: "./uploads-bots-e2e-auto",
      JWT_ACCESS_SECRET: "bots-e2e-auto-jwt-access-secret-32chars",
      CURSOR_SIGNING_SECRET: "bots-e2e-auto-cursor-signing-secret-32",
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_ISSUER: "milox-api",
      JWT_AUDIENCE: "milox-clients",
      REFRESH_TOKEN_TTL_DAYS: 30,
      EMAIL_VERIFICATION_TTL_HOURS: 24,
      AUTO_VERIFY_EMAIL: true,
      PASSWORD_RESET_TTL_MINUTES: 30,
      EMAIL_WORKER_POLL_MS: 5_000,
      FEED_SCORE_POLL_MS: 300_000,
      SUBSCRIPTION_EXPIRY_POLL_MS: 300_000,
      INTEREST_DAILY_LIMIT: 20,
      FREE_DAILY_INTEREST_GRANTS: 10,
      WALLET_WELCOME_BONUS: 0,
      REFERRAL_REWARD_POINTS: 0,
      POST_REWARD_POINTS: 0,
      POST_COOLDOWN_SECONDS: 45,
      POST_BURST_LIMIT: 3,
      POST_BURST_WINDOW_SECONDS: 600,
      POST_HOURLY_LIMIT: 12,
      POST_DUPLICATE_WINDOW_SECONDS: 3600,
      INTEREST_SEND_COST: 40,
      REWARDED_AD_POINTS: 20,
      REWARDED_AD_DAILY_LIMIT: 10,
      DAILY_CHECK_IN_POINTS: 25,
      DAILY_CHECK_IN_TIMEZONE: "Asia/Kolkata",
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      PAYPAL_MODE: "sandbox",
      PAYPAL_WEBHOOK_ID: "",
      CHAT_OUTBOX_POLL_MS: 500,
      NOTIFICATION_OUTBOX_POLL_MS: 500,
      GOOGLE_APPLICATION_CREDENTIALS: "",
      STUN_URLS: "",
      TURN_URLS: "",
      TURN_SECRET: "",
      TURN_USERNAME: "",
      TURN_PASSWORD: "",
      TURN_CREDENTIAL_TTL_SEC: 86_400,
      SMTP_HOST: "",
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      EMAIL_FROM: "no-reply@bots-e2e.local",
    } as unknown as AppConfig;

    const crypto = new CryptoService(config);
    adminUserId = randomUUID();
    const adminUsername = `apadm_${adminUserId.replace(/-/g, "").slice(0, 8)}`;
    await database.user.create({
      data: {
        id: adminUserId,
        username: adminUsername,
        usernameNormalized: adminUsername.toLowerCase(),
        email: adminEmail,
        passwordHash: await crypto.hashPassword(adminPassword),
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        role: UserRole.ADMIN,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        isAutomatedAccount: false,
        isSystemAccount: false,
      },
    });
    app = createApp({ config, database });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set(ADMIN_HEADERS)
      .send({ email: adminEmail, password: adminPassword });
    expect(login.status).toBe(200);
    accessToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2), "utf8");
    console.info(`[auto-pipeline] evidence → ${EVIDENCE_PATH}`);
    console.info(JSON.stringify(evidence, null, 2));
    if (database && fixtures) {
      await cleanupE2eFixtures(database, fixtures);
    }
    if (database && adminUserId) {
      await database.user.deleteMany({ where: { id: adminUserId } });
    }
    await database?.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false, globalPause: false },
    });
    await database?.$disconnect();
  });

  async function configureForAction(action: ActionType): Promise<{
    preferTargetId: string;
    expectedKey: string;
  }> {
    await database.botActivityJob.updateMany({
      where: { botAccountId: fixtures.botAccountId, status: "PENDING" },
      data: { status: "CANCELLED", lastError: "auto_pipeline_reconfigure" },
    });
    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: { status: "ACTIVE" },
    });
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false, globalPause: false },
    });

    if (action === "LIKE_POST") {
      await database.botAccount.update({
        where: { id: fixtures.botAccountId },
        data: {
          permissions: {
            likesEnabled: true,
            commentsEnabled: false,
            followsEnabled: false,
            viewsEnabled: false,
            maxLikesPerDay: 1,
            maxCommentsPerDay: 0,
            maxFollowsPerDay: 0,
          },
        },
      });
      await database.botSettings.update({
        where: { id: "default" },
        data: {
          maxConcurrency: 1,
          commentTemplates: [COMMENT_TEMPLATE],
          activityLimits: {
            likesEnabled: true,
            commentsEnabled: false,
            followsEnabled: false,
            viewsEnabled: false,
            maxJobsPerTick: 1,
            maxGlobalLikesPerHour: 5,
            maxGlobalCommentsPerHour: 0,
            maxGlobalFollowsPerHour: 0,
            plannerIntervalMs: 15_000,
          },
        },
      });
      return {
        preferTargetId: fixtures.postId,
        expectedKey: `like:${fixtures.botAccountId}:${fixtures.postId}`,
      };
    }

    if (action === "COMMENT_POST") {
      await database.botAccount.update({
        where: { id: fixtures.botAccountId },
        data: {
          permissions: {
            likesEnabled: false,
            commentsEnabled: true,
            followsEnabled: false,
            viewsEnabled: false,
            maxLikesPerDay: 0,
            maxCommentsPerDay: 1,
            maxFollowsPerDay: 0,
          },
        },
      });
      await database.botSettings.update({
        where: { id: "default" },
        data: {
          maxConcurrency: 1,
          commentTemplates: [COMMENT_TEMPLATE],
          activityLimits: {
            likesEnabled: false,
            commentsEnabled: true,
            followsEnabled: false,
            viewsEnabled: false,
            maxJobsPerTick: 1,
            maxGlobalLikesPerHour: 0,
            maxGlobalCommentsPerHour: 5,
            maxGlobalFollowsPerHour: 0,
            plannerIntervalMs: 15_000,
          },
        },
      });
      return {
        preferTargetId: fixtures.postId,
        expectedKey: `comment:${fixtures.botAccountId}:${fixtures.postId}`,
      };
    }

    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: {
        permissions: {
          likesEnabled: false,
          commentsEnabled: false,
          followsEnabled: true,
          viewsEnabled: false,
          maxLikesPerDay: 0,
          maxCommentsPerDay: 0,
          maxFollowsPerDay: 1,
        },
      },
    });
    await database.botSettings.update({
      where: { id: "default" },
      data: {
        maxConcurrency: 1,
        commentTemplates: [COMMENT_TEMPLATE],
        activityLimits: {
          likesEnabled: false,
          commentsEnabled: false,
          followsEnabled: true,
          viewsEnabled: false,
          maxJobsPerTick: 1,
          maxGlobalLikesPerHour: 0,
          maxGlobalCommentsPerHour: 0,
          maxGlobalFollowsPerHour: 5,
          plannerIntervalMs: 15_000,
        },
      },
    });
    return {
      preferTargetId: fixtures.followTargetUserId,
      expectedKey: `follow:${fixtures.botAccountId}:${fixtures.followTargetUserId}`,
    };
  }

  function enabledWorker(
    action: ActionType,
    preferTargetId: string,
    extra: ConstructorParameters<typeof BotActivityWorker>[5] = {},
  ) {
    return new BotActivityWorker(
      database,
      { ...services.config, BOTS_WORKER_ENABLED: true } as AppConfig,
      services.posts,
      services.comments,
      services.follows,
      {
        pollMs: 100,
        claimBotAccountId: fixtures.botAccountId,
        planner: {
          scopeBotAccountId: fixtures.botAccountId,
          forceActivityType: action,
          preferTargetId,
        },
        ...extra,
      },
    );
  }

  async function assertJobsApi(
    jobId: string,
    activityType: ActionType,
    targetId: string,
  ) {
    const jobsRes = await request(app)
      .get(
        `/api/v1/admin/bots/jobs?limit=50&botAccountId=${fixtures.botAccountId}&activityType=${activityType}`,
      )
      .set(ADMIN_HEADERS)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(jobsRes.status).toBe(200);
    const apiJob = (
      jobsRes.body.data.items as Array<Record<string, unknown>>
    ).find((j) => j.id === jobId);
    expect(apiJob).toMatchObject({
      id: jobId,
      botUsername: fixtures.botUsername,
      activityType,
      targetId,
      status: "PROCESSED",
    });
    expect(apiJob!.attempts).toBeGreaterThanOrEqual(1);
    return apiJob;
  }

  it("LIKE_POST: worker plans → claims → executes; no duplicate domain row", async () => {
    const { preferTargetId, expectedKey } = await configureForAction("LIKE_POST");
    expect(
      await database.botActivityJob.count({
        where: { idempotencyKey: expectedKey },
      }),
    ).toBe(0);

    const beforePost = await database.post.findUniqueOrThrow({
      where: { id: fixtures.postId },
      select: { likeCount: true },
    });

    const worker = enabledWorker("LIKE_POST", preferTargetId);
    worker.start();
    await waitUntil(
      async () => {
        const row = await database.botActivityJob.findFirst({
          where: { idempotencyKey: expectedKey },
        });
        return (
          row != null &&
          (row.status === "PROCESSED" || row.status === "SKIPPED")
        );
      },
      { label: "like pipeline terminal", timeoutMs: 8_000 },
    );
    worker.stop();

    const row = await database.botActivityJob.findFirstOrThrow({
      where: { idempotencyKey: expectedKey },
    });
    expect(row.status).toBe("PROCESSED");
    expect(row.activityType).toBe("LIKE_POST");
    expect(row.targetId).toBe(fixtures.postId);

    expect(
      await database.postLike.count({
        where: { postId: fixtures.postId, userId: fixtures.botUserId },
      }),
    ).toBe(1);
    const afterPost = await database.post.findUniqueOrThrow({
      where: { id: fixtures.postId },
      select: { likeCount: true },
    });
    expect(afterPost.likeCount).toBe(beforePost.likeCount + 1);

    const planner = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "LIKE_POST",
      preferTargetId,
      targetPolicy: "test_fixtures_only",
    });
    expect((await planner.planTick()).enqueued).toBe(0);
    expect(
      await database.botActivityJob.count({
        where: { idempotencyKey: expectedKey },
      }),
    ).toBe(1);

    const apiJob = await assertJobsApi(row.id, "LIKE_POST", fixtures.postId);
    (evidence.pipelines as Record<string, unknown>).like = {
      jobId: row.id,
      idempotencyKey: expectedKey,
      status: row.status,
      totalLikeCountBefore: beforePost.likeCount,
      totalLikeCountAfter: afterPost.likeCount,
      domainLikes: 1,
      jobsApiSample: apiJob,
    };
  });

  it("COMMENT_POST: worker plans → claims → executes; no duplicate comment", async () => {
    const { preferTargetId, expectedKey } =
      await configureForAction("COMMENT_POST");
    expect(
      await database.botActivityJob.count({
        where: { idempotencyKey: expectedKey },
      }),
    ).toBe(0);

    const beforePost = await database.post.findUniqueOrThrow({
      where: { id: fixtures.postId },
      select: { commentCount: true },
    });

    const worker = enabledWorker("COMMENT_POST", preferTargetId);
    worker.start();
    await waitUntil(
      async () => {
        const row = await database.botActivityJob.findFirst({
          where: { idempotencyKey: expectedKey },
        });
        return (
          row != null &&
          (row.status === "PROCESSED" || row.status === "SKIPPED")
        );
      },
      { label: "comment pipeline terminal", timeoutMs: 8_000 },
    );
    worker.stop();

    const row = await database.botActivityJob.findFirstOrThrow({
      where: { idempotencyKey: expectedKey },
    });
    expect(row.status).toBe("PROCESSED");
    expect(row.activityType).toBe("COMMENT_POST");
    expect(row.targetId).toBe(fixtures.postId);

    const comments = await database.comment.findMany({
      where: {
        postId: fixtures.postId,
        authorId: fixtures.botUserId,
        deletedAt: null,
      },
      select: { id: true, body: true },
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toBe(COMMENT_TEMPLATE);

    const afterPost = await database.post.findUniqueOrThrow({
      where: { id: fixtures.postId },
      select: { commentCount: true },
    });
    expect(afterPost.commentCount).toBe(beforePost.commentCount + 1);

    const planner = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "COMMENT_POST",
      preferTargetId,
      targetPolicy: "test_fixtures_only",
    });
    expect((await planner.planTick()).enqueued).toBe(0);
    expect(
      await database.comment.count({
        where: {
          postId: fixtures.postId,
          authorId: fixtures.botUserId,
          deletedAt: null,
        },
      }),
    ).toBe(1);

    const apiJob = await assertJobsApi(
      row.id,
      "COMMENT_POST",
      fixtures.postId,
    );
    (evidence.pipelines as Record<string, unknown>).comment = {
      jobId: row.id,
      idempotencyKey: expectedKey,
      status: row.status,
      commentId: comments[0]!.id,
      commentBody: comments[0]!.body,
      totalCommentCountBefore: beforePost.commentCount,
      totalCommentCountAfter: afterPost.commentCount,
      jobsApiSample: apiJob,
    };
  });

  it("FOLLOW_USER: worker plans → claims → executes; no duplicate follow", async () => {
    const { preferTargetId, expectedKey } =
      await configureForAction("FOLLOW_USER");
    expect(
      await database.botActivityJob.count({
        where: { idempotencyKey: expectedKey },
      }),
    ).toBe(0);
    expect(
      await database.follow.count({
        where: {
          followerId: fixtures.botUserId,
          followeeId: fixtures.followTargetUserId,
        },
      }),
    ).toBe(0);

    const beforeBot = await database.user.findUniqueOrThrow({
      where: { id: fixtures.botUserId },
      select: { followingCount: true },
    });
    const beforeTarget = await database.user.findUniqueOrThrow({
      where: { id: fixtures.followTargetUserId },
      select: { followerCount: true },
    });

    const worker = enabledWorker("FOLLOW_USER", preferTargetId);
    worker.start();
    await waitUntil(
      async () => {
        const row = await database.botActivityJob.findFirst({
          where: { idempotencyKey: expectedKey },
        });
        return (
          row != null &&
          (row.status === "PROCESSED" || row.status === "SKIPPED")
        );
      },
      { label: "follow pipeline terminal", timeoutMs: 8_000 },
    );
    worker.stop();

    const row = await database.botActivityJob.findFirstOrThrow({
      where: { idempotencyKey: expectedKey },
    });
    expect(row.status).toBe("PROCESSED");
    expect(row.activityType).toBe("FOLLOW_USER");
    expect(row.targetId).toBe(fixtures.followTargetUserId);

    const follows = await database.follow.findMany({
      where: {
        followerId: fixtures.botUserId,
        followeeId: fixtures.followTargetUserId,
        status: "ACTIVE",
      },
    });
    expect(follows).toHaveLength(1);

    const afterBot = await database.user.findUniqueOrThrow({
      where: { id: fixtures.botUserId },
      select: { followingCount: true },
    });
    const afterTarget = await database.user.findUniqueOrThrow({
      where: { id: fixtures.followTargetUserId },
      select: { followerCount: true },
    });
    expect(afterBot.followingCount).toBe(beforeBot.followingCount + 1);
    expect(afterTarget.followerCount).toBe(beforeTarget.followerCount + 1);

    const planner = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "FOLLOW_USER",
      preferTargetId,
      targetPolicy: "test_fixtures_only",
    });
    expect((await planner.planTick()).enqueued).toBe(0);
    expect(follows.length).toBe(1);

    const apiJob = await assertJobsApi(
      row.id,
      "FOLLOW_USER",
      fixtures.followTargetUserId,
    );
    (evidence.pipelines as Record<string, unknown>).follow = {
      jobId: row.id,
      idempotencyKey: expectedKey,
      status: row.status,
      followId: follows[0]!.id,
      followStatus: follows[0]!.status,
      totalFollowingBefore: beforeBot.followingCount,
      totalFollowingAfter: afterBot.followingCount,
      totalFollowersBefore: beforeTarget.followerCount,
      totalFollowersAfter: afterTarget.followerCount,
      jobsApiSample: apiJob,
    };
  });

  it("worker disabled means tick is a no-op", async () => {
    await configureForAction("LIKE_POST");
    const pending = await database.botActivityJob.create({
      data: {
        botAccountId: fixtures.botAccountId,
        activityType: "LIKE_POST",
        targetType: "post",
        targetId: fixtures.postId,
        status: "PENDING",
        idempotencyKey: `${fixtures.runId}:disabled-check:${randomUUID()}`,
        metadata: {},
      },
    });
    const worker = new BotActivityWorker(
      database,
      { ...services.config, BOTS_WORKER_ENABLED: false } as AppConfig,
      services.posts,
      services.comments,
      services.follows,
      { pollMs: 100, claimBotAccountId: fixtures.botAccountId },
    );
    worker.start();
    expect(worker.isTimerActive()).toBe(false);
    await worker.tick();
    const row = await database.botActivityJob.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(row.status).toBe("PENDING");
    worker.stop();
    await database.botActivityJob.delete({ where: { id: pending.id } });
  });

  it("global pause prevents planning for comment and follow", async () => {
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false, globalPause: true },
    });
    for (const action of ["COMMENT_POST", "FOLLOW_USER"] as const) {
      const prefer =
        action === "COMMENT_POST"
          ? fixtures.postId
          : fixtures.followTargetUserId;
      const planner = new BotActivityPlanner(database, {
        scopeBotAccountId: fixtures.botAccountId,
        forceActivityType: action,
        preferTargetId: prefer,
        targetPolicy: "test_fixtures_only",
      });
      expect((await planner.planTick()).enqueued).toBe(0);
    }
    await database.botSettings.update({
      where: { id: "default" },
      data: { globalPause: false },
    });
  });

  it("kill switch prevents planning", async () => {
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: true, globalPause: false },
    });
    const planner = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "FOLLOW_USER",
      preferTargetId: fixtures.followTargetUserId,
      targetPolicy: "test_fixtures_only",
    });
    expect((await planner.planTick()).enqueued).toBe(0);
    await database.botSettings.update({
      where: { id: "default" },
      data: { killSwitch: false },
    });
  });

  it("paused bot is skipped by planner", async () => {
    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: { status: "PAUSED" },
    });
    const planner = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "COMMENT_POST",
      preferTargetId: fixtures.postId,
      targetPolicy: "test_fixtures_only",
    });
    expect((await planner.planTick()).enqueued).toBe(0);
    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: { status: "ACTIVE" },
    });
  });

  it("activity toggles and daily limits block further enqueue", async () => {
    // Comments already used maxCommentsPerDay=1 in comment pipeline.
    await configureForAction("COMMENT_POST");
    // Re-apply after configure (which resets maxCommentsPerDay:1) — bump usage
    // by ensuring a PROCESSED comment job exists (from prior test) and cap=1.
    const plannerComment = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "COMMENT_POST",
      preferTargetId: fixtures.postId,
      targetPolicy: "test_fixtures_only",
    });
    // Idempotency: same post already has comment job key → enqueued 0.
    expect((await plannerComment.planTick()).enqueued).toBe(0);

    // Follow daily limit after successful follow.
    await configureForAction("FOLLOW_USER");
    const plannerFollow = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "FOLLOW_USER",
      preferTargetId: fixtures.followTargetUserId,
      targetPolicy: "test_fixtures_only",
    });
    expect((await plannerFollow.planTick()).enqueued).toBe(0);

    // Toggle: comments disabled globally → no comment planning even with fresh post.
    const extraPostId = randomUUID();
    await database.post.create({
      data: {
        id: extraPostId,
        authorId: fixtures.authorUserId,
        body: "E2E toggle-check post — fixture only.",
        likeCount: 0,
        commentCount: 0,
      },
    });
    await database.botAccount.update({
      where: { id: fixtures.botAccountId },
      data: {
        permissions: {
          likesEnabled: false,
          commentsEnabled: true,
          followsEnabled: false,
          viewsEnabled: false,
          maxLikesPerDay: 0,
          maxCommentsPerDay: 5,
          maxFollowsPerDay: 0,
        },
      },
    });
    await database.botSettings.update({
      where: { id: "default" },
      data: {
        killSwitch: false,
        globalPause: false,
        commentTemplates: [COMMENT_TEMPLATE],
        activityLimits: {
          likesEnabled: false,
          commentsEnabled: false,
          followsEnabled: false,
          viewsEnabled: false,
          maxJobsPerTick: 1,
          maxGlobalLikesPerHour: 0,
          maxGlobalCommentsPerHour: 5,
          maxGlobalFollowsPerHour: 0,
          plannerIntervalMs: 15_000,
        },
      },
    });
    const plannerToggle = new BotActivityPlanner(database, {
      scopeBotAccountId: fixtures.botAccountId,
      forceActivityType: "COMMENT_POST",
      preferTargetId: extraPostId,
      targetPolicy: "test_fixtures_only",
    });
    expect((await plannerToggle.planTick()).enqueued).toBe(0);
    await database.post.delete({ where: { id: extraPostId } });
  });

  it("worker stop prevents further scheduling", async () => {
    const { preferTargetId } = await configureForAction("LIKE_POST");
    const worker = enabledWorker("LIKE_POST", preferTargetId);
    worker.start();
    expect(worker.isTimerActive()).toBe(true);
    const ticks = worker.getTickCount();
    worker.stop();
    expect(worker.isTimerActive()).toBe(false);
    await new Promise((r) => setTimeout(r, 250));
    expect(worker.getTickCount()).toBe(ticks);
  });
});
