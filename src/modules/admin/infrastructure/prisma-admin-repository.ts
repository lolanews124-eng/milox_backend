import {
  AdPlacement,
  AuditActorType,
  CmsPageStatus,
  EmailJobStatus,
  EmailJobType,
  MatchStatus,
  MediaKind,
  MediaVisibility,
  OutboxStatus,
  Prisma,
  ReportStatus,
  SubscriptionStatus,
  UserRole,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";

import type {
  AdminAuditLogQuery,
  AdminCommentQuery,
  AdminPage,
  AdminPostQuery,
  AdminReportQuery,
  AdminRepository,
  AdminUserQuery,
  ChangeStaffRoleData,
  ChangeUserStatusData,
  CreateInterestTagData,
  CreateAdData,
  CreateCmsPageData,
  CreatePremiumPlanData,
  CancelSubscriptionData,
  AdminSubscriptionQuery,
  DeleteCommentData,
  DeletePostData,
  GrantSubscriptionData,
  ResolveReportData,
  SetVerifiedBadgeData,
  UpdateAdData,
  UpdateCmsPageData,
  UpdateCommentVisibilityData,
  UpdateInterestTagData,
  UpdatePremiumPlanData,
  UpdatePostVisibilityData,
  AdminEmailJobQuery,
  AdminHashtagQuery,
  AdminMatchQuery,
  AdminMediaQuery,
  AdminOutboxQuery,
  UpdateMediaData,
} from "../application/ports/admin-repository.js";
import {
  AdminHierarchyError,
  AdminSelfActionError,
  AdminStateConflictError,
} from "../application/ports/admin-repository.js";
import type {
  AdminAuditLogRecord,
  AdminCommentRecord,
  AdminDashboardRecord,
  AdminInterestTagRecord,
  AdminModerationActionRecord,
  AdminPostRecord,
  AdminPremiumPlanRecord,
  AdminAdRecord,
  AdminAnalyticsRecord,
  AdminCmsPageRecord,
  AdminEmailJobRecord,
  AdminHashtagRecord,
  AdminMatchRecord,
  AdminMediaContentRecord,
  AdminMediaRecord,
  AdminOutboxEventRecord,
  AdminSubscriptionRecord,
  AdminReportRecord,
  AdminUserDetailRecord,
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

const postAdminSelect = {
  id: true,
  body: true,
  likeCount: true,
  commentCount: true,
  isHidden: true,
  deletedAt: true,
  createdAt: true,
  author: {
    select: { id: true, username: true, displayName: true },
  },
  _count: { select: { media: true } },
} satisfies Prisma.PostSelect;

const commentAdminSelect = {
  id: true,
  postId: true,
  body: true,
  likeCount: true,
  isHidden: true,
  deletedAt: true,
  createdAt: true,
  author: {
    select: { id: true, username: true },
  },
} satisfies Prisma.CommentSelect;

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

  async getUserById(userId: string): Promise<AdminUserDetailRecord | null> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        ...adminUserSelect,
        bio: true,
        countryCode: true,
        gender: true,
        isPrivateAccount: true,
        lastSeenAt: true,
      },
    });
    if (!user) return null;
    const [reportsAgainstCount, openReportsAgainstCount] = await Promise.all([
      this.database.report.count({ where: { reportedUserId: userId } }),
      this.database.report.count({
        where: {
          reportedUserId: userId,
          status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
        },
      }),
    ]);
    return { ...user, reportsAgainstCount, openReportsAgainstCount };
  }

  async listUserModerationHistory(
    userId: string,
    query: { page: number; pageSize: number },
  ): Promise<AdminPage<AdminModerationActionRecord>> {
    const where = { targetUserId: userId };
    const [items, total] = await this.database.$transaction([
      this.database.moderationAction.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          actorId: true,
          actionCode: true,
          note: true,
          createdAt: true,
          actor: { select: { username: true } },
        },
      }),
      this.database.moderationAction.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        actorId: item.actorId,
        actorUsername: item.actor.username,
        actionCode: item.actionCode,
        note: item.note,
        createdAt: item.createdAt,
      })),
      total,
    };
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

  async listPosts(
    query: AdminPostQuery,
  ): Promise<AdminPage<AdminPostRecord>> {
    const where: Prisma.PostWhereInput = {
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.hidden !== undefined ? { isHidden: query.hidden } : {}),
      ...(query.q
        ? {
            OR: [
              { body: { contains: query.q, mode: "insensitive" } },
              {
                author: {
                  username: { contains: query.q, mode: "insensitive" },
                },
              },
              {
                author: {
                  displayName: { contains: query.q, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.post.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          body: true,
          likeCount: true,
          commentCount: true,
          isHidden: true,
          deletedAt: true,
          createdAt: true,
          author: {
            select: { id: true, username: true, displayName: true },
          },
          _count: { select: { media: true } },
        },
      }),
      this.database.post.count({ where }),
    ]);
    return {
      items: rows.map((post) => ({
        id: post.id,
        authorId: post.author.id,
        authorUsername: post.author.username,
        authorDisplayName: post.author.displayName,
        bodyPreview: truncatePreview(post.body),
        mediaCount: post._count.media,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        isHidden: post.isHidden,
        deletedAt: post.deletedAt,
        createdAt: post.createdAt,
      })),
      total,
    };
  }

  updatePostVisibility(
    data: UpdatePostVisibilityData,
  ): Promise<AdminPostRecord | null> {
    return this.mutatePost(data.actorId, data.postId, async (transaction, post) => {
      if (post.isHidden === data.isHidden) {
        throw new AdminStateConflictError();
      }
      const updated = await transaction.post.update({
        where: { id: post.id },
        data: { isHidden: data.isHidden },
        select: postAdminSelect,
      });
      const actionCode = data.isHidden ? "POST_HIDDEN" : "POST_UNHIDDEN";
      await transaction.moderationAction.create({
        data: {
          actorId: data.actorId,
          targetUserId: post.authorId,
          actionCode,
          note: data.note ?? null,
          metadata: { postId: post.id, isHidden: data.isHidden },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorUserId: data.actorId,
          action: "admin.post.visibility_changed",
          resourceType: "post",
          resourceId: post.id,
          metadata: { isHidden: data.isHidden, actionCode },
        },
      });
      return mapAdminPost(updated);
    });
  }

  deletePost(data: DeletePostData): Promise<AdminPostRecord | null> {
    return this.mutatePost(data.actorId, data.postId, async (transaction, post) => {
      if (post.deletedAt) throw new AdminStateConflictError();
      const now = new Date();
      const updated = await transaction.post.update({
        where: { id: post.id },
        data: { deletedAt: now, isHidden: true },
        select: postAdminSelect,
      });
      await transaction.moderationAction.create({
        data: {
          actorId: data.actorId,
          targetUserId: post.authorId,
          actionCode: "POST_DELETED",
          note: data.note ?? null,
          metadata: { postId: post.id },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorUserId: data.actorId,
          action: "admin.post.deleted",
          resourceType: "post",
          resourceId: post.id,
          metadata: { actionCode: "POST_DELETED" },
        },
      });
      return mapAdminPost(updated);
    });
  }

  async listComments(
    query: AdminCommentQuery,
  ): Promise<AdminPage<AdminCommentRecord>> {
    const where: Prisma.CommentWhereInput = {
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.hidden !== undefined ? { isHidden: query.hidden } : {}),
      ...(query.q
        ? {
            OR: [
              { body: { contains: query.q, mode: "insensitive" } },
              {
                author: {
                  username: { contains: query.q, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.comment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: commentAdminSelect,
      }),
      this.database.comment.count({ where }),
    ]);
    return {
      items: rows.map(mapAdminComment),
      total,
    };
  }

  updateCommentVisibility(
    data: UpdateCommentVisibilityData,
  ): Promise<AdminCommentRecord | null> {
    return this.mutateComment(data.actorId, data.commentId, async (transaction, comment) => {
      if (comment.isHidden === data.isHidden) {
        throw new AdminStateConflictError();
      }
      const updated = await transaction.comment.update({
        where: { id: comment.id },
        data: { isHidden: data.isHidden },
        select: commentAdminSelect,
      });
      const actionCode = data.isHidden ? "COMMENT_HIDDEN" : "COMMENT_UNHIDDEN";
      await transaction.moderationAction.create({
        data: {
          actorId: data.actorId,
          targetUserId: comment.authorId,
          actionCode,
          note: data.note ?? null,
          metadata: { commentId: comment.id, isHidden: data.isHidden },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorUserId: data.actorId,
          action: "admin.comment.visibility_changed",
          resourceType: "comment",
          resourceId: comment.id,
          metadata: { isHidden: data.isHidden, actionCode },
        },
      });
      return mapAdminComment(updated);
    });
  }

  deleteComment(data: DeleteCommentData): Promise<AdminCommentRecord | null> {
    return this.mutateComment(data.actorId, data.commentId, async (transaction, comment) => {
      if (comment.deletedAt) throw new AdminStateConflictError();
      const now = new Date();
      const updated = await transaction.comment.update({
        where: { id: comment.id },
        data: { deletedAt: now, isHidden: true },
        select: commentAdminSelect,
      });
      await transaction.moderationAction.create({
        data: {
          actorId: data.actorId,
          targetUserId: comment.authorId,
          actionCode: "COMMENT_DELETED",
          note: data.note ?? null,
          metadata: { commentId: comment.id },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorUserId: data.actorId,
          action: "admin.comment.deleted",
          resourceType: "comment",
          resourceId: comment.id,
          metadata: { actionCode: "COMMENT_DELETED" },
        },
      });
      return mapAdminComment(updated);
    });
  }

  async listAuditLogs(
    query: AdminAuditLogQuery,
  ): Promise<AdminPage<AdminAuditLogRecord>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: { contains: query.action, mode: "insensitive" } } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          actorType: true,
          actorUserId: true,
          action: true,
          resourceType: true,
          resourceId: true,
          metadata: true,
          createdAt: true,
          actorUser: { select: { username: true } },
        },
      }),
      this.database.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        actorType: row.actorType,
        actorUserId: row.actorUserId,
        actorUsername: row.actorUser?.username ?? null,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: row.metadata as Record<string, unknown>,
        createdAt: row.createdAt,
      })),
      total,
    };
  }

  async listStaff(query: { page: number; pageSize: number }): Promise<AdminPage<AdminUserRecord>> {
    const where: Prisma.UserWhereInput = {
      role: { in: [UserRole.MODERATOR, UserRole.ADMIN, UserRole.SUPER_ADMIN] },
    };
    const [items, total] = await this.database.$transaction([
      this.database.user.findMany({
        where,
        orderBy: [{ role: "desc" }, { createdAt: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: adminUserSelect,
      }),
      this.database.user.count({ where }),
    ]);
    return { items, total };
  }

  changeStaffRole(data: ChangeStaffRoleData): Promise<AdminUserRecord | null> {
    return this.database.$transaction(
      async (transaction) => {
        const actor = await transaction.user.findFirst({
          where: {
            id: data.actorId,
            status: UserStatus.ACTIVE,
            role: UserRole.SUPER_ADMIN,
          },
          select: { id: true, role: true },
        });
        if (!actor) throw new AdminHierarchyError();
        const target = await transaction.user.findUnique({
          where: { id: data.targetUserId },
          select: { id: true, role: true, status: true },
        });
        if (!target) return null;
        if (actor.id === target.id) throw new AdminSelfActionError();
        if (target.role === UserRole.SUPER_ADMIN) {
          throw new AdminHierarchyError();
        }
        if (data.role === UserRole.SUPER_ADMIN) {
          throw new AdminHierarchyError();
        }
        if (target.role === data.role) throw new AdminStateConflictError();

        const updated = await transaction.user.update({
          where: { id: target.id },
          data: { role: data.role },
          select: adminUserSelect,
        });
        await transaction.auditLog.create({
          data: {
            actorType: AuditActorType.ADMIN,
            actorUserId: actor.id,
            action: "admin.staff.role_changed",
            resourceType: "user",
            resourceId: target.id,
            metadata: {
              previousRole: target.role,
              newRole: data.role,
            },
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  setVerifiedBadge(data: SetVerifiedBadgeData): Promise<AdminUserRecord | null> {
    return this.database.$transaction(
      async (transaction) => {
        const actor = await transaction.user.findFirst({
          where: {
            id: data.actorId,
            status: UserStatus.ACTIVE,
            role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
          },
          select: { id: true },
        });
        if (!actor) throw new AdminHierarchyError();
        const target = await transaction.user.findUnique({
          where: { id: data.targetUserId },
          select: { id: true, isVerifiedBadge: true, role: true },
        });
        if (!target) return null;
        if (target.isVerifiedBadge === data.isVerifiedBadge) {
          throw new AdminStateConflictError();
        }
        const updated = await transaction.user.update({
          where: { id: target.id },
          data: { isVerifiedBadge: data.isVerifiedBadge },
          select: adminUserSelect,
        });
        await transaction.auditLog.create({
          data: {
            actorType: AuditActorType.ADMIN,
            actorUserId: actor.id,
            action: "admin.user.verified_badge_changed",
            resourceType: "user",
            resourceId: target.id,
            metadata: { isVerifiedBadge: data.isVerifiedBadge },
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listInterestTags(
    query: { page: number; pageSize: number },
  ): Promise<AdminPage<AdminInterestTagRecord>> {
    const [rows, total] = await this.database.$transaction([
      this.database.interestTag.findMany({
        orderBy: [{ label: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          slug: true,
          label: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { users: true } },
        },
      }),
      this.database.interestTag.count(),
    ]);
    return {
      items: rows.map((tag) => ({
        id: tag.id,
        slug: tag.slug,
        label: tag.label,
        isActive: tag.isActive,
        userCount: tag._count.users,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      })),
      total,
    };
  }

  createInterestTag(data: CreateInterestTagData): Promise<AdminInterestTagRecord> {
    return this.database.$transaction(async (transaction) => {
      const actor = await transaction.user.findFirst({
        where: {
          id: data.actorId,
          status: UserStatus.ACTIVE,
          role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        },
        select: { id: true },
      });
      if (!actor) throw new AdminHierarchyError();
      const created = await transaction.interestTag.create({
        data: { slug: data.slug, label: data.label },
        select: {
          id: true,
          slug: true,
          label: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { users: true } },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorUserId: actor.id,
          action: "admin.interest_tag.created",
          resourceType: "interest_tag",
          resourceId: created.id,
          metadata: { slug: created.slug },
        },
      });
      return {
        id: created.id,
        slug: created.slug,
        label: created.label,
        isActive: created.isActive,
        userCount: created._count.users,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
    });
  }

  updateInterestTag(
    data: UpdateInterestTagData,
  ): Promise<AdminInterestTagRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await transaction.user.findFirst({
        where: {
          id: data.actorId,
          status: UserStatus.ACTIVE,
          role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        },
        select: { id: true },
      });
      if (!actor) throw new AdminHierarchyError();
      const existing = await transaction.interestTag.findUnique({
        where: { id: data.tagId },
        select: { id: true, label: true, isActive: true },
      });
      if (!existing) return null;
      const updated = await transaction.interestTag.update({
        where: { id: existing.id },
        data: {
          ...(data.label !== undefined ? { label: data.label } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
        select: {
          id: true,
          slug: true,
          label: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { users: true } },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorUserId: actor.id,
          action: "admin.interest_tag.updated",
          resourceType: "interest_tag",
          resourceId: updated.id,
          metadata: {
            ...(data.label !== undefined ? { label: data.label } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          },
        },
      });
      return {
        id: updated.id,
        slug: updated.slug,
        label: updated.label,
        isActive: updated.isActive,
        userCount: updated._count.users,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    });
  }

  async listPremiumPlans(
    query: { page: number; pageSize: number },
  ): Promise<AdminPage<AdminPremiumPlanRecord>> {
    const [rows, total] = await this.database.$transaction([
      this.database.premiumPlan.findMany({
        orderBy: [{ isActive: "desc" }, { priceCents: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          priceCents: true,
          currency: true,
          durationDays: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              subscriptions: {
                where: { status: SubscriptionStatus.ACTIVE },
              },
            },
          },
        },
      }),
      this.database.premiumPlan.count(),
    ]);
    return {
      items: rows.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        currency: plan.currency,
        durationDays: plan.durationDays,
        isActive: plan.isActive,
        subscriberCount: plan._count.subscriptions,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      })),
      total,
    };
  }

  createPremiumPlan(data: CreatePremiumPlanData): Promise<AdminPremiumPlanRecord> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const created = await transaction.premiumPlan.create({
        data: {
          code: data.code,
          name: data.name,
          description: data.description ?? null,
          priceCents: data.priceCents,
          currency: data.currency,
          durationDays: data.durationDays,
        },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          priceCents: true,
          currency: true,
          durationDays: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { subscriptions: true } },
        },
      });
      await this.writeAudit(transaction, actor.id, "admin.plan.created", "premium_plan", created.id, {
        code: created.code,
      });
      return mapPremiumPlan(created);
    });
  }

  updatePremiumPlan(
    data: UpdatePremiumPlanData,
  ): Promise<AdminPremiumPlanRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const existing = await transaction.premiumPlan.findUnique({
        where: { id: data.planId },
        select: { id: true },
      });
      if (!existing) return null;
      const updated = await transaction.premiumPlan.update({
        where: { id: existing.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
          ...(data.durationDays !== undefined ? { durationDays: data.durationDays } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          priceCents: true,
          currency: true,
          durationDays: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              subscriptions: { where: { status: SubscriptionStatus.ACTIVE } },
            },
          },
        },
      });
      await this.writeAudit(transaction, actor.id, "admin.plan.updated", "premium_plan", updated.id, {});
      return mapPremiumPlan(updated);
    });
  }

  async listSubscriptions(
    query: AdminSubscriptionQuery,
  ): Promise<AdminPage<AdminSubscriptionRecord>> {
    const where: Prisma.UserSubscriptionWhereInput = {
      ...(query.status ? { status: query.status as SubscriptionStatus } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.userSubscription.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          userId: true,
          planId: true,
          status: true,
          startsAt: true,
          endsAt: true,
          cancelledAt: true,
          createdAt: true,
          user: { select: { username: true } },
          plan: { select: { name: true, code: true } },
        },
      }),
      this.database.userSubscription.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        username: row.user.username,
        planId: row.planId,
        planName: row.plan.name,
        planCode: row.plan.code,
        status: row.status,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        cancelledAt: row.cancelledAt,
        createdAt: row.createdAt,
      })),
      total,
    };
  }

  grantSubscription(data: GrantSubscriptionData): Promise<AdminSubscriptionRecord> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const [user, plan] = await Promise.all([
        transaction.user.findUnique({
          where: { id: data.userId },
          select: { id: true, username: true },
        }),
        transaction.premiumPlan.findFirst({
          where: { id: data.planId, isActive: true },
          select: { id: true, name: true, code: true, durationDays: true },
        }),
      ]);
      if (!user || !plan) throw new AdminStateConflictError();
      const now = new Date();
      const endsAt = new Date(now);
      endsAt.setUTCDate(endsAt.getUTCDate() + plan.durationDays);
      await transaction.userSubscription.updateMany({
        where: { userId: user.id, status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now },
      });
      const created = await transaction.userSubscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          status: SubscriptionStatus.ACTIVE,
          startsAt: now,
          endsAt,
        },
        select: {
          id: true,
          userId: true,
          planId: true,
          status: true,
          startsAt: true,
          endsAt: true,
          cancelledAt: true,
          createdAt: true,
          user: { select: { username: true } },
          plan: { select: { name: true, code: true } },
        },
      });
      await this.writeAudit(transaction, actor.id, "admin.subscription.granted", "subscription", created.id, {
        userId: user.id,
        planId: plan.id,
      });
      return {
        id: created.id,
        userId: created.userId,
        username: created.user.username,
        planId: created.planId,
        planName: created.plan.name,
        planCode: created.plan.code,
        status: created.status,
        startsAt: created.startsAt,
        endsAt: created.endsAt,
        cancelledAt: created.cancelledAt,
        createdAt: created.createdAt,
      };
    });
  }

  cancelSubscription(
    data: CancelSubscriptionData,
  ): Promise<AdminSubscriptionRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const existing = await transaction.userSubscription.findUnique({
        where: { id: data.subscriptionId },
        select: { id: true, status: true },
      });
      if (!existing) return null;
      if (existing.status !== SubscriptionStatus.ACTIVE) {
        throw new AdminStateConflictError();
      }
      const updated = await transaction.userSubscription.update({
        where: { id: existing.id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: new Date(),
        },
        select: {
          id: true,
          userId: true,
          planId: true,
          status: true,
          startsAt: true,
          endsAt: true,
          cancelledAt: true,
          createdAt: true,
          user: { select: { username: true } },
          plan: { select: { name: true, code: true } },
        },
      });
      await this.writeAudit(transaction, actor.id, "admin.subscription.cancelled", "subscription", updated.id, {});
      return {
        id: updated.id,
        userId: updated.userId,
        username: updated.user.username,
        planId: updated.planId,
        planName: updated.plan.name,
        planCode: updated.plan.code,
        status: updated.status,
        startsAt: updated.startsAt,
        endsAt: updated.endsAt,
        cancelledAt: updated.cancelledAt,
        createdAt: updated.createdAt,
      };
    });
  }

  async listAds(query: { page: number; pageSize: number }): Promise<AdminPage<AdminAdRecord>> {
    const [rows, total] = await this.database.$transaction([
      this.database.advertisement.findMany({
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.advertisement.count(),
    ]);
    return { items: rows.map(mapAd), total };
  }

  createAd(data: CreateAdData): Promise<AdminAdRecord> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const created = await transaction.advertisement.create({
        data: {
          title: data.title,
          body: data.body ?? null,
          imageUrl: data.imageUrl ?? null,
          targetUrl: data.targetUrl ?? null,
          placement: data.placement as Prisma.AdvertisementCreateInput["placement"],
          isActive: data.isActive ?? false,
          startsAt: data.startsAt ?? null,
          endsAt: data.endsAt ?? null,
        },
      });
      await this.writeAudit(transaction, actor.id, "admin.ad.created", "advertisement", created.id, {});
      return mapAd(created);
    });
  }

  updateAd(data: UpdateAdData): Promise<AdminAdRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const existing = await transaction.advertisement.findUnique({
        where: { id: data.adId },
        select: { id: true },
      });
      if (!existing) return null;
      const patch: Prisma.AdvertisementUpdateInput = {};
      if (data.title !== undefined) patch.title = data.title;
      if (data.body !== undefined) patch.body = data.body;
      if (data.imageUrl !== undefined) patch.imageUrl = data.imageUrl;
      if (data.targetUrl !== undefined) patch.targetUrl = data.targetUrl;
      if (data.placement !== undefined) patch.placement = data.placement as AdPlacement;
      if (data.isActive !== undefined) patch.isActive = data.isActive;
      if (data.startsAt !== undefined) patch.startsAt = data.startsAt;
      if (data.endsAt !== undefined) patch.endsAt = data.endsAt;
      const updated = await transaction.advertisement.update({
        where: { id: existing.id },
        data: patch,
      });
      await this.writeAudit(transaction, actor.id, "admin.ad.updated", "advertisement", updated.id, {});
      return mapAd(updated);
    });
  }

  deleteAd(actorId: string, adId: string): Promise<AdminAdRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, actorId);
      const existing = await transaction.advertisement.findUnique({ where: { id: adId } });
      if (!existing) return null;
      await transaction.advertisement.delete({ where: { id: adId } });
      await this.writeAudit(transaction, actor.id, "admin.ad.deleted", "advertisement", adId, {});
      return mapAd(existing);
    });
  }

  async listCmsPages(
    query: { page: number; pageSize: number },
  ): Promise<AdminPage<AdminCmsPageRecord>> {
    const [rows, total] = await this.database.$transaction([
      this.database.cmsPage.findMany({
        orderBy: [{ updatedAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.cmsPage.count(),
    ]);
    return { items: rows.map(mapCmsPage), total };
  }

  createCmsPage(data: CreateCmsPageData): Promise<AdminCmsPageRecord> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const status = (data.status ?? "DRAFT") as CmsPageStatus;
      const created = await transaction.cmsPage.create({
        data: {
          slug: data.slug,
          title: data.title,
          bodyMarkdown: data.bodyMarkdown,
          status,
          publishedAt: status === CmsPageStatus.PUBLISHED ? new Date() : null,
        },
      });
      await this.writeAudit(transaction, actor.id, "admin.cms.created", "cms_page", created.id, {
        slug: created.slug,
      });
      return mapCmsPage(created);
    });
  }

  updateCmsPage(data: UpdateCmsPageData): Promise<AdminCmsPageRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const existing = await transaction.cmsPage.findUnique({
        where: { id: data.pageId },
        select: { id: true, status: true, publishedAt: true },
      });
      if (!existing) return null;
      const nextStatus = data.status as CmsPageStatus | undefined;
      const updated = await transaction.cmsPage.update({
        where: { id: existing.id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.bodyMarkdown !== undefined ? { bodyMarkdown: data.bodyMarkdown } : {}),
          ...(nextStatus !== undefined
            ? {
                status: nextStatus,
                publishedAt:
                  nextStatus === CmsPageStatus.PUBLISHED
                    ? existing.publishedAt ?? new Date()
                    : existing.publishedAt,
              }
            : {}),
        },
      });
      await this.writeAudit(transaction, actor.id, "admin.cms.updated", "cms_page", updated.id, {});
      return mapCmsPage(updated);
    });
  }

  async listMatches(
    query: AdminMatchQuery,
  ): Promise<AdminPage<AdminMatchRecord>> {
    const where: Prisma.MatchWhereInput = {
      ...(query.status ? { status: query.status as MatchStatus } : {}),
      ...(query.userId
        ? {
            OR: [{ userAId: query.userId }, { userBId: query.userId }],
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { userA: { username: { contains: query.q, mode: "insensitive" } } },
              { userB: { username: { contains: query.q, mode: "insensitive" } } },
              {
                userA: {
                  displayName: { contains: query.q, mode: "insensitive" },
                },
              },
              {
                userB: {
                  displayName: { contains: query.q, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.match.findMany({
        where,
        orderBy: [{ matchedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          status: true,
          matchedAt: true,
          unmatchedAt: true,
          interestId: true,
          createdAt: true,
          userA: {
            select: { id: true, username: true, displayName: true },
          },
          userB: {
            select: { id: true, username: true, displayName: true },
          },
          conversation: { select: { id: true, _count: { select: { messages: true } } } },
        },
      }),
      this.database.match.count({ where }),
    ]);
    return {
      items: rows.map((match) => ({
        id: match.id,
        status: match.status,
        matchedAt: match.matchedAt,
        unmatchedAt: match.unmatchedAt,
        interestId: match.interestId,
        conversationId: match.conversation?.id ?? null,
        userAId: match.userA.id,
        userAUsername: match.userA.username,
        userADisplayName: match.userA.displayName,
        userBId: match.userB.id,
        userBUsername: match.userB.username,
        userBDisplayName: match.userB.displayName,
        messageCount: match.conversation?._count.messages ?? 0,
        createdAt: match.createdAt,
      })),
      total,
    };
  }

  async listMedia(
    query: AdminMediaQuery,
  ): Promise<AdminPage<AdminMediaRecord>> {
    const where: Prisma.MediaAssetWhereInput = {
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.kind ? { kind: query.kind as MediaKind } : {}),
      ...(query.visibility
        ? { visibility: query.visibility as MediaVisibility }
        : {}),
      ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      ...(query.q
        ? {
            owner: {
              username: { contains: query.q, mode: "insensitive" },
            },
          }
        : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.mediaAsset.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          kind: true,
          visibility: true,
          mimeType: true,
          byteSize: true,
          width: true,
          height: true,
          ownerUserId: true,
          deletedAt: true,
          createdAt: true,
          owner: { select: { username: true } },
        },
      }),
      this.database.mediaAsset.count({ where }),
    ]);
    return {
      items: rows.map((media) => ({
        id: media.id,
        kind: media.kind,
        visibility: media.visibility,
        mimeType: media.mimeType,
        byteSize: media.byteSize,
        width: media.width,
        height: media.height,
        ownerUserId: media.ownerUserId,
        ownerUsername: media.owner?.username ?? null,
        deletedAt: media.deletedAt,
        createdAt: media.createdAt,
      })),
      total,
    };
  }

  async getMediaContent(
    mediaId: string,
  ): Promise<AdminMediaContentRecord | null> {
    const media = await this.database.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        storageKey: true,
        mimeType: true,
        checksumSha256: true,
      },
    });
    if (!media) return null;
    return {
      storageKey: media.storageKey,
      mimeType: media.mimeType,
      checksumSha256: media.checksumSha256,
    };
  }

  updateMedia(data: UpdateMediaData): Promise<AdminMediaRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const existing = await transaction.mediaAsset.findUnique({
        where: { id: data.mediaId },
        select: { id: true, deletedAt: true },
      });
      if (!existing) return null;
      const updated = await transaction.mediaAsset.update({
        where: { id: existing.id },
        data: { deletedAt: data.deleted ? new Date() : null },
        select: {
          id: true,
          kind: true,
          visibility: true,
          mimeType: true,
          byteSize: true,
          width: true,
          height: true,
          ownerUserId: true,
          deletedAt: true,
          createdAt: true,
          owner: { select: { username: true } },
        },
      });
      await this.writeAudit(
        transaction,
        actor.id,
        data.deleted ? "admin.media.deleted" : "admin.media.restored",
        "media_asset",
        updated.id,
        {},
      );
      return {
        id: updated.id,
        kind: updated.kind,
        visibility: updated.visibility,
        mimeType: updated.mimeType,
        byteSize: updated.byteSize,
        width: updated.width,
        height: updated.height,
        ownerUserId: updated.ownerUserId,
        ownerUsername: updated.owner?.username ?? null,
        deletedAt: updated.deletedAt,
        createdAt: updated.createdAt,
      };
    });
  }

  async listOutboxEvents(
    query: AdminOutboxQuery,
  ): Promise<AdminPage<AdminOutboxEventRecord>> {
    const where: Prisma.OutboxEventWhereInput = {
      ...(query.status ? { status: query.status as OutboxStatus } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.aggregateType ? { aggregateType: query.aggregateType } : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.outboxEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.outboxEvent.count({ where }),
    ]);
    return {
      items: rows.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload as Record<string, unknown>,
        status: event.status,
        attempts: event.attempts,
        availableAt: event.availableAt,
        processedAt: event.processedAt,
        lastError: event.lastError,
        createdAt: event.createdAt,
      })),
      total,
    };
  }

  retryOutboxEvent(
    actorId: string,
    eventId: string,
  ): Promise<AdminOutboxEventRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, actorId);
      const existing = await transaction.outboxEvent.findUnique({
        where: { id: eventId },
      });
      if (!existing) return null;
      if (existing.status === OutboxStatus.PROCESSED) {
        throw new AdminStateConflictError();
      }
      const updated = await transaction.outboxEvent.update({
        where: { id: existing.id },
        data: {
          status: OutboxStatus.PENDING,
          lastError: null,
          availableAt: new Date(),
        },
      });
      await this.writeAudit(
        transaction,
        actor.id,
        "admin.outbox.retried",
        "outbox_event",
        updated.id,
        { eventType: updated.eventType },
      );
      return {
        id: updated.id,
        eventType: updated.eventType,
        aggregateType: updated.aggregateType,
        aggregateId: updated.aggregateId,
        payload: updated.payload as Record<string, unknown>,
        status: updated.status,
        attempts: updated.attempts,
        availableAt: updated.availableAt,
        processedAt: updated.processedAt,
        lastError: updated.lastError,
        createdAt: updated.createdAt,
      };
    });
  }

  async listEmailJobs(
    query: AdminEmailJobQuery,
  ): Promise<AdminPage<AdminEmailJobRecord>> {
    const where: Prisma.EmailJobWhereInput = {
      ...(query.status ? { status: query.status as EmailJobStatus } : {}),
      ...(query.type ? { type: query.type as EmailJobType } : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.emailJob.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.emailJob.count({ where }),
    ]);
    return {
      items: rows.map((job) => ({
        id: job.id,
        type: job.type,
        toEmailMasked: maskEmail(job.toEmail),
        payloadSummary: summarizeEmailPayload(job.payload),
        status: job.status,
        attempts: job.attempts,
        availableAt: job.availableAt,
        sentAt: job.sentAt,
        lastError: job.lastError,
        createdAt: job.createdAt,
      })),
      total,
    };
  }

  retryEmailJob(
    actorId: string,
    jobId: string,
  ): Promise<AdminEmailJobRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, actorId);
      const existing = await transaction.emailJob.findUnique({
        where: { id: jobId },
      });
      if (!existing) return null;
      if (existing.status === EmailJobStatus.SENT) {
        throw new AdminStateConflictError();
      }
      const updated = await transaction.emailJob.update({
        where: { id: existing.id },
        data: {
          status: EmailJobStatus.PENDING,
          lastError: null,
          lockedAt: null,
          availableAt: new Date(),
        },
      });
      await this.writeAudit(
        transaction,
        actor.id,
        "admin.email_job.retried",
        "email_job",
        updated.id,
        { type: updated.type },
      );
      return {
        id: updated.id,
        type: updated.type,
        toEmailMasked: maskEmail(updated.toEmail),
        payloadSummary: summarizeEmailPayload(updated.payload),
        status: updated.status,
        attempts: updated.attempts,
        availableAt: updated.availableAt,
        sentAt: updated.sentAt,
        lastError: updated.lastError,
        createdAt: updated.createdAt,
      };
    });
  }

  async listHashtags(
    query: AdminHashtagQuery,
  ): Promise<AdminPage<AdminHashtagRecord>> {
    const where: Prisma.HashtagWhereInput = query.q
      ? { tag: { contains: query.q.toLowerCase(), mode: "insensitive" } }
      : {};
    const [rows, total] = await this.database.$transaction([
      this.database.hashtag.findMany({
        where,
        orderBy: [{ postCount: "desc" }, { lastUsedAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          tag: true,
          postCount: true,
          lastUsedAt: true,
          createdAt: true,
        },
      }),
      this.database.hashtag.count({ where }),
    ]);
    return {
      items: rows.map((tag) => ({
        id: tag.id,
        tag: tag.tag,
        postCount: tag.postCount,
        lastUsedAt: tag.lastUsedAt,
        createdAt: tag.createdAt,
      })),
      total,
    };
  }

  deleteHashtag(
    actorId: string,
    hashtagId: string,
  ): Promise<AdminHashtagRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, actorId);
      const existing = await transaction.hashtag.findUnique({
        where: { id: hashtagId },
        select: {
          id: true,
          tag: true,
          postCount: true,
          lastUsedAt: true,
          createdAt: true,
        },
      });
      if (!existing) return null;
      await transaction.hashtag.delete({ where: { id: existing.id } });
      await this.writeAudit(
        transaction,
        actor.id,
        "admin.hashtag.deleted",
        "hashtag",
        existing.id,
        { tag: existing.tag },
      );
      return {
        id: existing.id,
        tag: existing.tag,
        postCount: existing.postCount,
        lastUsedAt: existing.lastUsedAt,
        createdAt: existing.createdAt,
      };
    });
  }

  async analytics(now: Date): Promise<AdminAnalyticsRecord> {
    const days = 30;
    const start = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - (days - 1),
    ));
    const [users, posts, reports] = await Promise.all([
      this.database.user.findMany({
        where: { createdAt: { gte: start }, deletedAt: null },
        select: { createdAt: true },
      }),
      this.database.post.findMany({
        where: { createdAt: { gte: start }, deletedAt: null },
        select: { createdAt: true },
      }),
      this.database.report.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true },
      }),
    ]);
    return {
      userSignups: buildDailySeries(start, days, users.map((row) => row.createdAt)),
      postsCreated: buildDailySeries(start, days, posts.map((row) => row.createdAt)),
      reportsFiled: buildDailySeries(start, days, reports.map((row) => row.createdAt)),
    };
  }

  private async requireAdminActor(
    transaction: Prisma.TransactionClient,
    actorId: string,
  ): Promise<{ id: string }> {
    const actor = await transaction.user.findFirst({
      where: {
        id: actorId,
        status: UserStatus.ACTIVE,
        role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
      },
      select: { id: true },
    });
    if (!actor) throw new AdminHierarchyError();
    return actor;
  }

  private async writeAudit(
    transaction: Prisma.TransactionClient,
    actorId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        actorType: AuditActorType.ADMIN,
        actorUserId: actorId,
        action,
        resourceType,
        resourceId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private mutateComment<T>(
    actorId: string,
    commentId: string,
    mutate: (
      transaction: Prisma.TransactionClient,
      comment: {
        id: string;
        authorId: string;
        isHidden: boolean;
        deletedAt: Date | null;
      },
    ) => Promise<T>,
  ): Promise<T | null> {
    return this.database.$transaction(
      async (transaction) => {
        const actor = await transaction.user.findFirst({
          where: {
            id: actorId,
            status: UserStatus.ACTIVE,
            role: {
              in: [UserRole.MODERATOR, UserRole.ADMIN, UserRole.SUPER_ADMIN],
            },
          },
          select: { id: true },
        });
        if (!actor) throw new AdminHierarchyError();
        const comment = await transaction.comment.findUnique({
          where: { id: commentId },
          select: {
            id: true,
            authorId: true,
            isHidden: true,
            deletedAt: true,
          },
        });
        if (!comment) return null;
        return mutate(transaction, comment);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private mutatePost<T>(
    actorId: string,
    postId: string,
    mutate: (
      transaction: Prisma.TransactionClient,
      post: { id: string; authorId: string; isHidden: boolean; deletedAt: Date | null },
    ) => Promise<T>,
  ): Promise<T | null> {
    return this.database.$transaction(
      async (transaction) => {
        const actor = await transaction.user.findFirst({
          where: {
            id: actorId,
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
        const post = await transaction.post.findUnique({
          where: { id: postId },
          select: {
            id: true,
            authorId: true,
            isHidden: true,
            deletedAt: true,
          },
        });
        if (!post) return null;
        return mutate(transaction, post);
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

function truncatePreview(body: string | null): string | null {
  if (!body) return null;
  const trimmed = body.trim();
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 157)}…`;
}

function mapAdminPost(
  post: Prisma.PostGetPayload<{ select: typeof postAdminSelect }>,
): AdminPostRecord {
  return {
    id: post.id,
    authorId: post.author.id,
    authorUsername: post.author.username,
    authorDisplayName: post.author.displayName,
    bodyPreview: truncatePreview(post.body),
    mediaCount: post._count.media,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    isHidden: post.isHidden,
    deletedAt: post.deletedAt,
    createdAt: post.createdAt,
  };
}

function mapAdminComment(
  comment: Prisma.CommentGetPayload<{ select: typeof commentAdminSelect }>,
): AdminCommentRecord {
  return {
    id: comment.id,
    postId: comment.postId,
    authorId: comment.author.id,
    authorUsername: comment.author.username,
    bodyPreview: truncatePreview(comment.body),
    likeCount: comment.likeCount,
    isHidden: comment.isHidden,
    deletedAt: comment.deletedAt,
    createdAt: comment.createdAt,
  };
}

function mapPremiumPlan(
  plan: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    priceCents: number;
    currency: string;
    durationDays: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count: { subscriptions: number };
  },
): AdminPremiumPlanRecord {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceCents: plan.priceCents,
    currency: plan.currency,
    durationDays: plan.durationDays,
    isActive: plan.isActive,
    subscriberCount: plan._count.subscriptions,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function mapAd(ad: {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  targetUrl: string | null;
  placement: string;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AdminAdRecord {
  return {
    id: ad.id,
    title: ad.title,
    body: ad.body,
    imageUrl: ad.imageUrl,
    targetUrl: ad.targetUrl,
    placement: ad.placement,
    isActive: ad.isActive,
    startsAt: ad.startsAt,
    endsAt: ad.endsAt,
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt,
  };
}

function mapCmsPage(page: {
  id: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AdminCmsPageRecord {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    bodyMarkdown: page.bodyMarkdown,
    status: page.status,
    publishedAt: page.publishedAt,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

function buildDailySeries(
  start: Date,
  days: number,
  timestamps: Date[],
): Array<{ date: string; count: number }> {
  const buckets = new Map<string, number>();
  for (let index = 0; index < days; index += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    buckets.set(day.toISOString().slice(0, 10), 0);
  }
  for (const timestamp of timestamps) {
    const key = timestamp.toISOString().slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || !local) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

function summarizeEmailPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if (typeof record.userId === "string") {
    summary.userId = record.userId;
  }
  return summary;
}
