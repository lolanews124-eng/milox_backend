import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { CryptoService } from "../src/modules/auth/application/services/crypto-service.js";
import { BotsService } from "../src/modules/bots/application/services/bots-service.js";

const actorId = "fca0622f-cba7-4398-bfe7-11842c026990";
const botId = "11111111-1111-1111-1111-111111111111";

describe("bot permissions update", () => {
  it("merges daily caps and never treats missing keys as unlimited", async () => {
    const existing = {
      id: botId,
      userId: "22222222-2222-2222-2222-222222222222",
      username: "aria_vale",
      displayName: "Aria Vale",
      bio: "Automated",
      status: "PAUSED" as const,
      sourceCandidateUserId: null,
      candidateBatchId: null,
      permissions: { maxLikesPerDay: 3 },
      provisionedByAdminId: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: true,
      isAutomatedAccount: true,
      profilePhotoMediaId: null,
    };
    const repository = {
      getBotAccount: vi
        .fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValue({
          ...existing,
          permissions: {
            likesEnabled: true,
            commentsEnabled: true,
            followsEnabled: true,
            viewsEnabled: false,
            maxLikesPerDay: 7,
            maxCommentsPerDay: 5,
            maxFollowsPerDay: 10,
          },
        }),
      updateBotAccountPermissions: vi.fn().mockImplementation(async (_id, permissions) => ({
        ...existing,
        permissions,
        updatedAt: new Date(),
      })),
      writeAudit: vi.fn(),
    };
    const config = {
      MILOX_ENV: "local",
      BOTS_WORKER_ENABLED: false,
      BOTS_ALLOW_MUTATIONS: false,
      DATABASE_URL: "postgresql://milox:x@localhost:5432/milox_live_copy",
      API_PUBLIC_URL: "http://localhost:3001",
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

    const result = await service.updateBot(actorId, botId, {
      permissions: { maxLikesPerDay: 7 },
    });

    expect(repository.updateBotAccountPermissions).toHaveBeenCalledWith(
      botId,
      expect.objectContaining({
        maxLikesPerDay: 7,
        maxCommentsPerDay: 5,
        maxFollowsPerDay: 10,
        viewsEnabled: false,
      }),
    );
    expect(result.resolvedPermissions?.maxLikesPerDay).toBe(7);
    expect(result.dailyLimitTimezone).toBe("UTC");
    expect(result.dailyLimitNote).toContain("defaults");
  });
});
