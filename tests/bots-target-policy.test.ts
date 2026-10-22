import { describe, expect, it } from "vitest";

import {
  BOTS_TEST_FIXTURE_MARKER,
  evaluatePostTargetPolicy,
  evaluateUserTargetPolicy,
  resolveBotsTargetPolicy,
} from "../src/modules/bots/application/bot-target-policy.js";

describe("bot target policy", () => {
  it("forces disabled on staging and production", () => {
    expect(
      resolveBotsTargetPolicy({
        MILOX_ENV: "production",
        BOTS_TARGET_POLICY: "test_fixtures_only",
      }),
    ).toBe("disabled");
    expect(
      resolveBotsTargetPolicy({
        MILOX_ENV: "staging",
        BOTS_TARGET_POLICY: "test_fixtures_only",
      }),
    ).toBe("disabled");
  });

  it("allows test_fixtures_only and fresh_public only for local/test", () => {
    expect(
      resolveBotsTargetPolicy({
        MILOX_ENV: "local",
        BOTS_TARGET_POLICY: "test_fixtures_only",
      }),
    ).toBe("test_fixtures_only");
    expect(
      resolveBotsTargetPolicy({
        MILOX_ENV: "test",
        BOTS_TARGET_POLICY: "test_fixtures_only",
      }),
    ).toBe("test_fixtures_only");
    expect(
      resolveBotsTargetPolicy({
        MILOX_ENV: "local",
        BOTS_TARGET_POLICY: "fresh_public",
      }),
    ).toBe("fresh_public");
    expect(
      resolveBotsTargetPolicy({
        MILOX_ENV: "production",
        BOTS_TARGET_POLICY: "fresh_public",
      }),
    ).toBe("disabled");
    expect(
      resolveBotsTargetPolicy({
        MILOX_ENV: "local",
        BOTS_TARGET_POLICY: "disabled",
      }),
    ).toBe("disabled");
  });

  it("fresh_public accepts unmarked posts and users", () => {
    expect(
      evaluatePostTargetPolicy("fresh_public", {
        body: "ordinary recent public post",
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateUserTargetPolicy("fresh_public", {
        bio: null,
        displayName: "Real User",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects unmarked posts and users under test_fixtures_only", () => {
    expect(
      evaluatePostTargetPolicy("test_fixtures_only", {
        body: "ordinary real-looking post",
      }),
    ).toEqual({ ok: false, reason: "target_not_approved_fixture" });
    expect(
      evaluatePostTargetPolicy("test_fixtures_only", {
        body: `ok ${BOTS_TEST_FIXTURE_MARKER}`,
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateUserTargetPolicy("test_fixtures_only", {
        bio: null,
        displayName: "Real User",
      }),
    ).toEqual({ ok: false, reason: "target_not_approved_fixture" });
    expect(
      evaluateUserTargetPolicy("test_fixtures_only", {
        bio: `fixture ${BOTS_TEST_FIXTURE_MARKER}`,
        displayName: "x",
      }),
    ).toEqual({ ok: true });
  });

  it("disabled policy rejects all targets", () => {
    expect(
      evaluatePostTargetPolicy("disabled", {
        body: `marked ${BOTS_TEST_FIXTURE_MARKER}`,
      }),
    ).toEqual({ ok: false, reason: "target_policy_disabled" });
    expect(
      evaluateUserTargetPolicy("disabled", {
        bio: `marked ${BOTS_TEST_FIXTURE_MARKER}`,
      }),
    ).toEqual({ ok: false, reason: "target_policy_disabled" });
  });
});
