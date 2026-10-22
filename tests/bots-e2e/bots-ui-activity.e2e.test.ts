/**
 * Practical UI→Activity Jobs verification against milox_bots_e2e only.
 *
 * - Provisions exactly one bot via the real candidates → provision HTTP API
 * - Creates one fixture author + post
 * - Executes one LIKE_POST and one COMMENT_POST through the real worker path
 * - Asserts domain persistence + organic counters + jobs list API (dashboard contract)
 *
 * Does not change main .env. Worker enabled only inside this process.
 *
 * Run:
 *   $env:BOTS_E2E="1"
 *   $env:BOTS_E2E_DATABASE_URL="postgresql://…@127.0.0.1:5432/milox_bots_e2e?schema=public"
 *   npx vitest run tests/bots-e2e/bots-ui-activity.e2e.test.ts
 */
import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
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
import { isValidBotUsername } from "../../src/modules/bots/application/bot-username.js";
import {
  createE2eServices,
  createJob,
} from "./fixtures.js";
import { assertBotsE2eEnabled, assertSafeBotsE2eDatabaseUrl } from "./safety.js";
import { waitUntil } from "./wait.js";

const optedIn = process.env.BOTS_E2E === "1";
const describeE2e = optedIn ? describe : describe.skip;
const ADMIN_HEADERS = { "X-Client-Platform": "admin" } as const;
const KEEP = process.env.BOTS_E2E_KEEP_EVIDENCE === "1";
const EVIDENCE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "last-ui-activity-evidence.json",
);

type Evidence = {
  database: string;
  hostname: string;
  runId: string;
  sourceCandidateUserId: string;
  authorUserId: string;
  postId: string;
  botAccountId: string;
  botUserId: string;
  botUsername: string;
  botStatusAfterProvision: string;
  botStatusAfterActivate: string;
  likeJobId: string;
  commentJobId: string;
  likeJobStatus: string;
  commentJobStatus: string;
  likeCount: number;
  commentCount: number;
  organicLikeCount: number;
  organicCommentCount: number;
  jobsApiItems: unknown[];
  duplicateLikeStillOne: boolean;
  browserUiVerified: false;
  workerEnabledInMainEnv: boolean;
  note: string;
};

describeE2e("bots UI→activity practical verification", () => {
  let database: PrismaClient;
  let app: ReturnType<typeof createApp>;
  let services: ReturnType<typeof createE2eServices>;
  let accessToken = "";
  let adminUserId = "";
  let safeDb: { url: string; hostname: string; database: string };

  const runId = `uiv_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const sourceCandidateUserId = randomUUID();
  const authorUserId = randomUUID();
  const postId = randomUUID();
  const adminEmail = `ui_activity_admin_${runId}@bots-e2e.local`;
  const adminPassword = "bots-e2e-ui-activity-admin-password";

  let botAccountId = "";
  let botUserId = "";
  let botUsername = "";
  let likeJobId = "";
  let commentJobId = "";
  let evidence: Evidence | null = null;

  beforeAll(async () => {
    assertBotsE2eEnabled();
    safeDb = assertSafeBotsE2eDatabaseUrl(process.env.BOTS_E2E_DATABASE_URL);
    expect(safeDb.database).toBe("milox_bots_e2e");
    expect(safeDb.hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);

    database = new PrismaClient({
      datasources: { db: { url: safeDb.url } },
    });
    await database.$connect();

    const config = {
      NODE_ENV: "development",
      PORT: 3011,
      DATABASE_URL: safeDb.url,
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_WEB_ORIGIN: "http://localhost:3000",
      ADMIN_ORIGIN: "http://localhost:3002",
      BOTS_ORIGIN: "http://localhost:3003",
      MILOX_ENV: "local",
      BOTS_WORKER_ENABLED: false,
      BOTS_ALLOW_MUTATIONS: false,
      CORS_ORIGINS: [],
      API_PUBLIC_URL: "http://localhost:3011",
      UPLOAD_ROOT: "./uploads-bots-e2e-ui",
      JWT_ACCESS_SECRET: "bots-e2e-ui-jwt-access-secret-32chars",
      CURSOR_SIGNING_SECRET: "bots-e2e-ui-cursor-signing-secret-32",
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
    const adminUsername = `uia_${adminUserId.replace(/-/g, "").slice(0, 8)}`;
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

    // Source candidate (human) — inspiration only; never converted.
    const sourceUsername = `${runId}_src`.slice(0, 32);
    await database.user.create({
      data: {
        id: sourceCandidateUserId,
        username: sourceUsername,
        usernameNormalized: sourceUsername.toLowerCase(),
        email: `${runId}_source@bots-e2e.local`,
        passwordHash: "e2e-not-a-login-hash",
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        status: "ACTIVE",
        role: "USER",
        isAutomatedAccount: false,
        isSystemAccount: false,
        displayName: "E2E Source Candidate",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        lastSeenAt: null,
      },
    });

    // Dedicated test author + post (fixture set only).
    const authorUsername = `${runId}_auth`.slice(0, 32);
    await database.user.create({
      data: {
        id: authorUserId,
        username: authorUsername,
        usernameNormalized: authorUsername.toLowerCase(),
        email: `${runId}_author@bots-e2e.local`,
        passwordHash: "e2e-not-a-login-hash",
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        status: "ACTIVE",
        role: "USER",
        isAutomatedAccount: false,
        isSystemAccount: false,
        displayName: "E2E UI Activity Author",
      },
    });
    await database.post.create({
      data: {
        id: postId,
        authorId: authorUserId,
        body: "E2E UI activity target post — fixture only, not a real user post.",
        likeCount: 0,
        commentCount: 0,
      },
    });

    await database.botSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        killSwitch: false,
        globalPause: false,
        maxConcurrency: 2,
        commentTemplates: ["E2E approved neutral comment."],
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: false,
          viewsEnabled: false,
          maxJobsPerTick: 2,
          maxGlobalLikesPerHour: 10,
          maxGlobalCommentsPerHour: 10,
          maxGlobalFollowsPerHour: 0,
          plannerIntervalMs: 3_600_000,
        },
      },
      update: {
        killSwitch: false,
        globalPause: false,
        commentTemplates: ["E2E approved neutral comment."],
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: false,
          viewsEnabled: false,
          maxJobsPerTick: 2,
          maxGlobalLikesPerHour: 10,
          maxGlobalCommentsPerHour: 10,
          maxGlobalFollowsPerHour: 0,
          plannerIntervalMs: 3_600_000,
        },
      },
    });

    app = createApp({ config, database });
    services = createE2eServices(database);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .set(ADMIN_HEADERS)
      .send({ email: adminEmail, password: adminPassword });
    expect(login.status).toBe(200);
    accessToken = login.body.data.accessToken as string;
  });

  afterAll(async () => {
    if (evidence) {
      mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
      writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2), "utf8");
      console.info(`[bots-e2e-ui] evidence written: ${EVIDENCE_PATH}`);
      console.info(JSON.stringify(evidence, null, 2));
    }

    if (!KEEP && database) {
      if (botAccountId) {
        await database.botActivityJob.deleteMany({
          where: { botAccountId },
        });
        await database.postLike.deleteMany({
          where: { OR: [{ userId: botUserId }, { postId }] },
        });
        await database.comment.deleteMany({
          where: { OR: [{ authorId: botUserId }, { postId }] },
        });
        await database.botAccount.deleteMany({ where: { id: botAccountId } });
        if (botUserId) {
          await database.user.deleteMany({ where: { id: botUserId } });
        }
      }
      await database.post.deleteMany({ where: { id: postId } });
      await database.user.deleteMany({
        where: {
          id: {
            in: [sourceCandidateUserId, authorUserId, adminUserId].filter(
              Boolean,
            ),
          },
        },
      });
    } else if (KEEP) {
      console.info(
        "[bots-e2e-ui] BOTS_E2E_KEEP_EVIDENCE=1 — fixture rows left in milox_bots_e2e for dashboard inspection",
      );
    }
    await database?.$disconnect();
  });

  function auth(method: "get" | "post" | "patch", path: string, body?: object) {
    const req = request(app)
      [method](path)
      .set(ADMIN_HEADERS)
      .set("Authorization", `Bearer ${accessToken}`);
    return body !== undefined ? req.send(body) : req;
  }

  it("provisions exactly one automated bot via real API and activates it", async () => {
    const preview = await auth("post", "/api/v1/admin/bots/candidates/preview", {
      limit: 20,
      persist: true,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data.batchId).toBeTruthy();
    const batchId = preview.body.data.batchId as string;
    const candidateIds = (preview.body.data.candidates as { id: string }[]).map(
      (c) => c.id,
    );
    expect(candidateIds).toContain(sourceCandidateUserId);

    const lock = await auth(
      "patch",
      `/api/v1/admin/bots/candidates/batches/${batchId}/selection`,
      { selectedUserIds: [sourceCandidateUserId] },
    );
    expect(lock.status).toBe(200);
    expect(lock.body.data.status).toBe("SELECTION_LOCKED");

    const provision = await auth(
      "post",
      `/api/v1/admin/bots/candidates/batches/${batchId}/provision`,
      {
        dryRun: false,
        confirm: true,
        confirmPhrase: "PROVISION",
        limit: 1,
      },
    );
    expect(provision.status).toBe(200);
    expect(provision.body.data.created).toBe(true);
    expect(provision.body.data.createdCount).toBe(1);
    expect(provision.body.data.createdAccounts).toHaveLength(1);

    const created = provision.body.data.createdAccounts[0] as {
      botAccountId: string;
      userId: string;
      username: string;
    };
    botAccountId = created.botAccountId;
    botUserId = created.userId;
    botUsername = created.username;

    expect(isValidBotUsername(botUsername)).toBe(true);

    const user = await database.user.findUniqueOrThrow({
      where: { id: botUserId },
    });
    expect(user.isAutomatedAccount).toBe(true);
    expect(user.username).toBe(botUsername);

    const bot = await database.botAccount.findUniqueOrThrow({
      where: { id: botAccountId },
    });
    expect(bot.status).toBe("ACTIVE");
    expect(bot.sourceCandidateUserId).toBe(sourceCandidateUserId);

    const activate = await auth("patch", `/api/v1/admin/bots/${botAccountId}`, {
      status: "ACTIVE",
      permissions: {
        likesEnabled: true,
        commentsEnabled: true,
        followsEnabled: false,
        viewsEnabled: false,
        maxLikesPerDay: 2,
        maxCommentsPerDay: 2,
        maxFollowsPerDay: 0,
      },
    });
    expect(activate.status).toBe(200);
    expect(activate.body.data.status).toBe("ACTIVE");

    const post = await database.post.findUniqueOrThrow({
      where: { id: postId },
      select: { id: true, authorId: true, body: true },
    });
    expect(post.authorId).toBe(authorUserId);
    expect(post.body).toContain("fixture only");
  });

  it("executes one real like and one real comment via worker; jobs API matches dashboard", async () => {
    expect(botAccountId).toBeTruthy();

    // Prevent unrelated work from executing.
    await database.botActivityJob.updateMany({
      where: { status: "PENDING" },
      data: { status: "CANCELLED", lastError: "e2e_ui_isolate" },
    });
    await database.botSettings.update({
      where: { id: "default" },
      data: {
        killSwitch: false,
        globalPause: false,
        commentTemplates: ["E2E approved neutral comment."],
        activityLimits: {
          likesEnabled: true,
          commentsEnabled: true,
          followsEnabled: false,
          viewsEnabled: false,
          maxJobsPerTick: 0,
          maxGlobalLikesPerHour: 10,
          maxGlobalCommentsPerHour: 10,
          maxGlobalFollowsPerHour: 0,
          plannerIntervalMs: 3_600_000,
        },
      },
    });

    const likeJob = await createJob(database, {
      botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${runId}:like:1`,
    });
    const commentJob = await createJob(database, {
      botAccountId,
      activityType: "COMMENT_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${runId}:comment:1`,
      metadata: { body: "E2E approved neutral comment." },
    });
    likeJobId = likeJob.id;
    commentJobId = commentJob.id;

    const worker = new BotActivityWorker(
      database,
      {
        ...services.config,
        BOTS_WORKER_ENABLED: true,
      } as AppConfig,
      services.posts,
      services.comments,
      services.follows,
      { pollMs: 100 },
    );
    worker.start();

    await waitUntil(
      async () => {
        const rows = await database.botActivityJob.findMany({
          where: { id: { in: [likeJobId, commentJobId] } },
        });
        return rows.every((r) =>
          ["PROCESSED", "SKIPPED", "FAILED", "CANCELLED"].includes(r.status),
        );
      },
      { label: "like+comment terminal", timeoutMs: 8_000 },
    );
    worker.stop();
    expect(worker.isTimerActive()).toBe(false);

    const likeRow = await database.botActivityJob.findUniqueOrThrow({
      where: { id: likeJobId },
    });
    const commentRow = await database.botActivityJob.findUniqueOrThrow({
      where: { id: commentJobId },
    });
    expect(likeRow.status).toBe("PROCESSED");
    expect(commentRow.status).toBe("PROCESSED");
    expect(likeRow.attempts).toBeGreaterThanOrEqual(1);
    expect(commentRow.attempts).toBeGreaterThanOrEqual(1);
    expect(likeRow.processedAt).toBeTruthy();
    expect(commentRow.processedAt).toBeTruthy();

    const likes = await database.postLike.findMany({
      where: { postId, userId: botUserId },
    });
    expect(likes).toHaveLength(1);

    const comments = await database.comment.findMany({
      where: { postId, authorId: botUserId, deletedAt: null },
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toBe("E2E approved neutral comment.");

    const post = await database.post.findUniqueOrThrow({
      where: { id: postId },
      select: { likeCount: true, commentCount: true },
    });
    expect(post.likeCount).toBe(0);
    expect(post.commentCount).toBe(0);

    // Idempotent: second like job must not create a duplicate like.
    const likeAgain = await createJob(database, {
      botAccountId,
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      idempotencyKey: `${runId}:like:2`,
    });
    const worker2 = new BotActivityWorker(
      database,
      {
        ...services.config,
        BOTS_WORKER_ENABLED: true,
      } as AppConfig,
      services.posts,
      services.comments,
      services.follows,
      { pollMs: 100 },
    );
    worker2.start();
    await waitUntil(
      async () => {
        const row = await database.botActivityJob.findUnique({
          where: { id: likeAgain.id },
        });
        return ["PROCESSED", "SKIPPED"].includes(row?.status ?? "");
      },
      { label: "duplicate like settles", timeoutMs: 5_000 },
    );
    worker2.stop();

    const likesAfter = await database.postLike.count({
      where: { postId, userId: botUserId },
    });
    expect(likesAfter).toBe(1);

    // Same HTTP contract the Activity Jobs page uses.
    const jobsRes = await auth(
      "get",
      `/api/v1/admin/bots/jobs?limit=50&botAccountId=${botAccountId}`,
    );
    expect(jobsRes.status).toBe(200);
    const items = jobsRes.body.data.items as Array<{
      id: string;
      activityType: string;
      status: string;
      targetId: string;
      botAccountId: string;
      botUsername?: string;
      attempts: number;
      createdAt: string;
      processedAt: string | null;
      lastError: string | null;
    }>;
    const likeApi = items.find((j) => j.id === likeJobId);
    const commentApi = items.find((j) => j.id === commentJobId);
    expect(likeApi).toBeTruthy();
    expect(commentApi).toBeTruthy();
    expect(likeApi!.activityType).toBe("LIKE_POST");
    expect(commentApi!.activityType).toBe("COMMENT_POST");
    expect(likeApi!.status).toBe("PROCESSED");
    expect(commentApi!.status).toBe("PROCESSED");
    expect(likeApi!.targetId).toBe(postId);
    expect(commentApi!.targetId).toBe(postId);
    expect(likeApi!.botAccountId).toBe(botAccountId);
    expect(commentApi!.botAccountId).toBe(botAccountId);

    const botDetail = await auth("get", `/api/v1/admin/bots/${botAccountId}`);
    expect(botDetail.status).toBe(200);
    expect(botDetail.body.data.isAutomatedAccount).toBe(true);
    expect(botDetail.body.data.username).toBe(botUsername);

    const metrics = await auth("get", "/api/v1/admin/bots/metrics");
    expect(metrics.status).toBe(200);
    expect(metrics.body.data.workerEnabled).toBe(false);

    evidence = {
      database: safeDb.database,
      hostname: safeDb.hostname,
      runId,
      sourceCandidateUserId,
      authorUserId,
      postId,
      botAccountId,
      botUserId,
      botUsername,
      botStatusAfterProvision: "ACTIVE",
      botStatusAfterActivate: "ACTIVE",
      likeJobId,
      commentJobId,
      likeJobStatus: likeRow.status,
      commentJobStatus: commentRow.status,
      likeCount: likesAfter,
      commentCount: comments.length,
      organicLikeCount: post.likeCount,
      organicCommentCount: post.commentCount,
      jobsApiItems: [likeApi, commentApi],
      duplicateLikeStillOne: likesAfter === 1,
      browserUiVerified: false,
      workerEnabledInMainEnv: false,
      note:
        "Jobs verified via GET /api/v1/admin/bots/jobs (same contract as milox_bots_manage /jobs). Browser UI was not automated. Main .env worker left false. Set BOTS_E2E_KEEP_EVIDENCE=1 and point a separate API process at milox_bots_e2e to inspect in localhost:3003.",
    };
  });
});
