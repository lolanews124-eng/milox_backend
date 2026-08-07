import { describe, expect, it } from "vitest";

import {
  FEED_LATEST_WINDOW_DAYS,
  FEED_SUGGESTED_NEW_AUTHOR_DAYS,
  FEED_TRENDING_FRESH_HOURS,
  FEED_TRENDING_WINDOW_DAYS,
  latestFeedCutoff,
  suggestedNewAuthorCutoff,
  trendingFreshCutoff,
} from "../src/modules/feed/application/services/feed-scoring.js";

describe("feed-scoring cutoffs", () => {
  const now = new Date("2026-08-07T12:00:00.000Z");

  it("uses expected windows", () => {
    expect(FEED_TRENDING_WINDOW_DAYS).toBe(60);
    expect(FEED_LATEST_WINDOW_DAYS).toBe(90);
    expect(FEED_SUGGESTED_NEW_AUTHOR_DAYS).toBe(30);
    expect(FEED_TRENDING_FRESH_HOURS).toBe(48);
  });

  it("computes monotonic cutoffs from a reference time", () => {
    const latest = latestFeedCutoff(now);
    const trendingFresh = trendingFreshCutoff(now);
    const suggestedNew = suggestedNewAuthorCutoff(now);

    expect(latest.getTime()).toBeLessThan(suggestedNew.getTime());
    expect(trendingFresh.getTime()).toBeGreaterThan(suggestedNew.getTime());
  });
});
