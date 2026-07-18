import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedScoreWorker } from "../src/jobs/feed/feed-score-worker.js";

describe("FeedScoreWorker", () => {
  it("recomputes active scores and clears ineligible posts", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const database = { $executeRaw: executeRaw } as unknown as PrismaClient;
    const worker = new FeedScoreWorker(database, {
      FEED_SCORE_POLL_MS: 300_000,
    } as AppConfig);

    await worker.tick();

    expect(executeRaw).toHaveBeenCalledTimes(2);
  });
});
