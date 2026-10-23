/**
 * Candidate inactivity ranking (presence_v1).
 *
 * IMPORTANT: `lastSeenAt` is only updated from chat Socket.IO presence today.
 * Accounts that never open realtime chat may have null `lastSeenAt`. Ranking
 * therefore falls back to `createdAt` and must be labeled as an estimate.
 *
 * `lastLoginAt` is now written on login/refresh (consumer inactivity policy).
 * Bot candidate ranking still uses lastSeenAt ?? createdAt for presence_v1
 * stability; see users/inactive-account-policy.ts for account suspension.
 */

export const BOT_CANDIDATE_CRITERIA_VERSION = "presence_v1" as const;

export interface InactivityTimestamps {
  lastSeenAt: Date | null;
  createdAt: Date;
}

export function computeInactiveAt(user: InactivityTimestamps): Date {
  return user.lastSeenAt ?? user.createdAt;
}

export function inactivitySignalSource(
  user: InactivityTimestamps,
): "lastSeenAt" | "createdAt_fallback" {
  return user.lastSeenAt ? "lastSeenAt" : "createdAt_fallback";
}

export function rankCandidatesByInactivity<T extends InactivityTimestamps>(
  users: T[],
): Array<T & { inactiveAt: Date; inactivitySource: "lastSeenAt" | "createdAt_fallback" }> {
  return users
    .map((user) => ({
      ...user,
      inactiveAt: computeInactiveAt(user),
      inactivitySource: inactivitySignalSource(user),
    }))
    .sort((a, b) => {
      const delta = a.inactiveAt.getTime() - b.inactiveAt.getTime();
      if (delta !== 0) return delta;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
}
