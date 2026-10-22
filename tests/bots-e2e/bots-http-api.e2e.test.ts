/**
 * Real HTTP API integration for bots manager endpoints against milox_bots_e2e.
 * Does not fake route handlers — uses createApp + Prisma + login.
 *
 * Requires BOTS_E2E=1 and BOTS_E2E_DATABASE_URL.
 * Keep process BOTS_WORKER_ENABLED=false (config override also forces false).
 */
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { PrismaClient, UserRole } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import { CryptoService } from "../../src/modules/auth/application/services/crypto-service.js";
import {
  cleanupE2eFixtures,
  seedE2eFixtures,
  type E2eFixtures,
} from "./fixtures.js";
import { assertBotsE2eEnabled, assertSafeBotsE2eDatabaseUrl } from "./safety.js";

const optedIn = process.env.BOTS_E2E === "1";
const describeE2e = optedIn ? describe : describe.skip;

const ADMIN_HEADERS = { "X-Client-Platform": "admin" } as const;

describeE2e("bots manager HTTP API E2E", () => {
  let database: PrismaClient;
  let fixtures: E2eFixtures;
  let app: ReturnType<typeof createApp>;
  let accessToken = "";
  let adminUserId = "";
  const adminEmail = `bots_e2e_admin_${randomUUID().slice(0, 8)}@bots-e2e.local`;
  const adminPassword = "bots-e2e-admin-password-long";

  beforeAll(async () => {
    assertBotsE2eEnabled();
    const safe = assertSafeBotsE2eDatabaseUrl(process.env.BOTS_E2E_DATABASE_URL);
    database = new PrismaClient({
      datasources: { db: { url: safe.url } },
    });
    await database.$connect();
    fixtures = await seedE2eFixtures(database);

    const config = {
      NODE_ENV: "development",
      PORT: 3001,
      DATABASE_URL: safe.url,
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_WEB_ORIGIN: "http://localhost:3000",
      ADMIN_ORIGIN: "http://localhost:3002",
      BOTS_ORIGIN: "http://localhost:3003",
      MILOX_ENV: "local",
      BOTS_WORKER_ENABLED: false,
      BOTS_ALLOW_MUTATIONS: false,
      CORS_ORIGINS: [],
      API_PUBLIC_URL: "http://localhost:3001",
      UPLOAD_ROOT: "./uploads-bots-e2e",
      JWT_ACCESS_SECRET: "bots-e2e-http-jwt-access-secret-32c",
      CURSOR_SIGNING_SECRET: "bots-e2e-http-cursor-signing-secret-32",
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
    const username = `e2eadm_${adminUserId.replace(/-/g, "").slice(0, 8)}`;
    await database.user.create({
      data: {
        id: adminUserId,
        username,
        usernameNormalized: username.toLowerCase(),
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
    expect(accessToken).toBeTruthy();
    expect(login.body.data.user.role).toBe("ADMIN");
  });

  afterAll(async () => {
    if (database && fixtures) {
      await cleanupE2eFixtures(database, fixtures);
    }
    if (database && adminUserId) {
      await database.user.deleteMany({ where: { id: adminUserId } });
    }
    await database?.$disconnect();
  });

  function authGet(path: string) {
    return request(app)
      .get(path)
      .set(ADMIN_HEADERS)
      .set("Authorization", `Bearer ${accessToken}`);
  }

  function authPatch(path: string, body: object) {
    return request(app)
      .patch(path)
      .set(ADMIN_HEADERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);
  }

  function authPost(path: string, body: object = {}) {
    return request(app)
      .post(path)
      .set(ADMIN_HEADERS)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);
  }

  it("rejects unauthorized bots metrics", async () => {
    const response = await request(app)
      .get("/api/v1/admin/bots/metrics")
      .set(ADMIN_HEADERS);
    expect(response.status).toBe(401);
  });

  it("returns overview metrics with worker disabled", async () => {
    const response = await authGet("/api/v1/admin/bots/metrics");
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.workerEnabled).toBe(false);
    expect(response.body.data.totalBots).toBeGreaterThanOrEqual(1);
  });

  it("lists bots and returns bot detail with resolved daily limits", async () => {
    const list = await authGet("/api/v1/admin/bots?limit=20");
    expect(list.status).toBe(200);
    expect(list.body.data.items.length).toBeGreaterThanOrEqual(1);

    const detail = await authGet(`/api/v1/admin/bots/${fixtures.botAccountId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(fixtures.botAccountId);
    expect(detail.body.data.resolvedPermissions.maxLikesPerDay).toBeTypeOf(
      "number",
    );
    expect(detail.body.data.dailyLimitTimezone).toBe("UTC");
  });

  it("saves per-bot daily limits and persists after re-fetch", async () => {
    const patch = await authPatch(`/api/v1/admin/bots/${fixtures.botAccountId}`, {
      permissions: {
        maxLikesPerDay: 4,
        maxCommentsPerDay: 2,
        maxFollowsPerDay: 3,
        likesEnabled: true,
        commentsEnabled: true,
        followsEnabled: true,
        viewsEnabled: false,
      },
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data.resolvedPermissions.maxLikesPerDay).toBe(4);

    const again = await authGet(`/api/v1/admin/bots/${fixtures.botAccountId}`);
    expect(again.status).toBe(200);
    expect(again.body.data.resolvedPermissions).toMatchObject({
      maxLikesPerDay: 4,
      maxCommentsPerDay: 2,
      maxFollowsPerDay: 3,
    });
  });

  it("settings report worker disabled and accept kill switch patch", async () => {
    const settings = await authGet("/api/v1/admin/bots/settings");
    expect(settings.status).toBe(200);
    expect(settings.body.data.workerEnabled).toBe(false);

    const patch = await authPatch("/api/v1/admin/bots/settings", {
      killSwitch: true,
      globalPause: true,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data.killSwitch).toBe(true);

    const cleared = await authPatch("/api/v1/admin/bots/settings", {
      killSwitch: false,
      globalPause: false,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.killSwitch).toBe(false);
  });

  it("job preview and job list filters work", async () => {
    const preview = await authPost("/api/v1/admin/bots/jobs/preview", {
      limit: 5,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data.dryRun).toBe(true);
    expect(preview.body.data.workerEnabled).toBe(false);

    const jobs = await authGet(
      `/api/v1/admin/bots/jobs?limit=20&botAccountId=${fixtures.botAccountId}`,
    );
    expect(jobs.status).toBe(200);
    expect(jobs.body.data).toHaveProperty("items");
    expect(jobs.body.data).toHaveProperty("total");
  });

  it("cancel and retry use the real backend", async () => {
    const job = await database.botActivityJob.create({
      data: {
        botAccountId: fixtures.botAccountId,
        activityType: "LIKE_POST",
        targetType: "post",
        targetId: fixtures.postId,
        status: "PENDING",
        idempotencyKey: `http-e2e-cancel-${randomUUID()}`,
        metadata: {},
      },
    });

    const cancel = await authPost(
      `/api/v1/admin/bots/jobs/${job.id}/cancel`,
      {},
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe("CANCELLED");

    const failed = await database.botActivityJob.create({
      data: {
        botAccountId: fixtures.botAccountId,
        activityType: "LIKE_POST",
        targetType: "post",
        targetId: fixtures.postId,
        status: "FAILED",
        lastError: "http-e2e-fail",
        idempotencyKey: `http-e2e-retry-${randomUUID()}`,
        metadata: {},
        processedAt: new Date(),
      },
    });
    const retry = await authPost(
      `/api/v1/admin/bots/jobs/${failed.id}/retry`,
      {},
    );
    expect(retry.status).toBe(200);
    expect(retry.body.data.status).toBe("PENDING");

    await database.botActivityJob.deleteMany({
      where: { id: { in: [job.id, failed.id] } },
    });
  });

  it("surfaces API validation errors to the client", async () => {
    const bad = await authPatch(`/api/v1/admin/bots/${fixtures.botAccountId}`, {
      permissions: { maxLikesPerDay: -1 },
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.body.success).toBe(false);
    expect(bad.body.error?.message ?? bad.body.error?.code).toBeTruthy();
  });
});

describe("bots HTTP E2E gate", () => {
  it("skips unless BOTS_E2E=1", () => {
    if (!optedIn) {
      console.info(
        "Skipped HTTP API E2E. Enable with BOTS_E2E=1 against milox_bots_e2e.",
      );
    }
    expect(true).toBe(true);
  });
});
