import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../config/env.js";
import { FEED_TRENDING_WINDOW_DAYS } from "../../modules/feed/application/services/feed-scoring.js";

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
      await this.database.$executeRawUnsafe(
        `
        UPDATE posts
        SET "trendingScore" = GREATEST(
          (
            (
              "likeCount"
              + ("commentCount" * 2.0)
              + ("shareCount" * 3.0)
              + ("saveCount" * 2.5)
              + LEAST(LN("viewCount" + 1.0) * 8.0, "viewCount" * 0.08)
            )
            * (
              CASE
                WHEN "viewCount" >= 100
                  AND "createdAt" >= NOW() - INTERVAL '24 hours'
                  THEN 1.28
                WHEN "viewCount" >= 50
                  AND "createdAt" >= NOW() - INTERVAL '12 hours'
                  THEN 1.18
                WHEN "viewCount" >= 20
                  AND "createdAt" >= NOW() - INTERVAL '6 hours'
                  THEN 1.1
                ELSE 1.0
              END
            )
            * (
              CASE
                WHEN "viewCount" >= 10
                  AND (
                    ("likeCount" + ("commentCount" * 2.0))::float
                    / GREATEST("viewCount", 1)::float
                  ) >= 0.08
                  THEN 1.15
                ELSE 1.0
              END
            )
          ) / POWER(
              (EXTRACT(EPOCH FROM (NOW() - "createdAt")) / 3600.0) + 2.0,
              1.32
            ),
          CASE
            WHEN "createdAt" >= NOW() - INTERVAL '12 hours' THEN 0.35
            WHEN "createdAt" >= NOW() - INTERVAL '48 hours' THEN 0.15
            ELSE 0
          END
        )
        WHERE "deletedAt" IS NULL
          AND "isHidden" = FALSE
          AND "createdAt" >= NOW() - INTERVAL '${FEED_TRENDING_WINDOW_DAYS} days'
        `,
      );
      await this.database.$executeRawUnsafe(
        `
        UPDATE posts
        SET "trendingScore" = 0
        WHERE "trendingScore" <> 0
          AND (
            "deletedAt" IS NOT NULL
            OR "isHidden" = TRUE
            OR "createdAt" < NOW() - INTERVAL '${FEED_TRENDING_WINDOW_DAYS} days'
          )
        `,
      );
    } finally {
      this.running = false;
    }
  }
}
