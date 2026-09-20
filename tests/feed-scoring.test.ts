import { describe, expect, it } from "vitest";

import {
  computeDiscoverPeopleScore,
  computeSuggestedFeedScore,
  diversifyByAuthor,
  feedRankPoolSize,
} from "../src/modules/feed/application/services/feed-scoring.js";

describe("computeDiscoverPeopleScore", () => {
  const base = {
    discoverBoost: 1,
    sameCountry: false,
    sharedInterestCount: 0,
    followerCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    now: new Date("2026-07-17T00:00:00.000Z"),
  };

  it("applies light country and interest lifts", () => {
    const plain = computeDiscoverPeopleScore(base);
    const lifted = computeDiscoverPeopleScore({
      ...base,
      sameCountry: true,
      sharedInterestCount: 2,
      discoverBoost: 3,
    });
    expect(lifted).toBeGreaterThan(plain);
    expect(lifted - plain).toBeLessThan(40);
  });
});

describe("computeSuggestedFeedScore", () => {
  const base = {
    trendingScore: 20,
    sameCountry: false,
    sharedInterestAuthor: false,
    hashtagInterestOverlap: 0,
    affinityAuthor: false,
    seenByViewer: false,
    followerCount: 0,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    now: new Date("2026-07-17T12:00:00.000Z"),
  };

  it("boosts same country, interests, hashtags, and affinity", () => {
    const plain = computeSuggestedFeedScore(base);
    const personalized = computeSuggestedFeedScore({
      ...base,
      sameCountry: true,
      sharedInterestAuthor: true,
      hashtagInterestOverlap: 2,
      affinityAuthor: true,
      followerCount: 10_000,
    });
    expect(personalized).toBeGreaterThan(plain + 50);
  });

  it("penalizes already-seen posts", () => {
    const fresh = computeSuggestedFeedScore(base);
    const seen = computeSuggestedFeedScore({ ...base, seenByViewer: true });
    expect(seen).toBeLessThan(fresh);
  });
});

describe("diversifyByAuthor", () => {
  it("caps posts per author then fills from deferred", () => {
    const items = [
      { id: "a1", authorId: "a" },
      { id: "a2", authorId: "a" },
      { id: "a3", authorId: "a" },
      { id: "b1", authorId: "b" },
    ];
    const out = diversifyByAuthor(items, (item) => item.authorId, {
      limit: 4,
      maxPerAuthor: 2,
    });
    expect(out.map((item) => item.id)).toEqual(["a1", "a2", "b1", "a3"]);
  });
});

describe("feedRankPoolSize", () => {
  it("clamps the candidate pool", () => {
    expect(feedRankPoolSize(2)).toBeGreaterThanOrEqual(36);
    expect(feedRankPoolSize(50)).toBeLessThanOrEqual(120);
  });
});
