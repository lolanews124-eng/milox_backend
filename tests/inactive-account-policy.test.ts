import { describe, expect, it } from "vitest";

import {
  activitySignalSource,
  computeLastActivityAt,
  DEFAULT_INACTIVE_ACCOUNT_DAYS,
  inactivityCutoff,
  isPastInactivityThreshold,
} from "../src/modules/users/application/inactive-account-policy.js";

describe("inactive account policy", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");

  it("uses max(lastSeenAt, lastLoginAt) when both set", () => {
    const lastSeenAt = new Date("2026-01-10T00:00:00.000Z");
    const lastLoginAt = new Date("2026-01-20T00:00:00.000Z");
    expect(
      computeLastActivityAt({ createdAt, lastSeenAt, lastLoginAt }),
    ).toEqual(lastLoginAt);
    expect(
      activitySignalSource({ createdAt, lastSeenAt, lastLoginAt }),
    ).toBe("lastLoginAt");
  });

  it("falls back to createdAt when both activity timestamps are null", () => {
    expect(
      computeLastActivityAt({
        createdAt,
        lastSeenAt: null,
        lastLoginAt: null,
      }),
    ).toEqual(createdAt);
    expect(
      activitySignalSource({
        createdAt,
        lastSeenAt: null,
        lastLoginAt: null,
      }),
    ).toBe("createdAt_fallback");
  });

  it("does not treat a new account as inactive before the threshold", () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const cutoff = inactivityCutoff(now, DEFAULT_INACTIVE_ACCOUNT_DAYS);
    const newbie = {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastSeenAt: null,
      lastLoginAt: null,
    };
    expect(isPastInactivityThreshold(newbie, cutoff)).toBe(false);
  });

  it("flags 14 days idle but not 13 days", () => {
    const now = new Date("2026-02-01T12:00:00.000Z");
    const cutoff = inactivityCutoff(now, 14);
    const idle14 = {
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      lastSeenAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000 - 1_000),
      lastLoginAt: null,
    };
    const idle13 = {
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      lastSeenAt: new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000),
      lastLoginAt: null,
    };
    expect(isPastInactivityThreshold(idle14, cutoff)).toBe(true);
    expect(isPastInactivityThreshold(idle13, cutoff)).toBe(false);
  });

  it("keeps recently refreshed sessions active even if lastSeenAt is old", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const cutoff = inactivityCutoff(now, 14);
    const user = {
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      lastSeenAt: new Date("2025-06-01T00:00:00.000Z"),
      lastLoginAt: new Date("2026-02-25T00:00:00.000Z"),
    };
    expect(isPastInactivityThreshold(user, cutoff)).toBe(false);
  });
});
