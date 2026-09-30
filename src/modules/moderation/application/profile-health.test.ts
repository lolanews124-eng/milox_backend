import { describe, expect, it } from "vitest";

import {
  bandFor,
  computeProfileHealth,
  scoreDeltaFor,
} from "./profile-health.js";

const day = 24 * 60 * 60 * 1000;

function event(daysAgo: number, scoreDelta: number, reasonCode = "SPAM") {
  return {
    createdAt: new Date(Date.now() - daysAgo * day),
    scoreDelta,
    reasonCode,
    kind: "WARN",
    restrictUntil: null,
    message: "warning",
  };
}

describe("computeProfileHealth", () => {
  it("starts at 100 when there are no warnings", () => {
    const health = computeProfileHealth([], new Date());
    expect(health.score).toBe(100);
    expect(health.band).toBe("GOOD");
    expect(health.seriousStrikes90d).toBe(0);
  });

  it("applies a warning and recovers 5 points every full 7 days", () => {
    const now = new Date();
    const fresh = computeProfileHealth(
      [{ ...event(0, -15), createdAt: now }],
      now,
    );
    expect(fresh.score).toBe(85);
    expect(fresh.band).toBe("GOOD");

    const watch = computeProfileHealth(
      [
        { ...event(0, -15), createdAt: now },
        { ...event(0, -15), createdAt: now },
      ],
      now,
    );
    expect(watch.score).toBe(70);
    expect(watch.band).toBe("WATCH");

    const healed = computeProfileHealth([event(14, -15)], now);
    expect(healed.score).toBe(95);
  });

  it("does not recover a partial week and caps at 100", () => {
    const now = new Date();
    const partial = computeProfileHealth([event(6, -15)], now);
    expect(partial.score).toBe(85);

    const capped = computeProfileHealth([event(200, -10)], now);
    expect(capped.score).toBe(100);
  });

  it("counts serious strikes from the last 90 days only", () => {
    const now = new Date();
    const health = computeProfileHealth(
      [event(10, -25, "NUDITY"), event(100, -25, "NUDITY")],
      now,
    );
    expect(health.seriousStrikes90d).toBe(1);
    expect(health.score).toBe(80);
  });

  it("floors the score at 0", () => {
    const now = new Date();
    const health = computeProfileHealth(
      [
        { ...event(1, -40), createdAt: new Date(now.getTime() - day) },
        { ...event(0, -40), createdAt: now },
        { ...event(0, -40), createdAt: now },
      ],
      now,
    );
    expect(health.score).toBe(0);
    expect(bandFor(0)).toBe("RESTRICTED");
  });
});

describe("scoreDeltaFor", () => {
  it("uses the agreed penalties", () => {
    expect(scoreDeltaFor("WARN", "SPAM")).toBe(-15);
    expect(scoreDeltaFor("REMOVE", "SPAM")).toBe(-10);
    expect(scoreDeltaFor("REMOVE", "NUDITY")).toBe(-25);
    expect(scoreDeltaFor("REMOVE_AND_WARN", "HARASSMENT")).toBe(-20);
    expect(scoreDeltaFor("RESTRICT", "NUDITY")).toBe(-25);
    expect(scoreDeltaFor("SUSPEND", "NUDITY")).toBe(-40);
    expect(scoreDeltaFor("DISMISS", "NUDITY")).toBe(0);
  });
});
