import { describe, expect, it } from "vitest";

import {
  BOT_CANDIDATE_CRITERIA_VERSION,
  computeInactiveAt,
  inactivitySignalSource,
  rankCandidatesByInactivity,
} from "../src/modules/bots/application/inactivity.js";
import { eligibleCandidateWhere } from "../src/modules/bots/infrastructure/prisma-bots-repository.js";

describe("bot candidate inactivity (presence_v1)", () => {
  it("uses lastSeenAt when present", () => {
    const createdAt = new Date("2024-01-01T00:00:00.000Z");
    const lastSeenAt = new Date("2024-06-01T00:00:00.000Z");
    expect(computeInactiveAt({ createdAt, lastSeenAt })).toEqual(lastSeenAt);
    expect(inactivitySignalSource({ createdAt, lastSeenAt })).toBe(
      "lastSeenAt",
    );
  });

  it("falls back to createdAt when lastSeenAt is null", () => {
    const createdAt = new Date("2023-05-01T00:00:00.000Z");
    expect(computeInactiveAt({ createdAt, lastSeenAt: null })).toEqual(
      createdAt,
    );
    expect(
      inactivitySignalSource({ createdAt, lastSeenAt: null }),
    ).toBe("createdAt_fallback");
  });

  it("ranks longest inactive first", () => {
    const ranked = rankCandidatesByInactivity([
      {
        id: "a",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        lastSeenAt: new Date("2025-01-10T00:00:00.000Z"),
      },
      {
        id: "b",
        createdAt: new Date("2022-01-01T00:00:00.000Z"),
        lastSeenAt: null,
      },
      {
        id: "c",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        lastSeenAt: new Date("2024-02-01T00:00:00.000Z"),
      },
    ]);
    expect(ranked.map((row) => row.id)).toEqual(["b", "c", "a"]);
    expect(ranked[0]?.inactivitySource).toBe("createdAt_fallback");
  });

  it("exposes criteria version for audit", () => {
    expect(BOT_CANDIDATE_CRITERIA_VERSION).toBe("presence_v1");
  });

  it("excludes ineligible account classes from the candidate filter", () => {
    expect(eligibleCandidateWhere()).toMatchObject({
      role: "USER",
      status: "ACTIVE",
      deletedAt: null,
      isSystemAccount: false,
      isAutomatedAccount: false,
    });
  });
});
