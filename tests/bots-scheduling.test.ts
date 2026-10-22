import { describe, expect, it } from "vitest";

import {
  buildSchedulePreview,
  DEFAULT_SCHEDULING,
  isWithinWindow,
  mergeSchedulingConfig,
  readSchedulingFromActivityLimits,
  resolveActiveScheduleWindow,
  zonedMinutesOfDay,
} from "../src/modules/bots/application/bot-scheduling.js";
import { botProfilePhotoUrl } from "../src/modules/bots/application/bot-media-url.js";
import type { AppConfig } from "../src/config/env.js";

describe("bot scheduling windows", () => {
  it("detects daytime and overnight windows", () => {
    expect(isWithinWindow(7 * 60, "06:00", "11:00")).toBe(true);
    expect(isWithinWindow(11 * 60, "06:00", "11:00")).toBe(false);
    expect(isWithinWindow(22 * 60, "21:00", "06:00")).toBe(true);
    expect(isWithinWindow(3 * 60, "21:00", "06:00")).toBe(true);
    expect(isWithinWindow(12 * 60, "21:00", "06:00")).toBe(false);
  });

  it("defaults scheduling to disabled with four windows", () => {
    const cfg = readSchedulingFromActivityLimits({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.missedWindowPolicy).toBe("skip");
    expect(Object.keys(cfg.windows)).toEqual([
      "morning",
      "afternoon",
      "evening",
      "night",
    ]);
  });

  it("merges partial window patches", () => {
    const merged = mergeSchedulingConfig({
      enabled: true,
      timezone: "UTC",
      windows: { morning: { accountQuota: 25, maxJobs: 10 } },
    });
    expect(merged.enabled).toBe(true);
    expect(merged.timezone).toBe("UTC");
    expect(merged.windows.morning.accountQuota).toBe(25);
    expect(merged.windows.morning.maxJobs).toBe(10);
    expect(merged.windows.morning.start).toBe(
      DEFAULT_SCHEDULING.windows.morning.start,
    );
  });

  it("builds illustrative allocation preview (e.g. 50 of 200)", () => {
    const scheduling = mergeSchedulingConfig({
      enabled: true,
      windows: {
        morning: { accountQuota: 50 },
        afternoon: { accountQuota: 50 },
        evening: { accountQuota: 50 },
        night: { accountQuota: 50 },
      },
    });
    const preview = buildSchedulePreview({
      scheduling,
      activeBots: 200,
      now: new Date("2026-06-15T03:30:00.000Z"), // depends on timezone
    });
    expect(preview.windows.every((w) => w.allocatedAccounts === 50)).toBe(true);
    expect(preview.missedWindowPolicy).toBe("skip");
  });

  it("resolves no active window outside enabled ranges when scheduling on", () => {
    const scheduling = mergeSchedulingConfig({
      enabled: true,
      timezone: "UTC",
      windows: {
        morning: { enabled: true, start: "06:00", end: "11:00" },
        afternoon: { enabled: false },
        evening: { enabled: false },
        night: { enabled: false },
      },
    });
    const noonUtc = new Date("2026-01-15T12:00:00.000Z");
    expect(zonedMinutesOfDay(noonUtc, "UTC")).toBe(12 * 60);
    expect(resolveActiveScheduleWindow(noonUtc, scheduling)).toBeNull();
  });
});

describe("bot profile photo URL", () => {
  it("serializes public media URLs and null for missing ids", () => {
    const config = {
      API_PUBLIC_URL: "http://localhost:3001/",
    } as AppConfig;
    expect(botProfilePhotoUrl(null, config)).toBeNull();
    expect(botProfilePhotoUrl(undefined, config)).toBeNull();
    expect(
      botProfilePhotoUrl("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", config),
    ).toBe(
      "http://localhost:3001/api/v1/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });
});
