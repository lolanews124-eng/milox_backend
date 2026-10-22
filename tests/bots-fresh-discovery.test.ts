import { describe, expect, it } from "vitest";

import {
  rankFreshPosts,
  rankFreshUsers,
} from "../src/modules/bots/application/bot-fresh-discovery.js";

describe("rankFreshPosts", () => {
  it("orders by post createdAt desc, then author activity, then id", () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const t1 = new Date("2026-01-02T00:00:00.000Z");
    const t2 = new Date("2026-01-03T00:00:00.000Z");
    const ranked = rankFreshPosts([
      {
        id: "older",
        createdAt: t0,
        author: { lastSeenAt: t2, createdAt: t0 },
      },
      {
        id: "newer-quiet",
        createdAt: t1,
        author: { lastSeenAt: null, createdAt: t0 },
      },
      {
        id: "newer-active",
        createdAt: t1,
        author: { lastSeenAt: t2, createdAt: t0 },
      },
      {
        id: "newest",
        createdAt: t2,
        author: { lastSeenAt: null, createdAt: t0 },
      },
    ]);
    expect(ranked.map((r) => r.id)).toEqual([
      "newest",
      "newer-active",
      "newer-quiet",
      "older",
    ]);
  });

  it("is deterministic for identical timestamps", () => {
    const t = new Date("2026-01-01T12:00:00.000Z");
    const a = { lastSeenAt: t, createdAt: t };
    const ranked = rankFreshPosts([
      { id: "b", createdAt: t, author: a },
      { id: "a", createdAt: t, author: a },
      { id: "c", createdAt: t, author: a },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

describe("rankFreshUsers", () => {
  it("orders by activity desc then createdAt desc", () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const t1 = new Date("2026-01-02T00:00:00.000Z");
    const t2 = new Date("2026-01-03T00:00:00.000Z");
    const ranked = rankFreshUsers([
      { id: "idle", lastSeenAt: null, createdAt: t0 },
      { id: "active", lastSeenAt: t2, createdAt: t0 },
      { id: "newer-idle", lastSeenAt: null, createdAt: t1 },
    ]);
    // active (t2) > newer-idle (fallback createdAt t1) > idle (fallback t0)
    expect(ranked.map((r) => r.id)).toEqual([
      "active",
      "newer-idle",
      "idle",
    ]);
  });
});
