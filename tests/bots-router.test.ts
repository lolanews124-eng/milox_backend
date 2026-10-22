import { UserRole, type PrismaClient } from "@prisma/client";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { CryptoService } from "../src/modules/auth/application/services/crypto-service.js";
import { BotsService } from "../src/modules/bots/application/services/bots-service.js";
import { BotsController } from "../src/modules/bots/presentation/bots-controller.js";
import { createBotsRouter } from "../src/modules/bots/presentation/bots-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const actorId = "fca0622f-cba7-4398-bfe7-11842c026990";
const batchId = "11111111-1111-1111-1111-111111111111";
const sourceId = "22222222-2222-2222-2222-222222222222";

describe("bots admin HTTP contract", () => {
  it("allows ADMIN role to read metrics", async () => {
    const harness = createHarness({ roleAllowed: true });
    vi.mocked(harness.service.getMetrics).mockResolvedValue({
      totalBots: 0,
      activeBots: 0,
      pausedBots: 0,
      disabledBots: 0,
      jobsProcessed: 0,
      jobsFailed: 0,
      jobsPending: 0,
      jobsCancelled: 0,
      jobsSkipped: 0,
      killSwitch: true,
      globalPause: true,
      workerEnabled: false,
      viewsEnabled: false,
    });

    const response = await request(harness.app).get(
      "/api/v1/admin/bots/metrics",
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalBots: 0,
      workerEnabled: false,
      killSwitch: true,
    });
  });

  it("rejects when current DB role is not ADMIN/SUPER_ADMIN", async () => {
    const harness = createHarness({ roleAllowed: false });
    const response = await request(harness.app).get(
      "/api/v1/admin/bots/metrics",
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(harness.service.getMetrics).not.toHaveBeenCalled();
  });

  it("preview candidates is dry-run and does not invent provisioned bots", async () => {
    const harness = createHarness({ roleAllowed: true });
    vi.mocked(harness.service.previewCandidates).mockResolvedValue({
      dryRun: true,
      criteriaVersion: "presence_v1",
      rankingNote: "estimate",
      eligibleCount: 2,
      previewCount: 2,
      candidates: [],
      batchId: null,
    });

    const response = await request(harness.app)
      .post("/api/v1/admin/bots/candidates/preview")
      .send({ limit: 10, persist: false });

    expect(response.status).toBe(200);
    expect(response.body.data.dryRun).toBe(true);
    expect(harness.service.previewCandidates).toHaveBeenCalledWith({
      limit: 10,
      persist: false,
      actorUserId: actorId,
    });
  });
});

describe("bots provisioning", () => {
  it("dry-run returns a plan without creating accounts", async () => {
    const repository = {
      getCandidateBatch: vi.fn().mockResolvedValue({
        id: batchId,
        criteriaVersion: "presence_v1",
        criteria: {},
        rankedAt: new Date(),
        previewSnapshot: [{ id: sourceId }],
        eligibleCount: 1,
        previewCount: 1,
        selectedUserIds: [sourceId],
        status: "SELECTION_LOCKED",
        createdByAdminId: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      ensureSettings: vi.fn().mockResolvedValue({
        id: "default",
        killSwitch: true,
        globalPause: true,
        maxConcurrency: 3,
        activityLimits: {},
        commentTemplates: [],
        usernameSuffix: "_mx",
        updatedAt: new Date(),
      }),
      findProvisionSources: vi.fn().mockResolvedValue([
        {
          id: sourceId,
          username: "alice",
          displayName: "Alice",
          bio: null,
          ageRange: "AGE_25_28",
          gender: "PREFER_NOT_TO_SAY",
          country: "India",
          profilePhotoMediaId: null,
        },
      ]),
      findExistingBotSourceIds: vi.fn().mockResolvedValue(new Set()),
      usernameTaken: vi.fn().mockResolvedValue(false),
      createAutomatedBot: vi.fn(),
      writeAudit: vi.fn(),
    };
    const config = {
      MILOX_ENV: "local",
      BOTS_WORKER_ENABLED: false,
      BOTS_ALLOW_MUTATIONS: false,
      DATABASE_URL: "postgresql://milox:x@localhost:5432/milox",
      JWT_ACCESS_SECRET: "x".repeat(32),
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_ISSUER: "milox-api",
      JWT_AUDIENCE: "milox-clients",
    } as AppConfig;
    const service = new BotsService(
      repository as never,
      config,
      new CryptoService(config),
    );

    const result = await service.provisionPreview(actorId, batchId, {
      dryRun: true,
      limit: 5,
    });

    expect(result.dryRun).toBe(true);
    expect(result.createCount).toBe(1);
    expect(result.plan?.[0]?.proposedUsername).toBe("alice");
    expect(repository.createAutomatedBot).not.toHaveBeenCalled();
  });

  it("live provision creates a bot when confirm phrase is PROVISION", async () => {
    const repository = {
      getCandidateBatch: vi.fn().mockResolvedValue({
        id: batchId,
        criteriaVersion: "presence_v1",
        criteria: {},
        rankedAt: new Date(),
        previewSnapshot: [{ id: sourceId }],
        eligibleCount: 1,
        previewCount: 1,
        selectedUserIds: [sourceId],
        status: "SELECTION_LOCKED",
        createdByAdminId: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      ensureSettings: vi.fn().mockResolvedValue({
        id: "default",
        killSwitch: true,
        globalPause: true,
        maxConcurrency: 3,
        activityLimits: {},
        commentTemplates: [],
        usernameSuffix: "_mx",
        updatedAt: new Date(),
      }),
      findProvisionSources: vi.fn().mockResolvedValue([
        {
          id: sourceId,
          username: "jane01",
          displayName: "Jane01",
          bio: "Jane bio",
          ageRange: "AGE_25_28",
          gender: "FEMALE",
          country: "India",
          profilePhotoMediaId: "44444444-4444-4444-4444-444444444444",
        },
      ]),
      findExistingBotSourceIds: vi
        .fn()
        .mockResolvedValueOnce(new Set())
        .mockResolvedValueOnce(new Set([sourceId])),
      // Original username is taken by the human source; first free variation wins.
      usernameTaken: vi.fn().mockImplementation(async (normalized: string) => {
        return normalized === "jane01";
      }),
      claimBatchForProvisioning: vi.fn().mockResolvedValue(true),
      createAutomatedBot: vi.fn().mockImplementation(async (input) => ({
        botAccountId: input.botAccountId,
        userId: input.userId,
        username: input.username,
        sourceCandidateUserId: input.sourceCandidateUserId,
        skipped: false,
      })),
      updateCandidateBatchStatus: vi.fn().mockResolvedValue({}),
      writeAudit: vi.fn(),
      // Ensure we never mutate the source human row via these repository methods.
      updateBotStatus: vi.fn(),
      updateBotPermissions: vi.fn(),
    };
    const config = {
      MILOX_ENV: "local",
      BOTS_WORKER_ENABLED: false,
      BOTS_ALLOW_MUTATIONS: false,
      DATABASE_URL: "postgresql://milox:x@localhost:5432/milox",
      JWT_ACCESS_SECRET: "x".repeat(32),
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_ISSUER: "milox-api",
      JWT_AUDIENCE: "milox-clients",
    } as AppConfig;
    const service = new BotsService(
      repository as never,
      config,
      new CryptoService(config),
    );

    const result = await service.provisionPreview(actorId, batchId, {
      dryRun: false,
      confirm: true,
      confirmPhrase: "PROVISION",
      limit: 5,
    });

    expect(result.dryRun).toBe(false);
    expect(result.created).toBe(true);
    expect(result.createdCount).toBe(1);
    expect(result.createdAccounts).toHaveLength(1);
    expect(repository.createAutomatedBot).toHaveBeenCalledTimes(1);
    const createArg = vi.mocked(repository.createAutomatedBot).mock.calls[0]?.[0];
    expect(createArg?.displayName).toBe("Jane01");
    expect(createArg?.username).toBe("jane02");
    expect(createArg?.bio).toBe("Jane bio");
    expect(createArg?.sourceProfilePhotoMediaId).toBe(
      "44444444-4444-4444-4444-444444444444",
    );
    expect(createArg?.username).not.toMatch(/_mx$/);
    expect(createArg?.passwordHash).toBeTruthy();
    expect(createArg?.sourceCandidateUserId).toBe(sourceId);
    expect(createArg?.userId).not.toBe(sourceId);
    expect(result.message).toMatch(/start ACTIVE/i);
    expect(repository.updateCandidateBatchStatus).toHaveBeenCalledWith(
      batchId,
      "DONE",
    );
  });

  it("uses the next minimal username when the first variation is also taken", async () => {
    const repository = {
      getCandidateBatch: vi.fn().mockResolvedValue({
        id: batchId,
        criteriaVersion: "presence_v1",
        criteria: {},
        rankedAt: new Date(),
        previewSnapshot: [{ id: sourceId }],
        eligibleCount: 1,
        previewCount: 1,
        selectedUserIds: [sourceId],
        status: "SELECTION_LOCKED",
        createdByAdminId: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      ensureSettings: vi.fn().mockResolvedValue({
        id: "default",
        killSwitch: true,
        globalPause: true,
        maxConcurrency: 3,
        activityLimits: {},
        commentTemplates: [],
        usernameSuffix: "_mx",
        updatedAt: new Date(),
      }),
      findProvisionSources: vi.fn().mockResolvedValue([
        {
          id: sourceId,
          username: "jane01",
          displayName: "Jane01",
          bio: null,
          ageRange: "AGE_25_28",
          gender: "PREFER_NOT_TO_SAY",
          country: "India",
          profilePhotoMediaId: null,
        },
      ]),
      findExistingBotSourceIds: vi.fn().mockResolvedValue(new Set()),
      usernameTaken: vi.fn().mockImplementation(async (normalized: string) => {
        return normalized === "jane01" || normalized === "jane02";
      }),
      createAutomatedBot: vi.fn(),
      writeAudit: vi.fn(),
    };
    const config = {
      MILOX_ENV: "local",
      BOTS_WORKER_ENABLED: false,
      BOTS_ALLOW_MUTATIONS: false,
      DATABASE_URL: "postgresql://milox:x@localhost:5432/milox",
      JWT_ACCESS_SECRET: "x".repeat(32),
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_ISSUER: "milox-api",
      JWT_AUDIENCE: "milox-clients",
    } as AppConfig;
    const service = new BotsService(
      repository as never,
      config,
      new CryptoService(config),
    );

    const result = await service.provisionPreview(actorId, batchId, {
      dryRun: true,
      limit: 1,
    });

    expect(result.plan?.[0]?.proposedUsername).toBe("jane03");
  });

  it("skips duplicate source provisioning", async () => {
    const repository = {
      getCandidateBatch: vi.fn().mockResolvedValue({
        id: batchId,
        criteriaVersion: "presence_v1",
        criteria: {},
        rankedAt: new Date(),
        previewSnapshot: [{ id: sourceId }],
        eligibleCount: 1,
        previewCount: 1,
        selectedUserIds: [sourceId],
        status: "SELECTION_LOCKED",
        createdByAdminId: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      ensureSettings: vi.fn().mockResolvedValue({
        id: "default",
        killSwitch: true,
        globalPause: true,
        maxConcurrency: 3,
        activityLimits: {},
        commentTemplates: [],
        usernameSuffix: "_mx",
        updatedAt: new Date(),
      }),
      findProvisionSources: vi.fn().mockResolvedValue([
        {
          id: sourceId,
          username: "alice",
          displayName: "Alice",
          bio: null,
          ageRange: "AGE_25_28",
          gender: "PREFER_NOT_TO_SAY",
          country: "India",
          profilePhotoMediaId: null,
        },
      ]),
      findExistingBotSourceIds: vi.fn().mockResolvedValue(new Set([sourceId])),
      usernameTaken: vi.fn(),
      claimBatchForProvisioning: vi.fn().mockResolvedValue(true),
      createAutomatedBot: vi.fn(),
      updateCandidateBatchStatus: vi.fn().mockResolvedValue({}),
      writeAudit: vi.fn(),
    };
    const config = {
      MILOX_ENV: "local",
      BOTS_WORKER_ENABLED: false,
      BOTS_ALLOW_MUTATIONS: false,
      DATABASE_URL: "postgresql://milox:x@localhost:5432/milox",
      JWT_ACCESS_SECRET: "x".repeat(32),
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_ISSUER: "milox-api",
      JWT_AUDIENCE: "milox-clients",
    } as AppConfig;
    const service = new BotsService(
      repository as never,
      config,
      new CryptoService(config),
    );

    const result = await service.provisionPreview(actorId, batchId, {
      dryRun: false,
      confirm: true,
      confirmPhrase: "PROVISION",
      limit: 5,
    });

    expect(result.created).toBe(false);
    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.message).toMatch(/No new bots were created/i);
    expect(repository.createAutomatedBot).not.toHaveBeenCalled();
  });

  it("rejects concurrent live provision when batch claim fails", async () => {
    const repository = {
      getCandidateBatch: vi.fn().mockResolvedValue({
        id: batchId,
        criteriaVersion: "presence_v1",
        criteria: {},
        rankedAt: new Date(),
        previewSnapshot: [{ id: sourceId }],
        eligibleCount: 1,
        previewCount: 1,
        selectedUserIds: [sourceId],
        status: "SELECTION_LOCKED",
        createdByAdminId: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      ensureSettings: vi.fn().mockResolvedValue({
        id: "default",
        killSwitch: true,
        globalPause: true,
        maxConcurrency: 3,
        activityLimits: {},
        commentTemplates: [],
        usernameSuffix: "_mx",
        updatedAt: new Date(),
      }),
      findProvisionSources: vi.fn().mockResolvedValue([
        {
          id: sourceId,
          username: "jane01",
          displayName: "Jane01",
          bio: null,
          ageRange: "AGE_25_28",
          gender: "PREFER_NOT_TO_SAY",
          country: "India",
          profilePhotoMediaId: null,
        },
      ]),
      findExistingBotSourceIds: vi.fn().mockResolvedValue(new Set()),
      usernameTaken: vi.fn().mockResolvedValue(false),
      claimBatchForProvisioning: vi.fn().mockResolvedValue(false),
      createAutomatedBot: vi.fn(),
      writeAudit: vi.fn(),
    };
    const config = {
      MILOX_ENV: "local",
      BOTS_WORKER_ENABLED: false,
      BOTS_ALLOW_MUTATIONS: false,
      DATABASE_URL: "postgresql://milox:x@localhost:5432/milox",
      JWT_ACCESS_SECRET: "x".repeat(32),
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_ISSUER: "milox-api",
      JWT_AUDIENCE: "milox-clients",
    } as AppConfig;
    const service = new BotsService(
      repository as never,
      config,
      new CryptoService(config),
    );

    await expect(
      service.provisionPreview(actorId, batchId, {
        dryRun: false,
        confirm: true,
        confirmPhrase: "PROVISION",
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
    expect(repository.createAutomatedBot).not.toHaveBeenCalled();
  });
});

function createHarness(options: { roleAllowed: boolean }) {
  const serviceObject = {
    getMetrics: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    previewCandidates: vi.fn(),
    getCandidateBatch: vi.fn(),
    lockSelection: vi.fn(),
    provisionPreview: vi.fn(),
    listBots: vi.fn(),
    getBot: vi.fn(),
    updateBotStatus: vi.fn(),
    listJobs: vi.fn(),
    cancelJob: vi.fn(),
    retryJob: vi.fn(),
    previewUpcomingJobs: vi.fn(),
    listAudit: vi.fn(),
  };
  const database = {
    user: {
      findFirst: vi.fn().mockImplementation(async (args: {
        where?: { role?: { in?: UserRole[] } };
      }) => {
        if (!options.roleAllowed) return null;
        const roles = args.where?.role?.in ?? [];
        if (
          roles.includes(UserRole.ADMIN) ||
          roles.includes(UserRole.SUPER_ADMIN)
        ) {
          return { id: actorId };
        }
        return null;
      }),
    },
  } as unknown as PrismaClient;
  const controller = new BotsController(
    serviceObject as unknown as BotsService,
  );
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = {
      userId: actorId,
      role: UserRole.ADMIN,
      emailVerified: true,
    };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use(
    "/api/v1/admin/bots",
    createBotsRouter(controller, database, authenticate),
  );
  app.use(errorHandler);
  return { app, service: serviceObject };
}
