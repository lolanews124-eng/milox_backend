import {
  AuditActorType,
  Prisma,
  ReportStatus,
  UserRole,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";

import type {
  AdminPage,
  AdminReportQuery,
  AdminRepository,
  AdminUserQuery,
  ChangeUserStatusData,
  ResolveReportData,
} from "../application/ports/admin-repository.js";
import {
  AdminHierarchyError,
  AdminSelfActionError,
  AdminStateConflictError,
} from "../application/ports/admin-repository.js";
import type {
  AdminDashboardRecord,
  AdminReportRecord,
  AdminUserRecord,
} from "../application/admin-view.js";

const adminUserSelect = {
  id: true,
  username: true,
  email: true,
  emailVerifiedAt: true,
  displayName: true,
  role: true,
  status: true,
  isVerifiedBadge: true,
  followerCount: true,
  followingCount: true,
  postCount: true,
  lastLoginAt: true,
  bannedAt: true,
  banReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const adminReportSelect = {
  id: true,
  reporterId: true,
  targetType: true,
  reportedUserId: true,
  postId: true,
  commentId: true,
  messageId: true,
  reasonCode: true,
  details: true,
  status: true,
  resolvedAt: true,
  resolverNote: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReportSelect;

export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly database: PrismaClient) {}

  dashboard(now: Date): Promise<AdminDashboardRecord> {
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    return this.database.$transaction(async (transaction) => {
      const [
        totalUsers,
        dailyActiveUsers,
        newUsersToday,
        totalPosts,
        totalComments,
        totalMessages,
        openReports,
        commerceRows,
      ] = await Promise.all([
        transaction.user.count({
          where: { status: { not: UserStatus.DELETED }, deletedAt: null },
        }),
        transaction.user.count({
          where: {
            status: UserStatus.ACTIVE,
            deletedAt: null,
            OR: [
              { lastSeenAt: { gte: dayStart } },
              { lastLoginAt: { gte: dayStart } },
            ],
          },
        }),
        transaction.user.count({
          where: { createdAt: { gte: dayStart }, deletedAt: null },
        }),
        transaction.post.count({ where: { deletedAt: null } }),
        transaction.comment.count({ where: { deletedAt: null } }),
        transaction.message.count({
          where: { deletedForEveryoneAt: null },
        }),
        transaction.report.count({
          where: {
            status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
          },
        }),
        transaction.$queryRaw<
          Array<{ premiumUsers: bigint; revenueCents: bigint }>
        >`
          SELECT
            COUNT(DISTINCT s."userId") FILTER (
              WHERE s.status = 'ACTIVE'
                AND s."startsAt" <= ${now}
                AND s."endsAt" > ${now}
            )::bigint AS "premiumUsers",
            COALESCE(SUM(p."priceCents"), 0)::bigint AS "revenueCents"
          FROM user_subscriptions s
          INNER JOIN premium_plans p ON p.id = s."planId"
        `,
      ]);
      return {
        totalUsers,
        dailyActiveUsers,
        newUsersToday,
        totalPosts,
        totalComments,
        totalMessages,
        openReports,
        premiumUsers: Number(commerceRows[0]?.premiumUsers ?? 0),
        revenueCents: Number(commerceRows[0]?.revenueCents ?? 0),
      };
    });
  }

  async listUsers(
    query: AdminUserQuery,
  ): Promise<AdminPage<AdminUserRecord>> {
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { username: { contains: query.q, mode: "insensitive" } },
              { email: { contains: query.q, mode: "insensitive" } },
              { displayName: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: adminUserSelect,
      }),
      this.database.user.count({ where }),
    ]);
    return { items, total };
  }

  changeUserStatus(
    data: ChangeUserStatusData,
  ): Promise<AdminUserRecord | null> {
    return this.database.$transaction(
      async (transaction) => {
        const [actor, target] = await Promise.all([
          transaction.user.findFirst({
            where: {
              id: data.actorId,
              status: UserStatus.ACTIVE,
              role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
            },
            select: { id: true, role: true },
          }),
          transaction.user.findUnique({
            where: { id: data.targetUserId },
            select: { id: true, role: true, status: true },
          }),
        ]);
        if (!actor) throw new AdminHierarchyError();
        if (!target) return null;
        if (actor.id === target.id) throw new AdminSelfActionError();
        if (roleRank(target.role) >= roleRank(actor.role)) {
          throw new AdminHierarchyError();
        }
        if (
          target.status === UserStatus.PENDING_DELETION ||
          target.status === UserStatus.DELETED
        ) {
          throw new AdminStateConflictError();
        }
        if (target.status === data.status) {
          throw new AdminStateConflictError();
        }

        const now = new Date();
        const actionCode = statusActionCode(data.status);
        const updated = await transaction.user.update({
          where: { id: target.id },
          data: {
            status: data.status,
            bannedAt: data.status === UserStatus.BANNED ? now : null,
            banReason:
              data.status === UserStatus.ACTIVE ? null : data.reason,
          },
          select: adminUserSelect,
        });
        if (data.status !== UserStatus.ACTIVE) {
          await transaction.refreshSession.updateMany({
            where: { userId: target.id, revokedAt: null },
            data: { revokedAt: now },
          });
        }
        await transaction.moderationAction.create({
          data: {
            actorId: actor.id,
            targetUserId: target.id,
            actionCode,
            note: data.reason,
            metadata: {
              previousStatus: target.status,
              newStatus: data.status,
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            actorType: AuditActorType.ADMIN,
            actorUserId: actor.id,
            action: "admin.user.status_changed",
            resourceType: "user",
            resourceId: target.id,
            metadata: {
              previousStatus: target.status,
              newStatus: data.status,
              actionCode,
            },
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listReports(
    query: AdminReportQuery,
  ): Promise<AdminPage<AdminReportRecord>> {
    const where: Prisma.ReportWhereInput = query.status
      ? { status: query.status }
      : {};
    const [items, total] = await this.database.$transaction([
      this.database.report.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: adminReportSelect,
      }),
      this.database.report.count({ where }),
    ]);
    return { items, total };
  }

  resolveReport(
    data: ResolveReportData,
  ): Promise<AdminReportRecord | null> {
    return this.database.$transaction(
      async (transaction) => {
        const actor = await transaction.user.findFirst({
          where: {
            id: data.actorId,
            status: UserStatus.ACTIVE,
            role: {
              in: [
                UserRole.MODERATOR,
                UserRole.ADMIN,
                UserRole.SUPER_ADMIN,
              ],
            },
          },
          select: { id: true },
        });
        if (!actor) throw new AdminHierarchyError();
        const report = await transaction.report.findUnique({
          where: { id: data.reportId },
          select: {
            id: true,
            status: true,
            reportedUserId: true,
          },
        });
        if (!report) return null;
        if (
          report.status !== ReportStatus.OPEN &&
          report.status !== ReportStatus.UNDER_REVIEW
        ) {
          throw new AdminStateConflictError();
        }

        const status =
          data.resolution === "resolved"
            ? ReportStatus.RESOLVED
            : ReportStatus.DISMISSED;
        const actionCode =
          data.actionCode ??
          (status === ReportStatus.RESOLVED
            ? "REPORT_RESOLVED"
            : "REPORT_DISMISSED");
        const updated = await transaction.report.update({
          where: { id: report.id },
          data: {
            status,
            resolvedAt: new Date(),
            resolverNote: data.note,
          },
          select: adminReportSelect,
        });
        await transaction.moderationAction.create({
          data: {
            actorId: actor.id,
            targetUserId: report.reportedUserId,
            reportId: report.id,
            actionCode,
            note: data.note,
            metadata: { resolution: data.resolution },
          },
        });
        await transaction.auditLog.create({
          data: {
            actorType: AuditActorType.ADMIN,
            actorUserId: actor.id,
            action: "admin.report.resolved",
            resourceType: "report",
            resourceId: report.id,
            metadata: { resolution: data.resolution, actionCode },
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

function roleRank(role: UserRole): number {
  return {
    [UserRole.USER]: 0,
    [UserRole.MODERATOR]: 1,
    [UserRole.ADMIN]: 2,
    [UserRole.SUPER_ADMIN]: 3,
  }[role];
}

function statusActionCode(status: UserStatus): string {
  return {
    [UserStatus.ACTIVE]: "USER_REACTIVATED",
    [UserStatus.SUSPENDED]: "USER_SUSPENDED",
    [UserStatus.BANNED]: "USER_BANNED",
    [UserStatus.PENDING_DELETION]: "USER_PENDING_DELETION",
    [UserStatus.DELETED]: "USER_DELETED",
  }[status];
}
