/**
 * Inactive account suspension policy (inactivity_v1).
 *
 * Qualifying activity (resets the inactivity clock):
 * - Auth login → writes `lastLoginAt`
 * - Auth refresh (session renewal) → writes `lastLoginAt`
 * - Chat Socket.IO presence heartbeat → writes `lastSeenAt`
 *
 * Not used:
 * - `updatedAt` — touched by background/profile jobs unrelated to user presence
 * - Historical `lastLoginAt` alone before this policy shipped (may be null);
 *   null falls back to `createdAt` so new signups are not treated as already idle
 *
 * Last activity timestamp = max(non-null lastSeenAt, lastLoginAt), else createdAt.
 */

export const INACTIVE_ACCOUNT_POLICY_VERSION = "inactivity_v1" as const;

export const DEFAULT_INACTIVE_ACCOUNT_DAYS = 14;

/** Stored on User.banReason for automatic suspensions (admin-visible). */
export const INACTIVE_SUSPENSION_REASON =
  "Automatic suspension: no qualifying activity for 14 consecutive days";

export type ActivityTimestamps = {
  lastSeenAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type ActivitySignalSource =
  | "lastSeenAt"
  | "lastLoginAt"
  | "createdAt_fallback";

export function computeLastActivityAt(user: ActivityTimestamps): Date {
  const times: number[] = [];
  if (user.lastSeenAt) times.push(user.lastSeenAt.getTime());
  if (user.lastLoginAt) times.push(user.lastLoginAt.getTime());
  if (times.length === 0) return user.createdAt;
  return new Date(Math.max(...times));
}

export function activitySignalSource(
  user: ActivityTimestamps,
): ActivitySignalSource {
  const last = computeLastActivityAt(user).getTime();
  if (user.lastSeenAt && user.lastSeenAt.getTime() === last) {
    return "lastSeenAt";
  }
  if (user.lastLoginAt && user.lastLoginAt.getTime() === last) {
    return "lastLoginAt";
  }
  return "createdAt_fallback";
}

export function inactivityCutoff(
  now: Date,
  inactiveDays: number = DEFAULT_INACTIVE_ACCOUNT_DAYS,
): Date {
  const days = Math.max(1, Math.floor(inactiveDays));
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function isPastInactivityThreshold(
  user: ActivityTimestamps,
  cutoff: Date,
): boolean {
  return computeLastActivityAt(user).getTime() < cutoff.getTime();
}

/**
 * Reason string includes configured day count when not the default 14.
 */
export function inactiveSuspensionReason(inactiveDays: number): string {
  if (inactiveDays === DEFAULT_INACTIVE_ACCOUNT_DAYS) {
    return INACTIVE_SUSPENSION_REASON;
  }
  return `Automatic suspension: no qualifying activity for ${inactiveDays} consecutive days`;
}
