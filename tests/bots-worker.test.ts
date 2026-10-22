import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { BotActivityWorker } from "../src/jobs/bots/bot-activity-worker.js";
import * as claim from "../src/shared/claim-bot-activity-job.js";

describe("BotActivityWorker", () => {
  it("does not start when BOTS_WORKER_ENABLED is false", () => {
    const database = {
      botSettings: { upsert: vi.fn(), findUnique: vi.fn() },
    };
    const config = {
      BOTS_WORKER_ENABLED: false,
    } as AppConfig;
    const worker = new BotActivityWorker(
      database as never,
      config,
      {} as never,
      {} as never,
      {} as never,
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    worker.start();
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Bot activity worker disabled"),
    );
    worker.stop();
    info.mockRestore();
  });

  it("tick is a no-op when worker flag is false", async () => {
    const database = {
      botSettings: { upsert: vi.fn(), findUnique: vi.fn() },
    };
    const config = {
      BOTS_WORKER_ENABLED: false,
    } as AppConfig;
    const worker = new BotActivityWorker(
      database as never,
      config,
      {} as never,
      {} as never,
      {} as never,
    );

    await worker.tick();
    expect(database.botSettings.upsert).not.toHaveBeenCalled();
  });

  it("does not plan or claim when kill switch is on", async () => {
    const recover = vi
      .spyOn(claim, "recoverStaleBotActivityJobs")
      .mockResolvedValue(0);
    const claimNext = vi
      .spyOn(claim, "claimNextBotActivityJob")
      .mockResolvedValue(null);
    const database = {
      botSettings: {
        upsert: vi.fn().mockResolvedValue({
          killSwitch: true,
          globalPause: false,
          maxConcurrency: 3,
          activityLimits: {},
        }),
        findUnique: vi.fn(),
      },
    };
    const config = { BOTS_WORKER_ENABLED: true } as AppConfig;
    const worker = new BotActivityWorker(
      database as never,
      config,
      {} as never,
      {} as never,
      {} as never,
    );

    await worker.tick();
    expect(recover).toHaveBeenCalled();
    expect(claimNext).not.toHaveBeenCalled();
    recover.mockRestore();
    claimNext.mockRestore();
  });

  it("does not plan or claim when global pause is on", async () => {
    const recover = vi
      .spyOn(claim, "recoverStaleBotActivityJobs")
      .mockResolvedValue(0);
    const claimNext = vi
      .spyOn(claim, "claimNextBotActivityJob")
      .mockResolvedValue(null);
    const database = {
      botSettings: {
        upsert: vi.fn().mockResolvedValue({
          killSwitch: false,
          globalPause: true,
          maxConcurrency: 3,
          activityLimits: {},
        }),
        findUnique: vi.fn(),
      },
    };
    const config = { BOTS_WORKER_ENABLED: true } as AppConfig;
    const worker = new BotActivityWorker(
      database as never,
      config,
      {} as never,
      {} as never,
      {} as never,
    );

    await worker.tick();
    expect(claimNext).not.toHaveBeenCalled();
    recover.mockRestore();
    claimNext.mockRestore();
  });
});
