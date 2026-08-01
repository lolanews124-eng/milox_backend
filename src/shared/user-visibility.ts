import { UserRole, type Prisma } from "@prisma/client";

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
