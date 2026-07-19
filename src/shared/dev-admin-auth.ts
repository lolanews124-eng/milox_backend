import {
  UserRole,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";

export const DEV_ADMIN_BYPASS_TOKEN = "dev-admin-bypass";

export function isAdminAuthBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ADMIN_AUTH_BYPASS !== "false";
}

export async function resolveDevBypassStaff(database: PrismaClient): Promise<{
  id: string;
  username: string;
  email: string;
  role: UserRole;
} | null> {
  return database.user.findFirst({
    where: {
      status: UserStatus.ACTIVE,
      deletedAt: null,
      role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MODERATOR] },
    },
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
    },
  });
}
