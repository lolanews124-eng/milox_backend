import { describe, expect, it } from "vitest";

import {
  buildBotDisplayNameFromSource,
  buildBotUsernameCandidate,
  isValidBotUsername,
  normalizeReusableBio,
  sanitizeUsernameBase,
  sanitizeUsernameInspiration,
} from "../src/modules/bots/application/bot-username.js";

describe("bot username generation", () => {
  it("sanitizes inspiration and keeps charset", () => {
    expect(sanitizeUsernameInspiration("Cool.User!")).toBe("cooluser");
    expect(sanitizeUsernameBase("Jane01!")).toBe("Jane01");
  });

  it("preserves original username casing on attempt 0", () => {
    expect(buildBotUsernameCandidate("Jane01", "_mx", 0)).toBe("Jane01");
    expect(buildBotUsernameCandidate("jane01", "_mx", 0)).toBe("jane01");
  });

  it("produces minimal digit variations close to the original", () => {
    expect(buildBotUsernameCandidate("jane01", "", 1)).toBe("jane02");
    expect(buildBotUsernameCandidate("jane01", "", 8)).toBe("jane09");
    expect(buildBotUsernameCandidate("jane01", "", 9)).toBe("jane10");
  });

  it("appends a digit when increment space is exhausted in the attempt ladder", () => {
    expect(buildBotUsernameCandidate("jane01", "", 13)).toBe("jane011");
  });

  it("uses underscore-number variations later in the ladder", () => {
    expect(buildBotUsernameCandidate("jane01", "", 17)).toBe("jane01_2");
  });

  it("appends a small numeric suffix when the source has no trailing digits", () => {
    expect(buildBotUsernameCandidate("alice", "", 0)).toBe("alice");
    expect(buildBotUsernameCandidate("alice", "", 1)).toBe("alice2");
    expect(buildBotUsernameCandidate("alice", "", 2)).toBe("alice3");
  });

  it("does not require the legacy _mx suffix", () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const name = buildBotUsernameCandidate("jane01", "_mx", attempt);
      expect(name.endsWith("_mx")).toBe(false);
      expect(isValidBotUsername(name)).toBe(true);
    }
  });

  it("stays within length limits across patterns", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const name = buildBotUsernameCandidate("jane01", "", attempt);
      expect(name.length).toBeGreaterThanOrEqual(3);
      expect(name.length).toBeLessThanOrEqual(32);
      expect(isValidBotUsername(name)).toBe(true);
    }
  });

  it("falls back to bot_ hex only after reasonable variations are exhausted", () => {
    const early = buildBotUsernameCandidate("alice", "_mx", 5);
    expect(early.startsWith("bot_")).toBe(false);
    expect(early.startsWith("alice")).toBe(true);

    const name = buildBotUsernameCandidate("alice", "_mx", 20);
    expect(name.startsWith("bot_")).toBe(true);
    expect(isValidBotUsername(name)).toBe(true);
  });

  it("rejects reserved names", () => {
    expect(isValidBotUsername("admin")).toBe(false);
  });

  it("preserves the original display name exactly", () => {
    expect(buildBotDisplayNameFromSource("Jane01", "jane01")).toBe("Jane01");
    expect(buildBotDisplayNameFromSource("Jane 01", "jane01")).toBe("Jane 01");
    expect(buildBotDisplayNameFromSource(null, "jane01")).toBe("jane01");
    expect(buildBotDisplayNameFromSource("", "jane01")).toBe("jane01");
  });

  it("preserves bio or clears blank values without inventing copy", () => {
    expect(normalizeReusableBio("Source bio")).toBe("Source bio");
    expect(normalizeReusableBio(null)).toBeNull();
    expect(normalizeReusableBio("")).toBeNull();
  });

  it("rejects too-short and invalid charset usernames", () => {
    expect(isValidBotUsername("ab")).toBe(false);
    expect(isValidBotUsername("a".repeat(33))).toBe(false);
    expect(isValidBotUsername("bad-name")).toBe(false);
    expect(isValidBotUsername("ok_name")).toBe(true);
  });

  it("treats reserved names case-insensitively", () => {
    expect(isValidBotUsername("Admin")).toBe(false);
    expect(isValidBotUsername("MILOX")).toBe(false);
  });

  it("collision ladder yields distinct candidates for the same inspiration", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      seen.add(buildBotUsernameCandidate("jane01", "", attempt).toLowerCase());
    }
    expect(seen.size).toBe(15);
  });
});
