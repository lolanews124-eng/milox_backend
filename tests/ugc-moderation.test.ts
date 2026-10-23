import { describe, expect, it } from "vitest";

import { evaluateUgcText } from "../src/modules/moderation/application/evaluate-ugc-text.js";
import {
  isAdsEligibleContent,
  isAdsEligibleProfile,
  moderatePostBody,
  moderateProfileText,
} from "../src/modules/moderation/application/ugc-moderation.js";
import {
  collapseSpacedLetterTokens,
  normalizeUgcCompact,
  normalizeUgcLayers,
  normalizeUgcText,
  tokenHasEmbeddedStem,
} from "../src/modules/moderation/application/ugc-text-normalize.js";
import { AppError } from "../src/shared/errors/app-error.js";

describe("normalizeUgcText", () => {
  it("collapses zero-width and spacing obfuscation", () => {
    expect(normalizeUgcText("sex\u200B chat")).toContain("sex");
    expect(normalizeUgcText("sex   chat")).toBe("sex chat");
    expect(normalizeUgcText("SEX CHAT!!!")).toBe("sex chat");
  });

  it("treats commas and punctuation as token separators", () => {
    expect(normalizeUgcText("horny, seducing")).toBe("horny seducing");
    expect(normalizeUgcText("sex-chat")).toBe("sex chat");
    expect(normalizeUgcText("sex.horny")).toBe("sex horny");
  });

  it("merges spaced single letters without joining multi-letter words", () => {
    expect(collapseSpacedLetterTokens("s e x")).toBe("sex");
    expect(collapseSpacedLetterTokens("s e x chat")).toBe("sex chat");
    expect(collapseSpacedLetterTokens("essex")).toBe("essex");
    expect(normalizeUgcLayers("s e x").spacedCollapsed).toBe("sex");
    expect(normalizeUgcCompact("sexxx")).toBe("sex");
  });
});

describe("embedded stem scoping", () => {
  const sexStem = {
    stem: "sex",
    prefixGlue: new Set(["chat"]),
    suffixCompoundMinPrefix: 3,
    falsePositiveTokens: new Set(["essex", "sussex"]),
  };
  const hornyStem = {
    stem: "horny",
    prefixCompoundMinRest: 2,
    suffixCompoundMinPrefix: 2,
  };

  it("detects joined compounds but not Essex / thorny", () => {
    expect(tokenHasEmbeddedStem("chatsex", sexStem)).toBe(true);
    expect(tokenHasEmbeddedStem("sexchat", sexStem)).toBe(true);
    expect(tokenHasEmbeddedStem("essex", sexStem)).toBe(false);
    expect(tokenHasEmbeddedStem("sussex", sexStem)).toBe(false);
    expect(tokenHasEmbeddedStem("hornymen", hornyStem)).toBe(true);
    expect(tokenHasEmbeddedStem("thorny", hornyStem)).toBe(false);
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

  it("rejects sexually solicitous bio language (AdSense gap)", () => {
    expect(evaluateUgcText("horny, seducing").decision).toBe("rejected");
    expect(evaluateUgcText("horny").decision).toBe("rejected");
    expect(evaluateUgcText("Just seducing tonight").decision).toBe("rejected");
  });

  it.each([
    ["chatsex", "rejected"],
    ["hornymen", "rejected"],
    ["chatsex, hornymen", "rejected"],
    ["sex, horny", "rejected"],
    ["sex.horny", "rejected"],
    ["s e x", "rejected"],
    ["s.e.x", "rejected"],
    ["sexxx", "rejected"],
    ["sex--horny", "rejected"],
    ["h o r n y", "rejected"],
  ] as const)("must detect evasion %#: %s → %s", (input, expected) => {
    expect(evaluateUgcText(input).decision).toBe(expected);
  });

  it.each([
    ["Essex", "allow"],
    ["From Essex UK", "allow"],
    ["I love thorny roses", "allow"],
    ["Sex education workshop volunteer", "allow"],
    ["Promoting sexual health awareness", "allow"],
    ["Add me on WhatsApp", "allow"],
    ["Looking for a video call friend", "allow"],
    ["Private person, into dating", "allow"],
    ["Healthy relationship goals", "allow"],
  ] as const)("must avoid false positive %#: %s → %s", (input, expected) => {
    expect(evaluateUgcText(input).decision).toBe(expected);
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

describe("moderatePostBody / profile", () => {
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

  it("rejects joined-word bio chatsex, hornymen", () => {
    expect(() =>
      moderateProfileText({ bio: "chatsex, hornymen", websiteUrl: null }),
    ).toThrow(AppError);
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
