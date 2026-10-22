/**
 * Explicit target eligibility for bot activity.
 *
 * - disabled: no automatic targeting (default; always on staging/production)
 * - test_fixtures_only: local/test E2E — only [[MILLOX_BOTS_TEST_FIXTURE]] targets
 * - fresh_public: local/test — recent eligible public posts / active users (no markers)
 */

export const BOTS_TEST_FIXTURE_MARKER = "[[MILLOX_BOTS_TEST_FIXTURE]]";

export type BotsTargetPolicy =
  | "disabled"
  | "test_fixtures_only"
  | "fresh_public";

export type TargetPolicyDecision =
  | { ok: true }
  | { ok: false; reason: string };

export function botsTestFixtureMarker(): string {
  return BOTS_TEST_FIXTURE_MARKER;
}

export function postHasTestFixtureMarker(body: string | null | undefined): boolean {
  return typeof body === "string" && body.includes(BOTS_TEST_FIXTURE_MARKER);
}

export function userHasTestFixtureMarker(input: {
  bio?: string | null;
  displayName?: string | null;
}): boolean {
  return (
    postHasTestFixtureMarker(input.bio) ||
    postHasTestFixtureMarker(input.displayName)
  );
}

/**
 * Resolve effective policy. Staging/production are always `disabled`.
 */
export function resolveBotsTargetPolicy(input: {
  MILOX_ENV: string;
  BOTS_TARGET_POLICY: BotsTargetPolicy;
}): BotsTargetPolicy {
  if (input.MILOX_ENV === "production" || input.MILOX_ENV === "staging") {
    return "disabled";
  }
  if (input.BOTS_TARGET_POLICY === "test_fixtures_only") {
    return "test_fixtures_only";
  }
  if (input.BOTS_TARGET_POLICY === "fresh_public") {
    return "fresh_public";
  }
  return "disabled";
}

export function evaluatePostTargetPolicy(
  policy: BotsTargetPolicy,
  post: { body: string | null },
): TargetPolicyDecision {
  if (policy === "disabled") {
    return { ok: false, reason: "target_policy_disabled" };
  }
  if (policy === "test_fixtures_only") {
    if (!postHasTestFixtureMarker(post.body)) {
      return { ok: false, reason: "target_not_approved_fixture" };
    }
    return { ok: true };
  }
  if (policy === "fresh_public") {
    // Eligibility (deleted/hidden/author) is enforced by planner + executor queries.
    return { ok: true };
  }
  return { ok: false, reason: "target_policy_disabled" };
}

export function evaluateUserTargetPolicy(
  policy: BotsTargetPolicy,
  user: { bio?: string | null; displayName?: string | null },
): TargetPolicyDecision {
  if (policy === "disabled") {
    return { ok: false, reason: "target_policy_disabled" };
  }
  if (policy === "test_fixtures_only") {
    if (!userHasTestFixtureMarker(user)) {
      return { ok: false, reason: "target_not_approved_fixture" };
    }
    return { ok: true };
  }
  if (policy === "fresh_public") {
    return { ok: true };
  }
  return { ok: false, reason: "target_policy_disabled" };
}
