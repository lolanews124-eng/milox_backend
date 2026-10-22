import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { CryptoService } from "../src/modules/auth/application/services/crypto-service.js";
import { BotsService } from "../src/modules/bots/application/services/bots-service.js";

describe("bots settings response contract", () => {
  it("includes targetPolicy on both get and update settings", async () => {
    const settingsRow = {
      id: "default",
      killSwitch: true,
      globalPause: true,
      maxConcurrency: 3,
      activityLimits: {},
      commentTemplates: [],
      usernameSuffix: "_mx",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const repository = {
      ensureSettings: vi.fn().mockResolvedValue(settingsRow),
      updateSettings: vi.fn().mockResolvedValue({
        ...settingsRow,
        maxConcurrency: 4,
      }),
      writeAudit: vi.fn(),
    };
    const config = {
      MILOX_ENV: "local",
      BOTS_WORKER_ENABLED: false,
      BOTS_ALLOW_MUTATIONS: false,
      BOTS_TARGET_POLICY: "disabled",
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

    const got = await service.getSettings();
    expect(got.targetPolicy).toBe("disabled");
    expect(got.workerEnabled).toBe(false);
    expect(got.scheduling?.enabled).toBe(false);
    expect(got.scheduling?.missedWindowPolicy).toBe("skip");
    expect(got.scheduling?.windows.morning.accountQuota).toBe(50);

    const updated = await service.updateSettings("actor", {
      maxConcurrency: 4,
      activityLimits: {
        scheduling: {
          enabled: true,
          timezone: "UTC",
          windows: { morning: { accountQuota: 40 } },
        },
      },
    });
    expect(updated.targetPolicy).toBe("disabled");
    expect(updated.maxConcurrency).toBe(4);
    expect(updated.rankingNote).toContain("Inactivity");
    expect(repository.updateSettings).toHaveBeenCalled();
    const savedLimits = vi.mocked(repository.updateSettings).mock.calls[0]?.[0]
      ?.activityLimits as { scheduling?: { enabled?: boolean; timezone?: string } };
    expect(savedLimits?.scheduling?.enabled).toBe(true);
    expect(savedLimits?.scheduling?.timezone).toBe("UTC");
  });
});
