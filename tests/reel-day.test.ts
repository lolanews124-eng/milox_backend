import { describe, expect, it } from "vitest";

import { startOfIstDay } from "../src/modules/reels/application/reel-day.js";

describe("startOfIstDay", () => {
  it("uses Asia/Kolkata midnight as the day boundary", () => {
    const justBefore = startOfIstDay(new Date("2026-09-25T18:29:59.000Z"));
    const atMidnight = startOfIstDay(new Date("2026-09-25T18:30:00.000Z"));
    expect(justBefore.toISOString()).toBe("2026-09-24T18:30:00.000Z");
    expect(atMidnight.toISOString()).toBe("2026-09-25T18:30:00.000Z");
  });
});
