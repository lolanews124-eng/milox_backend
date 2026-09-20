import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../config/env.js";
import {
  FEED_TRENDING_WINDOW_DAYS,
  FEED_FOLLOWER_BOOST_CAP,
  FEED_FOLLOWER_BOOST_REF,
} from "../../modules/feed/application/services/feed-scoring.js";

/**
 * Recomputes posts.trendingScore used by Trending + Suggested + Following-hot.
 *
 * Viral signals:
 * - likes, comments×2.5, shares×3, saves×2.5, soft views
 * - velocity (engagement density while young)
 * - engagement-rate boost / low-rate high-view penalty
 * - author followerCount boost (capped)
 * - light quality boost (caption or media)
 * - time decay
 */
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
        UPDATE posts AS p
        SET "trendingScore" = GREATEST(
          (
            (
              p."likeCount"
              + (p."commentCount" * 2.5)
              + (p."shareCount" * 3.0)
              + (p."saveCount" * 2.5)
              + LEAST(LN(p."viewCount" + 1.0) * 8.0, p."viewCount" * 0.08)
            )
            * (
              CASE
                WHEN (
                  (
                    p."likeCount"
                    + (p."commentCount" * 2.5)
                    + (p."shareCount" * 3.0)
                    + (p."saveCount" * 2.5)
                  ) / (
                    (EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 3600.0) + 2.0
                  )
                ) >= 8.0
                  AND p."createdAt" >= NOW() - INTERVAL '6 hours'
                  THEN 1.28
                WHEN (
                  (
                    p."likeCount"
                    + (p."commentCount" * 2.5)
                    + (p."shareCount" * 3.0)
                    + (p."saveCount" * 2.5)
                  ) / (
                    (EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 3600.0) + 2.0
                  )
                ) >= 3.0
                  AND p."createdAt" >= NOW() - INTERVAL '24 hours'
                  THEN 1.14
                ELSE 1.0
              END
            )
            * (
              CASE
                WHEN p."viewCount" >= 100
                  AND p."createdAt" >= NOW() - INTERVAL '24 hours'
                  THEN 1.22
                WHEN p."viewCount" >= 50
                  AND p."createdAt" >= NOW() - INTERVAL '12 hours'
                  THEN 1.14
                WHEN p."viewCount" >= 20
                  AND p."createdAt" >= NOW() - INTERVAL '6 hours'
                  THEN 1.08
                ELSE 1.0
              END
            )
            * (
              CASE
                WHEN p."viewCount" >= 10
                  AND (
                    (p."likeCount" + (p."commentCount" * 2.5))::float
                    / GREATEST(p."viewCount", 1)::float
                  ) >= 0.08
                  THEN 1.15
                WHEN p."viewCount" >= 80
                  AND (
                    (p."likeCount" + (p."commentCount" * 2.5))::float
                    / GREATEST(p."viewCount", 1)::float
                  ) < 0.02
                  THEN 0.55
                WHEN p."viewCount" >= 40
                  AND (
                    (p."likeCount" + (p."commentCount" * 2.5))::float
                    / GREATEST(p."viewCount", 1)::float
                  ) < 0.03
                  THEN 0.75
                ELSE 1.0
              END
            )
            * (
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM post_media pm WHERE pm."postId" = p.id
                )
                  OR COALESCE(LENGTH(TRIM(p.body)), 0) >= 24
                  THEN 1.06
                WHEN COALESCE(LENGTH(TRIM(p.body)), 0) = 0
                  AND NOT EXISTS (
                    SELECT 1 FROM post_media pm WHERE pm."postId" = p.id
                  )
                  THEN 0.9
                ELSE 1.0
              END
            )
            * (
              1.0 + ${FEED_FOLLOWER_BOOST_CAP} * LEAST(
                LN(GREATEST(u."followerCount", 0) + 1.0)
                  / LN(${FEED_FOLLOWER_BOOST_REF} + 1.0),
                1.0
              )
            )
          ) / POWER(
              (EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 3600.0) + 2.0,
              1.32
            ),
          CASE
            WHEN p."createdAt" >= NOW() - INTERVAL '12 hours'
              THEN 0.35 * (
                1.0 + ${FEED_FOLLOWER_BOOST_CAP} * 0.5 * LEAST(
                  LN(GREATEST(u."followerCount", 0) + 1.0)
                    / LN(${FEED_FOLLOWER_BOOST_REF} + 1.0),
                  1.0
                )
              )
            WHEN p."createdAt" >= NOW() - INTERVAL '48 hours'
              THEN 0.15 * (
                1.0 + ${FEED_FOLLOWER_BOOST_CAP} * 0.5 * LEAST(
                  LN(GREATEST(u."followerCount", 0) + 1.0)
                    / LN(${FEED_FOLLOWER_BOOST_REF} + 1.0),
                  1.0
                )
              )
            ELSE 0
          END
        )
        FROM users AS u
        WHERE p."authorId" = u.id
          AND p."deletedAt" IS NULL
          AND p."isHidden" = FALSE
          AND p."createdAt" >= NOW() - INTERVAL '${FEED_TRENDING_WINDOW_DAYS} days'
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
