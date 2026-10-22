import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { CryptoService } from "../src/modules/auth/application/services/crypto-service.js";
import { normalizeReusableBio } from "../src/modules/bots/application/bot-username.js";
import { BotsService } from "../src/modules/bots/application/services/bots-service.js";

const actorId = "fca0622f-cba7-4398-bfe7-11842c026990";
const batchId = "11111111-1111-1111-1111-111111111111";
const sourceId = "22222222-2222-2222-2222-222222222222";
const photoId = "33333333-3333-3333-3333-333333333333";

function makeConfig(): AppConfig {
  return {
    MILOX_ENV: "local",
    BOTS_WORKER_ENABLED: false,
    BOTS_ALLOW_MUTATIONS: false,
    BOTS_TARGET_POLICY: "disabled",
    DATABASE_URL: "postgresql://milox:x@localhost:5432/milox_live_copy",
    UPLOAD_ROOT: "../../uploads",
    JWT_ACCESS_SECRET: "x".repeat(32),
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_ISSUER: "milox-api",
    JWT_AUDIENCE: "milox-clients",
  } as AppConfig;
}

function lockedBatch() {
  return {
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
  };
}

function settings() {
  return {
    id: "default",
    killSwitch: true,
    globalPause: true,
    maxConcurrency: 3,
    activityLimits: {},
    commentTemplates: [],
    usernameSuffix: "_mx",
    updatedAt: new Date(),
  };
}

describe("normalizeReusableBio", () => {
  it("preserves non-empty bios and treats missing/blank as null", () => {
    expect(normalizeReusableBio("Hello from Jane")).toBe("Hello from Jane");
    expect(normalizeReusableBio("  spaced  ")).toBe("spaced");
    expect(normalizeReusableBio(null)).toBeNull();
    expect(normalizeReusableBio(undefined)).toBeNull();
    expect(normalizeReusableBio("")).toBeNull();
    expect(normalizeReusableBio("   ")).toBeNull();
  });
});

describe("bots provision profile preservation", () => {
  it("copies display name, bio, photo ref, demographics; defaults bot to ACTIVE inputs", async () => {
    const repository = {
      getCandidateBatch: vi.fn().mockResolvedValue(lockedBatch()),
      ensureSettings: vi.fn().mockResolvedValue(settings()),
      findProvisionSources: vi.fn().mockResolvedValue([
        {
          id: sourceId,
          username: "jane01",
          displayName: "Jane01",
          bio: "Source bio text",
          ageRange: "AGE_29_32",
          gender: "FEMALE",
          country: "India",
          profilePhotoMediaId: photoId,
        },
      ]),
      findExistingBotSourceIds: vi
        .fn()
        .mockResolvedValueOnce(new Set())
        .mockResolvedValueOnce(new Set([sourceId])),
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
      updateBotStatus: vi.fn(),
    };

    const service = new BotsService(
      repository as never,
      makeConfig(),
      new CryptoService(makeConfig()),
    );

    const result = await service.provisionPreview(actorId, batchId, {
      dryRun: false,
      confirm: true,
      confirmPhrase: "PROVISION",
      limit: 1,
    });

    expect(result.created).toBe(true);
    expect(result.createdCount).toBe(1);
    expect(result.message).toMatch(/start ACTIVE/i);

    const createArg = vi.mocked(repository.createAutomatedBot).mock.calls[0]?.[0];
    expect(createArg?.displayName).toBe("Jane01");
    expect(createArg?.username).toBe("jane02");
    expect(createArg?.bio).toBe("Source bio text");
    expect(createArg?.ageRange).toBe("AGE_29_32");
    expect(createArg?.gender).toBe("FEMALE");
    expect(createArg?.country).toBe("India");
    expect(createArg?.sourceProfilePhotoMediaId).toBe(photoId);
    expect(createArg?.uploadRoot).toBe("../../uploads");
    expect(createArg?.sourceCandidateUserId).toBe(sourceId);
    expect(createArg?.userId).not.toBe(sourceId);
    expect(createArg?.email).toMatch(/@automated\.milox\.local$/);
    // Never reuse source credentials / contact channels
    expect(createArg).not.toHaveProperty("password");
    expect(repository.updateBotStatus).not.toHaveBeenCalled();
  });

  it("handles missing photo and empty bio without inventing values", async () => {
    const repository = {
      getCandidateBatch: vi.fn().mockResolvedValue(lockedBatch()),
      ensureSettings: vi.fn().mockResolvedValue(settings()),
      findProvisionSources: vi.fn().mockResolvedValue([
        {
          id: sourceId,
          username: "jane01",
          displayName: null,
          bio: "   ",
          ageRange: "AGE_25_28",
          gender: "PREFER_NOT_TO_SAY",
          country: "India",
          profilePhotoMediaId: null,
        },
      ]),
      findExistingBotSourceIds: vi
        .fn()
        .mockResolvedValueOnce(new Set())
        .mockResolvedValueOnce(new Set([sourceId])),
      usernameTaken: vi.fn().mockResolvedValue(false),
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
    };

    const service = new BotsService(
      repository as never,
      makeConfig(),
      new CryptoService(makeConfig()),
    );

    await service.provisionPreview(actorId, batchId, {
      dryRun: false,
      confirm: true,
      confirmPhrase: "PROVISION",
      limit: 1,
    });

    const createArg = vi.mocked(repository.createAutomatedBot).mock.calls[0]?.[0];
    expect(createArg?.displayName).toBe("jane01");
    expect(createArg?.username).toBe("jane01");
    expect(createArg?.bio).toBeNull();
    expect(createArg?.sourceProfilePhotoMediaId).toBeNull();
  });

  it("leaves existing paused bots untouched (no bulk activate) and keeps safeguards", () => {
    const repoSource = readFileSync(
      resolve("src/modules/bots/infrastructure/prisma-bots-repository.ts"),
      "utf8",
    );
    expect(repoSource).toContain('status: "ACTIVE"');
    expect(repoSource).toContain("cloneAuthorizedProfilePhoto");
    expect(repoSource).toContain('storageKey: { startsWith: "public/" }');
    expect(repoSource).toContain("public/profiles/");
    // Must not mass-update existing BotAccount rows to ACTIVE on provision
    expect(repoSource).not.toMatch(
      /botAccount\.updateMany\(\s*\{[^}]*status:\s*"ACTIVE"/s,
    );

    const serviceSource = readFileSync(
      resolve("src/modules/bots/application/services/bots-service.ts"),
      "utf8",
    );
    expect(serviceSource).toContain("normalizeReusableBio");
    expect(serviceSource).toContain("sourceProfilePhotoMediaId");

    expect(makeConfig().BOTS_WORKER_ENABLED).toBe(false);
    expect(makeConfig().BOTS_TARGET_POLICY).toBe("disabled");
  });

  it("keeps idempotent skip when source already provisioned", async () => {
    const repository = {
      getCandidateBatch: vi.fn().mockResolvedValue(lockedBatch()),
      ensureSettings: vi.fn().mockResolvedValue(settings()),
      findProvisionSources: vi.fn().mockResolvedValue([
        {
          id: sourceId,
          username: "alice",
          displayName: "Alice",
          bio: "Hi",
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

    const service = new BotsService(
      repository as never,
      makeConfig(),
      new CryptoService(makeConfig()),
    );

    const result = await service.provisionPreview(actorId, batchId, {
      dryRun: false,
      confirm: true,
      confirmPhrase: "PROVISION",
      limit: 1,
    });

    expect(result.created).toBe(false);
    expect(result.createdCount).toBe(0);
    expect(repository.createAutomatedBot).not.toHaveBeenCalled();
  });
});
