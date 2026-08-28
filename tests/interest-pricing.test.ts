import { describe, expect, it } from "vitest";

import {
  FREE_ENTITLEMENTS,
  resolveInterestSendCost,
  freeInterestsRemaining,
} from "../src/modules/premium/application/entitlements.js";

describe("interest send pricing", () => {
  it("gives free users their first daily interests at no cost", () => {
    expect(
      resolveInterestSendCost(FREE_ENTITLEMENTS, 40, 0, 10),
    ).toBe(0);
    expect(
      resolveInterestSendCost(FREE_ENTITLEMENTS, 40, 9, 10),
    ).toBe(0);
    expect(
      resolveInterestSendCost(FREE_ENTITLEMENTS, 40, 10, 10),
    ).toBe(40);
  });

  it("tracks remaining free interests for free users", () => {
    expect(freeInterestsRemaining(FREE_ENTITLEMENTS, 3, 10)).toBe(7);
    expect(freeInterestsRemaining(FREE_ENTITLEMENTS, 12, 10)).toBe(0);
  });

  it("waives cost for premium unlimited plans", () => {
    const premium = {
      ...FREE_ENTITLEMENTS,
      isPremium: true,
      tier: "GOLD" as const,
      features: {
        ...FREE_ENTITLEMENTS.features,
        dailyInterestLimit: 9999,
      },
    };
    expect(resolveInterestSendCost(premium, 40, 50, 10)).toBe(0);
  });
});
