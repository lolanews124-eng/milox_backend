import { describe, expect, it } from "vitest";

import { evaluateUgcText } from "../src/modules/moderation/application/evaluate-ugc-text.js";
import {
  isAdsEligibleContent,
  isAdsEligibleProfile,
  moderatePostBody,
} from "../src/modules/moderation/application/ugc-moderation.js";
import { normalizeUgcText } from "../src/modules/moderation/application/ugc-text-normalize.js";
import { AppError } from "../src/shared/errors/app-error.js";

describe("normalizeUgcText", () => {
  it("collapses zero-width and spacing obfuscation", () => {
    expect(normalizeUgcText("sex\u200B chat")).toContain("sex");
    expect(normalizeUgcText("sex   chat")).toBe("sex chat");
    expect(normalizeUgcText("SEX CHAT!!!")).toBe("sex chat!!");
  });

  it("handles common leetspeak separators conservatively", () => {
    expect(normalizeUgcText("s e x   c h a t")).toContain("s e x");
    expect(normalizeUgcText("sex-chat")).toBe("sex chat");
  });
});

describe("evaluateUgcText — sexual / Hindi", () => {
  it("rejects explicit English sexual solicitation", () => {
    const result = evaluateUgcText("Join my full sex chat tonight");
    expect(result.decision).toBe("rejected");
    expect(result.matchedRuleIds.length).toBeGreaterThan(0);
  });

  it("rejects Hindi/Hinglish phrases", () => {
    expect(evaluateUgcText("nangi video call available").decision).toBe(
      "rejected",
    );
    expect(evaluateUgcText("kapde utaro abhi").decision).toBe("rejected");
  });

  it("holds promotional phrases for review", () => {
    expect(evaluateUgcText("DM for video call rates").decision).toBe("pending");
    expect(evaluateUgcText("WhatsApp me for private show").decision).toBe(
      "pending",
    );
  });

  it("does not flag harmless alone words", () => {
    expect(evaluateUgcText("Add me on WhatsApp").decision).toBe("allow");
    expect(evaluateUgcText("Looking for a video call friend").decision).toBe(
      "allow",
    );
    expect(evaluateUgcText("Private person, into dating").decision).toBe(
      "allow",
    );
    expect(evaluateUgcText("Healthy relationship goals").decision).toBe(
      "allow",
    );
  });

  it("flags spam phrases and repeated URLs", () => {
    expect(evaluateUgcText("click my link for free money").decision).toBe(
      "pending",
    );
    expect(
      evaluateUgcText(
        "See https://a.example/x https://b.example/y https://c.example/z",
      ).decision,
    ).toBe("pending");
  });
});

describe("moderatePostBody", () => {
  it("throws on reject severity and never returns approved", () => {
    expect(() => moderatePostBody("live sex show now")).toThrow(AppError);
    try {
      moderatePostBody("nude video call");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("CONTENT_REJECTED");
    }
  });

  it("stores pending for promo phrases", () => {
    const result = moderatePostBody("hot video call available");
    expect(result.state).toBe("PENDING");
    expect(result.isHidden).toBe(true);
  });
});

describe("ads eligibility", () => {
  it("only APPROVED non-hidden content is ads eligible", () => {
    expect(
      isAdsEligibleContent({
        moderationState: "APPROVED",
        isHidden: false,
      }),
    ).toBe(true);
    expect(
      isAdsEligibleContent({
        moderationState: "PENDING",
        isHidden: true,
      }),
    ).toBe(false);
    expect(
      isAdsEligibleContent({
        moderationState: "REJECTED",
        isHidden: true,
      }),
    ).toBe(false);
    expect(
      isAdsEligibleContent({
        moderationState: "APPROVED",
        isHidden: true,
      }),
    ).toBe(false);
  });

  it("profiles require approved bio moderation", () => {
    expect(isAdsEligibleProfile({ bioModerationState: "APPROVED" })).toBe(true);
    expect(isAdsEligibleProfile({ bioModerationState: "PENDING" })).toBe(false);
    expect(
      isAdsEligibleProfile({
        bioModerationState: "APPROVED",
        status: "SUSPENDED",
      }),
    ).toBe(false);
  });
});
