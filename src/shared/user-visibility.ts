import { UserRole, UserStatus, type Prisma } from "@prisma/client";

export const STAFF_ROLES: readonly UserRole[] = [
  UserRole.MODERATOR,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

export function isStaffRole(role: UserRole): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/** Regular platform members only — excludes staff and system accounts. */
export function consumerPlatformUserWhere(): Prisma.UserWhereInput {
  return {
    role: UserRole.USER,
    isSystemAccount: false,
  };
}

/** Neither last-seen nor last-login is after `cutoff` (includes never seen). */
export function stalePresenceWhere(cutoff: Date): Prisma.UserWhereInput {
  return {
    AND: [
      { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] },
      { OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: cutoff } }] },
    ],
  };
}

/** Last seen or last login at/after `since`. */
export function recentPresenceWhere(since: Date): Prisma.UserWhereInput {
  return {
    OR: [
      { lastSeenAt: { gte: since } },
      { lastLoginAt: { gte: since } },
    ],
  };
}

/** Every human account that should receive Milox Official broadcasts. */
export function activeBroadcastRecipientWhere(): Prisma.UserWhereInput {
  return {
    isSystemAccount: false,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };
}

/** System accounts (Milox Official) that can appear as notification actors. */
export function systemAccountActorWhere(userId: string): Prisma.UserWhereInput {
  return {
    id: userId,
    isSystemAccount: true,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };
}

/**
 * Users that may appear as notification actors — regular members plus
 * Milox Official system broadcasts.
 */
export function visibleNotificationActorWhere(
  viewerId?: string,
): Prisma.UserWhereInput {
  const consumer: Prisma.UserWhereInput = {
    status: UserStatus.ACTIVE,
    deletedAt: null,
    ...consumerPlatformUserWhere(),
    ...(viewerId
      ? {
          blocksInitiated: { none: { blockedId: viewerId } },
          blocksReceived: { none: { blockerId: viewerId } },
        }
      : {}),
  };
  return {
    OR: [
      consumer,
      {
        isSystemAccount: true,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
    ],
  };
}
