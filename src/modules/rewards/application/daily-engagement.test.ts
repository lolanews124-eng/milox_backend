import { describe, expect, it } from "vitest";

import {
  DAILY_MISSION_POINTS,
  DAILY_MISSIONS_ALL_BONUS,
  STREAK_7_BADGE_POINTS,
  STREAK_7_DAYS,
} from "./daily-engagement.js";

describe("daily engagement constants", () => {
  it("keeps mission + bonus + streak badge economics stable", () => {
    expect(DAILY_MISSION_POINTS).toBe(10);
    expect(DAILY_MISSIONS_ALL_BONUS).toBe(20);
    expect(STREAK_7_BADGE_POINTS).toBe(100);
    expect(STREAK_7_DAYS).toBe(7);
    // Full day max from missions alone
    expect(DAILY_MISSION_POINTS * 3 + DAILY_MISSIONS_ALL_BONUS).toBe(50);
  });

  it("computes streak badge cycles the way awardStreakMilestoneIfNeeded does", () => {
    const cycleFor = (streakDays: number) =>
      Math.floor(streakDays / STREAK_7_DAYS) * STREAK_7_DAYS;

    expect(cycleFor(0)).toBe(0);
    expect(cycleFor(6)).toBe(0);
    expect(cycleFor(7)).toBe(7);
    expect(cycleFor(8)).toBe(7); // late claim still unlocks 7-day badge
    expect(cycleFor(13)).toBe(7);
    expect(cycleFor(14)).toBe(14);
    expect(cycleFor(21)).toBe(21);
  });
});
