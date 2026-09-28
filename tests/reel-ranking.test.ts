import { describe, expect, it } from "vitest";

import {
  isLongReelWatch,
  scoreReel,
  sliceRankedPage,
  spreadReelPages,
  type ReelScoreInput,
} from "../src/modules/reels/application/reel-ranking.js";

const now = new Date("2026-09-28T06:00:00.000Z");

function score(overrides: Partial<ReelScoreInput> = {}): number {
  return scoreReel({
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    saveCount: 0,
    durationMs: 15_000,
    avgWatchedMs: 0,
    measuredWatchCount: overrides.measuredWatchCount ?? overrides.viewCount ?? 0,
    followerCount: 0,
    createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    matched: false,
    interestPending: false,
    following: false,
    sharedProfileInterest: false,
    sameCountry: false,
    hashtags: [],
    viewerInterestHashtags: [],
    engagedHashtags: [],
    seen: false,
    own: false,
    now,
    ...overrides,
  });
}

describe("scoreReel", () => {
  it("gives a fresh reel a floor before it has views", () => {
    expect(score()).toBe(25);
  });

  it("trusts rates only after enough views", () => {
    const thin = score({
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      viewCount: 2,
      likeCount: 2,
    });
    const solid = score({
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      viewCount: 10,
      likeCount: 4,
    });
    expect(solid).toBeGreaterThan(thin);
  });

  it("weights a finished watch above likes", () => {
    const createdAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const watched = score({
      createdAt,
      viewCount: 10,
      avgWatchedMs: 15_000,
    });
    const liked = score({
      createdAt,
      viewCount: 10,
      likeCount: 10,
    });
    expect(watched - liked).toBeCloseTo(32, 5);
  });

  it("ignores view rows that never stored a watch length", () => {
    const createdAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const unmeasured = score({
      createdAt,
      viewCount: 20,
      avgWatchedMs: 15_000,
      measuredWatchCount: 0,
    });
    const measured = score({
      createdAt,
      viewCount: 20,
      avgWatchedMs: 15_000,
      measuredWatchCount: 8,
    });
    expect(measured).toBeGreaterThan(unmeasured);
  });

  it("shrinks watch credit when only a few people have seen it", () => {
    const createdAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const few = score({
      createdAt,
      viewCount: 2,
      avgWatchedMs: 15_000,
    });
    const many = score({
      createdAt,
      viewCount: 8,
      avgWatchedMs: 15_000,
    });
    expect(many).toBeGreaterThan(few);
  });

  it("adds personal signals and does not double-count one hashtag", () => {
    const base = score({
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    });
    const personal = score({
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      matched: true,
      interestPending: true,
      following: true,
      sharedProfileInterest: true,
      sameCountry: true,
      hashtags: ["travel", "music", "food", "gym"],
      viewerInterestHashtags: ["travel", "music"],
      engagedHashtags: ["travel", "food"],
    });
    // match 28 + interest 18 + follow 14 + profile 8 + country 6
    // travel engaged +6, food engaged +6, music interest +4. gym none. cap not hit.
    expect(personal - base).toBe(28 + 18 + 14 + 8 + 6 + 6 + 6 + 4);
  });

  it("caps hashtag points", () => {
    const tags = ["a", "b", "c", "d", "e"];
    const capped = score({
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      hashtags: tags,
      engagedHashtags: tags,
      viewerInterestHashtags: tags,
    });
    const plain = score({
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    });
    expect(capped - plain).toBe(18);
  });

  it("pushes seen and own reels down", () => {
    const createdAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    expect(score({ createdAt }) - score({ createdAt, seen: true })).toBe(20);
    expect(score({ createdAt }) - score({ createdAt, own: true })).toBe(8);
  });

  it("decays quality after three days", () => {
    const young = score({
      createdAt: new Date(now.getTime() - 48 * 60 * 60 * 1000),
      viewCount: 20,
      avgWatchedMs: 15_000,
    });
    const older = score({
      createdAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
      viewCount: 20,
      avgWatchedMs: 15_000,
    });
    expect(older).toBeCloseTo(young / 2, 5);
  });

  it("caps the follower boost", () => {
    const createdAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const none = score({ createdAt, followerCount: 0 });
    const huge = score({ createdAt, followerCount: 1_000_000 });
    expect(huge - none).toBeCloseTo(8, 2);
    expect(huge - none).toBeLessThanOrEqual(8);
  });
});

describe("isLongReelWatch", () => {
  it("needs half the video, or 8 seconds when duration is unknown", () => {
    expect(isLongReelWatch(7_000, 15_000)).toBe(false);
    expect(isLongReelWatch(7_500, 15_000)).toBe(true);
    expect(isLongReelWatch(7_999, 0)).toBe(false);
    expect(isLongReelWatch(8_000, 0)).toBe(true);
  });
});

describe("spreadReelPages", () => {
  it("keeps one author per page until the page has to fill", () => {
    const items = [
      { id: "a1", authorId: "a" },
      { id: "a2", authorId: "a" },
      { id: "b1", authorId: "b" },
      { id: "c1", authorId: "c" },
    ];
    expect(spreadReelPages(items, (item) => item.authorId, 2).map((item) => item.id)).toEqual([
      "a1",
      "b1",
      "a2",
      "c1",
    ]);
  });
});

describe("sliceRankedPage", () => {
  it("continues after the cursor reel", () => {
    const ordered = [
      { id: "1", score: 10, createdAt: now },
      { id: "2", score: 9, createdAt: now },
      { id: "3", score: 8, createdAt: now },
    ];
    expect(
      sliceRankedPage(ordered, { id: "1", score: 10, createdAt: now.toISOString() }, 1).map(
        (item) => item.id,
      ),
    ).toEqual(["2", "3"]);
  });
});
