import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../config/env.js";

export class FeedScoreWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, this.config.FEED_SCORE_POLL_MS);
    this.timer.unref();
    void this.tick().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.database.$executeRaw`
        UPDATE posts
        SET "trendingScore" =
          (
            "likeCount"
            + ("commentCount" * 2.0)
            + ("shareCount" * 3.0)
          )
          / POWER(
              (EXTRACT(EPOCH FROM (NOW() - "createdAt")) / 3600.0) + 2.0,
              1.5
            )
        WHERE "deletedAt" IS NULL
          AND "isHidden" = FALSE
          AND "createdAt" >= NOW() - INTERVAL '30 days'
      `;
      await this.database.$executeRaw`
        UPDATE posts
        SET "trendingScore" = 0
        WHERE "trendingScore" <> 0
          AND (
            "deletedAt" IS NOT NULL
            OR "isHidden" = TRUE
            OR "createdAt" < NOW() - INTERVAL '30 days'
          )
      `;
    } finally {
      this.running = false;
    }
  }
}
