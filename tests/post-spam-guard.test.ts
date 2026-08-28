import { describe, expect, it } from "vitest";

import {
  assertPostingAllowed,
  normalizePostBodyForDuplicateCheck,
} from "../src/modules/posts/application/services/post-spam-guard.js";

describe("post spam guard", () => {
  it("blocks duplicate body submissions", () => {
    const result = assertPostingAllowed(
      {
        lastCreatedAt: null,
        burstCount: 0,
        hourlyCount: 0,
        hasDuplicateBody: true,
      },
      {
        cooldownSeconds: 45,
        burstLimit: 3,
        hourlyLimit: 12,
        duplicateBlocked: true,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("POST_DUPLICATE");
    }
  });

  it("blocks rapid burst posting with a ban warning", () => {
    const result = assertPostingAllowed(
      {
        lastCreatedAt: new Date(Date.now() - 120_000),
        burstCount: 3,
        hourlyCount: 3,
        hasDuplicateBody: false,
      },
      {
        cooldownSeconds: 45,
        burstLimit: 3,
        hourlyLimit: 12,
        duplicateBlocked: false,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("POST_BURST_LIMIT");
      expect(result.message).toMatch(/ban/i);
    }
  });

  it("warns when posting again inside the burst window", () => {
    const result = assertPostingAllowed(
      {
        lastCreatedAt: new Date(Date.now() - 120_000),
        burstCount: 1,
        hourlyCount: 1,
        hasDuplicateBody: false,
      },
      {
        cooldownSeconds: 45,
        burstLimit: 3,
        hourlyLimit: 12,
        duplicateBlocked: false,
      },
    );

    expect(result).toEqual({
      ok: true,
      warning: expect.stringMatching(/ban/i),
    });
  });

  it("normalizes duplicate text before comparison", () => {
    expect(normalizePostBodyForDuplicateCheck("  Hello   World ")).toBe(
      "hello world",
    );
  });
});
