import { syncUserPremiumState } from "../../premium/application/entitlements.js";
import {
  AdPlacement,
  AuditActorType,
  CmsPageStatus,
  EmailJobStatus,
  EmailJobType,
  MatchStatus,
  MediaKind,
  MediaVisibility,
  ConversationStatus,
  MessageType,
  OutboxStatus,
  Prisma,
  PremiumBillingCycle,
  ReportStatus,
  SubscriptionStatus,
  UserRole,
  UserStatus,
  WalletTransactionType,
  type PrismaClient,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import { consumerPlatformUserWhere } from "../../../shared/user-visibility.js";
import {
  creditWallet,
  debitWallet,
} from "../../rewards/infrastructure/prisma-rewards-repository.js";
import { InsufficientWalletBalanceError } from "../../rewards/application/ports/rewards-repository.js";
import { normalizeReferralCode } from "../../rewards/infrastructure/referral-code.js";

import type {
  AdminAuditLogQuery,
  AdminCommentQuery,
  AdminPage,
  AdminPostQuery,
  AdminReferralQuery,
  AdminStoryQuery,
  AdminReportQuery,
  AdminRepository,
  AdminUserQuery,
  OffsetPage,
  ChangeStaffRoleData,
  ChangeUserStatusData,
  CreateInterestTagData,
  CreateAdData,
  AdminAdQuery,
  UpdateAdPlacementConfigData,
  CreateCmsPageData,
  CreateBlogPostData,
  CreatePremiumPlanData,
  CancelSubscriptionData,
  AdminSubscriptionQuery,
  AdminAdjustWalletData,
  AdminWalletTransactionQuery,
  CreatePointPurchaseRateData,
  UpdatePointPurchaseRateData,
  DeleteCommentData,
  DeletePostData,
  DeleteStoryData,
  GrantSubscriptionData,
  ResolveReportData,
  SetVerifiedBadgeData,
  UpdateAdData,
  UpdateCmsPageData,
  UpdateBlogPostData,
  AdminBlogQuery,
  UpdateCommentVisibilityData,
  UpdateInterestTagData,
  UpdatePremiumPlanData,
  PremiumPlanPriceInput,
  UpdatePostVisibilityData,
  AdminEmailJobQuery,
  AdminHashtagQuery,
  AdminMatchQuery,
  AdminConversationQuery,
  DeleteAdminMessageData,
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
  AdminCommentsStatsRecord,
  AdminDashboardRecord,
  AdminInterestTagRecord,
  AdminModerationActionRecord,
  AdminPostRecord,
  AdminPostsStatsRecord,
  AdminStoryRecord,
  AdminStoriesStatsRecord,
  AdminPremiumPlanRecord,
  AdminPlanPriceRecord,
  AdminAdRecord,
  AdminAdPlacementConfigRecord,
  AdminAnalyticsRecord,
  AdminCmsPageRecord,
  AdminBlogPostRecord,
  AdminEmailJobRecord,
  AdminHashtagRecord,
  AdminMatchRecord,
  AdminMatchesStatsRecord,
  AdminReferralCodeLookupRecord,
  AdminReferralLeaderboardRecord,
  AdminReferralRecord,
  AdminReferralsStatsRecord,
  AdminConversationsStatsRecord,
  AdminConversationRecord,
  AdminConversationMessageRecord,
  AdminMediaContentRecord,
  AdminMediaRecord,
  AdminOutboxEventRecord,
  AdminSubscriptionRecord,
  AdminReportRecord,
  AdminUserDetailRecord,
  AdminUserRecord,
  AdminUsersStatsRecord,
  AdminVerificationStatsRecord,
  AdminWalletAdjustResultRecord,
  AdminWalletStatsRecord,
  AdminWalletTransactionRecord,
  AdminWalletUserRecord,
  AdminPointPurchaseRateRecord,
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
  country: true,
  profilePhotoMediaId: true,
  lastSeenAt: true,
  followerCount: true,
  followingCount: true,
  postCount: true,
  lastLoginAt: true,
  bannedAt: true,
  banReason: true,
  deletedAt: true,
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
  shareCount: true,
  isHidden: true,
  deletedAt: true,
  createdAt: true,
  author: {
    select: {
      id: true,
      username: true,
      displayName: true,
      isVerifiedBadge: true,
      profilePhotoMediaId: true,
    },
  },
  media: {
    orderBy: { sortOrder: "asc" },
    take: 4,
    select: {
      mediaAsset: { select: { id: true, mimeType: true } },
    },
  },
  reports: {
    where: {
      status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
    },
    select: { status: true },
  },
  _count: { select: { media: true } },
} satisfies Prisma.PostSelect;

const openReportPostFilter: Prisma.PostWhereInput = {
  reports: {
    some: {
      status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
    },
  },
};

const openReportCommentFilter: Prisma.CommentWhereInput = {
  reports: {
    some: {
      status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
    },
  },
};

const commentAdminSelect = {
  id: true,
  postId: true,
  parentId: true,
  depth: true,
  replyCount: true,
  body: true,
  likeCount: true,
  isHidden: true,
  deletedAt: true,
  createdAt: true,
  author: {
    select: {
      id: true,
      username: true,
      displayName: true,
      isVerifiedBadge: true,
      profilePhotoMediaId: true,
    },
  },
  reports: {
    where: {
      status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
    },
    select: { id: true },
  },
} satisfies Prisma.CommentSelect;

const storyAdminSelect = {
  id: true,
  caption: true,
  expiresAt: true,
  deletedAt: true,
  createdAt: true,
  author: {
    select: {
      id: true,
      username: true,
      displayName: true,
      isVerifiedBadge: true,
      profilePhotoMediaId: true,
    },
  },
  mediaAsset: {
    select: {
      id: true,
      mimeType: true,
    },
  },
  _count: { select: { views: true } },
} satisfies Prisma.StorySelect;

const openReportMessageFilter: Prisma.MessageWhereInput = {
  reports: {
    some: {
      status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
    },
  },
};

const conversationAdminSelect = {
  id: true,
  status: true,
  matchId: true,
  createdAt: true,
  updatedAt: true,
  members: {
    select: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          profilePhotoMediaId: true,
        },
      },
    },
  },
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: {
      body: true,
      type: true,
      createdAt: true,
      deletedForEveryoneAt: true,
    },
  },
  _count: { select: { messages: true } },
} satisfies Prisma.ConversationSelect;

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
        deletedUsers,
        totalPosts,
        totalComments,
        totalMessages,
        openReports,
        commerceRows,
      ] = await Promise.all([
        transaction.user.count({
          where: {
            status: { not: UserStatus.DELETED },
            deletedAt: null,
            ...consumerPlatformUserWhere(),
          },
        }),
        transaction.user.count({
          where: {
            status: UserStatus.ACTIVE,
            deletedAt: null,
            ...consumerPlatformUserWhere(),
            OR: [
              { lastSeenAt: { gte: dayStart } },
              { lastLoginAt: { gte: dayStart } },
            ],
          },
        }),
        transaction.user.count({
          where: {
            createdAt: { gte: dayStart },
            deletedAt: null,
            ...consumerPlatformUserWhere(),
          },
        }),
        transaction.user.count({
          where: {
            deletedAt: { not: null },
            ...consumerPlatformUserWhere(),
          },
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
        deletedUsers,
        totalPosts,
        totalComments,
        totalMessages,
        openReports,
        premiumUsers: Number(commerceRows[0]?.premiumUsers ?? 0),
        revenueCents: Number(commerceRows[0]?.revenueCents ?? 0),
      };
    });
  }

  async usersStats(now: Date): Promise<AdminUsersStatsRecord> {
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const onlineSince = new Date(now.getTime() - 15 * 60 * 1000);
    const activeWhere = {
      deletedAt: null,
      status: { not: UserStatus.DELETED },
      ...consumerPlatformUserWhere(),
    } as const;

    const [
      totalUsers,
      verifiedUsers,
      onlineNow,
      newUsersToday,
      suspendedUsers,
      reportedUsers,
      deletedUsers,
      genderGroups,
    ] = await Promise.all([
      this.database.user.count({ where: activeWhere }),
      this.database.user.count({
        where: { ...activeWhere, isVerifiedBadge: true },
      }),
      this.database.user.count({
        where: { ...activeWhere, lastSeenAt: { gte: onlineSince } },
      }),
      this.database.user.count({
        where: { ...activeWhere, createdAt: { gte: dayStart } },
      }),
      this.database.user.count({ where: { status: UserStatus.SUSPENDED } }),
      this.database.user.count({
        where: {
          ...activeWhere,
          reportsAgainst: {
            some: {
              status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
            },
          },
        },
      }),
      this.database.user.count({
        where: {
          deletedAt: { not: null },
          ...consumerPlatformUserWhere(),
        },
      }),
      this.database.user.groupBy({
        by: ["gender"],
        where: activeWhere,
        _count: { _all: true },
      }),
    ]);

    const maleUsers =
      genderGroups.find((row) => row.gender === "MALE")?._count._all ?? 0;
    const femaleUsers =
      genderGroups.find((row) => row.gender === "FEMALE")?._count._all ?? 0;

    return {
      totalUsers,
      verifiedUsers,
      onlineNow,
      newUsersToday,
      maleUsers,
      femaleUsers,
      suspendedUsers,
      reportedUsers,
      deletedUsers,
    };
  }

  async verificationStats(): Promise<AdminVerificationStatsRecord> {
    const activeWhere = {
      deletedAt: null,
      status: UserStatus.ACTIVE,
      ...consumerPlatformUserWhere(),
    } as const;

    const [totalActive, pendingBadge, verifiedBadge, emailUnverified] = await Promise.all([
      this.database.user.count({ where: activeWhere }),
      this.database.user.count({
        where: { ...activeWhere, isVerifiedBadge: false },
      }),
      this.database.user.count({
        where: { ...activeWhere, isVerifiedBadge: true },
      }),
      this.database.user.count({
        where: { ...activeWhere, emailVerifiedAt: null },
      }),
    ]);

    return {
      totalActive,
      pendingBadge,
      verifiedBadge,
      emailUnverified,
    };
  }

  async listUsers(
    query: AdminUserQuery,
  ): Promise<AdminPage<AdminUserRecord>> {
    const where: Prisma.UserWhereInput = {
      ...consumerPlatformUserWhere(),
      ...(query.status ? { status: query.status } : {}),
      ...(query.verified !== undefined ? { isVerifiedBadge: query.verified } : {}),
      ...(query.online
        ? {
            lastSeenAt: {
              gte: new Date(Date.now() - 15 * 60 * 1000),
            },
          }
        : {}),
      ...(query.reported
        ? {
            reportsAgainst: {
              some: {
                status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
              },
            },
          }
        : {}),
      ...(query.emailVerified === true
        ? { emailVerifiedAt: { not: null } }
        : query.emailVerified === false
          ? { emailVerifiedAt: null }
          : {}),
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
        country: true,
        gender: true,
        ageRange: true,
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
    const bucket = query.bucket ?? "all";
    const where: Prisma.PostWhereInput = {
      ...(query.q
        ? {
            OR: [
              { body: { contains: query.q, mode: "insensitive" } },
              ...(isUuid(query.q) ? [{ id: query.q }] : []),
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
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: query.createdFrom } : {}),
              ...(query.createdTo ? { lte: query.createdTo } : {}),
            },
          }
        : {}),
      ...(query.mediaKind === "text"
        ? { media: { none: {} }, body: { not: null } }
        : query.mediaKind === "image"
          ? {
              media: {
                some: { mediaAsset: { mimeType: { startsWith: "image/" } } },
              },
            }
          : query.mediaKind === "video"
            ? {
                media: {
                  some: { mediaAsset: { mimeType: { startsWith: "video/" } } },
                },
              }
            : query.mediaKind === "audio"
              ? {
                  media: {
                    some: { mediaAsset: { mimeType: { startsWith: "audio/" } } },
                  },
                }
              : {}),
    };

    if (bucket === "removed") {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
      if (bucket === "reported") {
        Object.assign(where, openReportPostFilter);
      } else if (bucket === "pending") {
        where.reports = {
          some: { status: ReportStatus.UNDER_REVIEW },
        };
      } else if (bucket === "hidden") {
        where.isHidden = true;
      } else if (query.hidden !== undefined) {
        where.isHidden = query.hidden;
      }
    }

    if (query.includeDeleted && bucket !== "removed") {
      delete where.deletedAt;
    }

    const [rows, total] = await this.database.$transaction([
      this.database.post.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: postAdminSelect,
      }),
      this.database.post.count({ where }),
    ]);
    return {
      items: rows.map((post) => mapAdminPost(post)),
      total,
    };
  }

  async postsStats(): Promise<AdminPostsStatsRecord> {
    const [totalPosts, approvedPosts, reportedPosts, pendingReviewPosts, hiddenPosts, removedPosts] =
      await Promise.all([
        this.database.post.count({ where: { deletedAt: null } }),
        this.database.post.count({
          where: { deletedAt: null, isHidden: false },
        }),
        this.database.post.count({
          where: { deletedAt: null, ...openReportPostFilter },
        }),
        this.database.post.count({
          where: {
            deletedAt: null,
            reports: { some: { status: ReportStatus.UNDER_REVIEW } },
          },
        }),
        this.database.post.count({
          where: { deletedAt: null, isHidden: true },
        }),
        this.database.post.count({ where: { deletedAt: { not: null } } }),
      ]);

    return {
      totalPosts,
      approvedPosts,
      reportedPosts,
      pendingReviewPosts,
      hiddenPosts,
      removedPosts,
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

  async listStories(
    query: AdminStoryQuery,
  ): Promise<AdminPage<AdminStoryRecord>> {
    const now = new Date();
    const bucket = query.bucket ?? "all";
    const where: Prisma.StoryWhereInput = {
      ...(query.q
        ? {
            OR: [
              { caption: { contains: query.q, mode: "insensitive" } },
              ...(isUuid(query.q) ? [{ id: query.q }] : []),
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
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: query.createdFrom } : {}),
              ...(query.createdTo ? { lte: query.createdTo } : {}),
            },
          }
        : {}),
    };

    if (bucket === "removed") {
      where.deletedAt = { not: null };
    } else if (bucket === "active") {
      where.deletedAt = null;
      where.expiresAt = { gt: now };
    } else if (bucket === "expired") {
      where.deletedAt = null;
      where.expiresAt = { lte: now };
    } else {
      where.deletedAt = null;
    }

    const [rows, total] = await this.database.$transaction([
      this.database.story.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: storyAdminSelect,
      }),
      this.database.story.count({ where }),
    ]);
    return {
      items: rows.map((story) => mapAdminStory(story)),
      total,
    };
  }

  async storiesStats(now: Date): Promise<AdminStoriesStatsRecord> {
    const notDeleted = { deletedAt: null };
    const [
      totalStories,
      activeStories,
      expiredStories,
      removedStories,
      totalViews,
    ] = await Promise.all([
      this.database.story.count({ where: notDeleted }),
      this.database.story.count({
        where: { ...notDeleted, expiresAt: { gt: now } },
      }),
      this.database.story.count({
        where: { ...notDeleted, expiresAt: { lte: now } },
      }),
      this.database.story.count({ where: { deletedAt: { not: null } } }),
      this.database.storyView.count(),
    ]);
    return {
      totalStories,
      activeStories,
      expiredStories,
      removedStories,
      totalViews,
    };
  }

  deleteStory(data: DeleteStoryData): Promise<AdminStoryRecord | null> {
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

        const story = await transaction.story.findUnique({
          where: { id: data.storyId },
          select: {
            id: true,
            authorId: true,
            deletedAt: true,
          },
        });
        if (!story) return null;
        if (story.deletedAt) throw new AdminStateConflictError();

        const updated = await transaction.story.update({
          where: { id: story.id },
          data: { deletedAt: new Date() },
          select: storyAdminSelect,
        });
        await transaction.moderationAction.create({
          data: {
            actorId: data.actorId,
            targetUserId: story.authorId,
            actionCode: "STORY_REMOVED",
            note: data.note ?? null,
            metadata: { storyId: story.id },
          },
        });
        await transaction.auditLog.create({
          data: {
            actorType: AuditActorType.ADMIN,
            actorUserId: data.actorId,
            action: "admin.story.deleted",
            resourceType: "story",
            resourceId: story.id,
            metadata: { actionCode: "STORY_REMOVED" },
          },
        });
        return mapAdminStory(updated);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listComments(
    query: AdminCommentQuery,
  ): Promise<AdminPage<AdminCommentRecord>> {
    const bucket = query.bucket ?? "all";
    const where: Prisma.CommentWhereInput = {
      ...(query.postId ? { postId: query.postId } : {}),
      ...(query.q
        ? {
            OR: [
              { body: { contains: query.q, mode: "insensitive" } },
              ...(isUuid(query.q) ? [{ id: query.q }] : []),
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
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: query.createdFrom } : {}),
              ...(query.createdTo ? { lte: query.createdTo } : {}),
            },
          }
        : {}),
    };

    if (bucket === "removed") {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
      if (bucket === "reported") {
        Object.assign(where, openReportCommentFilter);
      } else if (bucket === "hidden") {
        where.isHidden = true;
      } else if (bucket === "replies") {
        where.depth = { gt: 0 };
      } else if (query.hidden !== undefined) {
        where.isHidden = query.hidden;
      }
    }

    if (query.includeDeleted && bucket !== "removed") {
      delete where.deletedAt;
    }

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

  async commentsStats(): Promise<AdminCommentsStatsRecord> {
    const [
      totalComments,
      visibleComments,
      reportedComments,
      hiddenComments,
      removedComments,
      replyComments,
    ] = await Promise.all([
      this.database.comment.count({ where: { deletedAt: null } }),
      this.database.comment.count({
        where: { deletedAt: null, isHidden: false },
      }),
      this.database.comment.count({
        where: { deletedAt: null, ...openReportCommentFilter },
      }),
      this.database.comment.count({
        where: { deletedAt: null, isHidden: true },
      }),
      this.database.comment.count({ where: { deletedAt: { not: null } } }),
      this.database.comment.count({
        where: { deletedAt: null, depth: { gt: 0 } },
      }),
    ]);

    return {
      totalComments,
      visibleComments,
      reportedComments,
      hiddenComments,
      removedComments,
      replyComments,
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
        orderBy: [{ sortOrder: "asc" }, { isActive: "desc" }, { priceCents: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: premiumPlanSelect(),
      }),
      this.database.premiumPlan.count(),
    ]);
    return {
      items: rows.map((plan) => mapPremiumPlan(plan)),
      total,
    };
  }

  createPremiumPlan(data: CreatePremiumPlanData): Promise<AdminPremiumPlanRecord> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const prices =
        data.prices ??
        defaultPlanPricesFromMonthly(data.priceCents, data.durationDays);
      const monthly = prices.find((price) => price.billingCycle === "MONTHLY");
      const created = await transaction.premiumPlan.create({
        data: {
          code: data.code,
          name: data.name,
          description: data.description ?? null,
          tier: (data.tier as "PLUS" | "GOLD" | "ELITE" | undefined) ?? "PLUS",
          sortOrder: data.sortOrder ?? 0,
          badgeLabel: data.badgeLabel ?? "Premium",
          priceCents: monthly?.priceCents ?? data.priceCents,
          currency: data.currency,
          durationDays: monthly?.durationDays ?? data.durationDays,
          adsFree: data.adsFree ?? true,
          houseAdsFree: data.houseAdsFree ?? false,
          profileViews: data.profileViews ?? true,
          discoverBoost: data.discoverBoost ?? 1,
          grantVerifiedBadge: data.grantVerifiedBadge ?? false,
          dailyInterestLimit: data.dailyInterestLimit ?? 10,
          interstitialAdsFree: data.interstitialAdsFree ?? true,
          directMessageEnabled: data.directMessageEnabled ?? false,
        },
        select: { id: true },
      });
      await upsertPlanPrices(transaction, created.id, prices);
      const loaded = await transaction.premiumPlan.findUniqueOrThrow({
        where: { id: created.id },
        select: premiumPlanSelect(),
      });
      await this.writeAudit(transaction, actor.id, "admin.plan.created", "premium_plan", loaded.id, {
        code: loaded.code,
      });
      return mapPremiumPlan(loaded);
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
      await transaction.premiumPlan.update({
        where: { id: existing.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.tier !== undefined ? { tier: data.tier as "PLUS" | "GOLD" | "ELITE" } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
          ...(data.badgeLabel !== undefined ? { badgeLabel: data.badgeLabel } : {}),
          ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
          ...(data.durationDays !== undefined ? { durationDays: data.durationDays } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.adsFree !== undefined ? { adsFree: data.adsFree } : {}),
          ...(data.houseAdsFree !== undefined ? { houseAdsFree: data.houseAdsFree } : {}),
          ...(data.profileViews !== undefined ? { profileViews: data.profileViews } : {}),
          ...(data.discoverBoost !== undefined ? { discoverBoost: data.discoverBoost } : {}),
          ...(data.grantVerifiedBadge !== undefined ? { grantVerifiedBadge: data.grantVerifiedBadge } : {}),
          ...(data.dailyInterestLimit !== undefined ? { dailyInterestLimit: data.dailyInterestLimit } : {}),
          ...(data.interstitialAdsFree !== undefined ? { interstitialAdsFree: data.interstitialAdsFree } : {}),
          ...(data.directMessageEnabled !== undefined ? { directMessageEnabled: data.directMessageEnabled } : {}),
        },
      });
      if (data.prices?.length) {
        await upsertPlanPrices(transaction, existing.id, data.prices);
      } else if (
        data.priceCents !== undefined ||
        data.durationDays !== undefined
      ) {
        const current = await transaction.premiumPlan.findUniqueOrThrow({
          where: { id: existing.id },
          select: { priceCents: true, durationDays: true },
        });
        await upsertPlanPrices(
          transaction,
          existing.id,
          defaultPlanPricesFromMonthly(
            data.priceCents ?? current.priceCents,
            data.durationDays ?? current.durationDays,
          ),
        );
      }
      const loaded = await transaction.premiumPlan.findUniqueOrThrow({
        where: { id: existing.id },
        select: premiumPlanSelect(),
      });
      await this.writeAudit(transaction, actor.id, "admin.plan.updated", "premium_plan", loaded.id, {});
      return mapPremiumPlan(loaded);
    });
  }

  async listSubscriptions(
    query: AdminSubscriptionQuery,
  ): Promise<AdminPage<AdminSubscriptionRecord>> {
    const where: Prisma.UserSubscriptionWhereInput = {
      ...(query.status ? { status: query.status as SubscriptionStatus } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.q
        ? {
            OR: [
              ...(isUuid(query.q) ? [{ userId: query.q }, { id: query.q }] : []),
              { user: { username: { contains: query.q, mode: "insensitive" } } },
              { user: { email: { contains: query.q, mode: "insensitive" } } },
              { user: { displayName: { contains: query.q, mode: "insensitive" } } },
              { plan: { name: { contains: query.q, mode: "insensitive" } } },
              { plan: { code: { contains: query.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.userSubscription.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: subscriptionAdminSelect,
      }),
      this.database.userSubscription.count({ where }),
    ]);
    return {
      items: rows.map(mapAdminSubscriptionRecord),
      total,
    };
  }

  grantSubscription(data: GrantSubscriptionData): Promise<AdminSubscriptionRecord> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const billingCycle = (data.billingCycle ?? "MONTHLY") as PremiumBillingCycle;
      const [user, plan] = await Promise.all([
        transaction.user.findUnique({
          where: { id: data.userId },
          select: { id: true, username: true },
        }),
        transaction.premiumPlan.findFirst({
          where: { id: data.planId, isActive: true },
          select: {
            id: true,
            name: true,
            code: true,
            prices: {
              where: { billingCycle, isActive: true },
              select: { id: true, durationDays: true },
              take: 1,
            },
          },
        }),
      ]);
      if (!user || !plan) throw new AdminStateConflictError();
      const planPrice = plan.prices[0];
      if (!planPrice) throw new AdminStateConflictError();
      const now = new Date();
      const endsAt = new Date(now);
      endsAt.setUTCDate(endsAt.getUTCDate() + planPrice.durationDays);
      await transaction.userSubscription.updateMany({
        where: { userId: user.id, status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now },
      });
      const created = await transaction.userSubscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          planPriceId: planPrice.id,
          billingCycle,
          status: SubscriptionStatus.ACTIVE,
          startsAt: now,
          endsAt,
        },
        select: subscriptionAdminSelect,
      });
      await this.writeAudit(transaction, actor.id, "admin.subscription.granted", "subscription", created.id, {
        userId: user.id,
        planId: plan.id,
      });
      return mapAdminSubscriptionRecord(created);
    }).then(async (record) => {
      await syncUserPremiumState(this.database, record.userId);
      return record;
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
        select: subscriptionAdminSelect,
      });
      await this.writeAudit(transaction, actor.id, "admin.subscription.cancelled", "subscription", updated.id, {});
      return mapAdminSubscriptionRecord(updated);
    }).then(async (record) => {
      if (!record) return null;
      await syncUserPremiumState(this.database, record.userId);
      return record;
    });
  }

  async listAds(query: AdminAdQuery): Promise<AdminPage<AdminAdRecord>> {
    const where: Prisma.AdvertisementWhereInput = {
      ...(query.placement
        ? { placement: query.placement as AdPlacement }
        : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const [rows, total] = await this.database.$transaction([
      this.database.advertisement.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { priority: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.advertisement.count({ where }),
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
          ctaLabel: data.ctaLabel ?? null,
          placement: data.placement as Prisma.AdvertisementCreateInput["placement"],
          priority: data.priority ?? 0,
          insertEvery: data.insertEvery ?? null,
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
      if (data.ctaLabel !== undefined) patch.ctaLabel = data.ctaLabel;
      if (data.placement !== undefined) patch.placement = data.placement as AdPlacement;
      if (data.priority !== undefined) patch.priority = data.priority;
      if (data.insertEvery !== undefined) patch.insertEvery = data.insertEvery;
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

  async listAdPlacementConfigs(): Promise<AdminAdPlacementConfigRecord[]> {
    const rows = await this.database.adPlacementConfig.findMany({
      orderBy: { placement: "asc" },
    });
    return rows.map(mapAdPlacementConfig);
  }

  updateAdPlacementConfig(
    data: UpdateAdPlacementConfigData,
  ): Promise<AdminAdPlacementConfigRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const existing = await transaction.adPlacementConfig.findUnique({
        where: { placement: data.placement as AdPlacement },
      });
      if (!existing) return null;
      const updated = await transaction.adPlacementConfig.update({
        where: { placement: existing.placement },
        data: {
          ...(data.label !== undefined ? { label: data.label } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.isEnabled !== undefined ? { isEnabled: data.isEnabled } : {}),
          ...(data.insertEvery !== undefined ? { insertEvery: data.insertEvery } : {}),
        },
      });
      await this.writeAudit(
        transaction,
        actor.id,
        "admin.ad_placement.updated",
        "ad_placement_config",
        updated.placement,
        {},
      );
      return mapAdPlacementConfig(updated);
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

  async listBlogPosts(
    query: AdminBlogQuery,
  ): Promise<AdminPage<AdminBlogPostRecord>> {
    const page = Math.max(query.page, 1);
    const pageSize = Math.min(Math.max(query.pageSize, 1), 100);
    const skip = (page - 1) * pageSize;
    const where =
      query.status !== undefined
        ? { status: query.status as CmsPageStatus }
        : {};
    const [rows, total] = await Promise.all([
      this.database.blogPost.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip,
        take: pageSize,
      }),
      this.database.blogPost.count({ where }),
    ]);
    return { items: rows.map(mapBlogPost), total };
  }

  createBlogPost(data: CreateBlogPostData): Promise<AdminBlogPostRecord> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const status = (data.status ?? "DRAFT") as CmsPageStatus;
      const created = await transaction.blogPost.create({
        data: {
          slug: data.slug,
          title: data.title,
          excerpt: data.excerpt ?? null,
          bodyMarkdown: data.bodyMarkdown,
          coverImageUrl: data.coverImageUrl ?? null,
          metaDescription: data.metaDescription ?? null,
          status,
          publishedAt: status === CmsPageStatus.PUBLISHED ? new Date() : null,
        },
      });
      await this.writeAudit(transaction, actor.id, "admin.blog.created", "blog_post", created.id, {
        slug: created.slug,
      });
      return mapBlogPost(created);
    });
  }

  updateBlogPost(data: UpdateBlogPostData): Promise<AdminBlogPostRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const existing = await transaction.blogPost.findUnique({
        where: { id: data.postId },
        select: { id: true, status: true, publishedAt: true },
      });
      if (!existing) return null;
      const nextStatus = data.status as CmsPageStatus | undefined;
      const updated = await transaction.blogPost.update({
        where: { id: existing.id },
        data: {
          ...(data.slug !== undefined ? { slug: data.slug } : {}),
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.excerpt !== undefined ? { excerpt: data.excerpt } : {}),
          ...(data.bodyMarkdown !== undefined ? { bodyMarkdown: data.bodyMarkdown } : {}),
          ...(data.coverImageUrl !== undefined ? { coverImageUrl: data.coverImageUrl } : {}),
          ...(data.metaDescription !== undefined
            ? { metaDescription: data.metaDescription }
            : {}),
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
      await this.writeAudit(transaction, actor.id, "admin.blog.updated", "blog_post", updated.id, {});
      return mapBlogPost(updated);
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
              ...(isUuid(query.q) ? [{ id: query.q }] : []),
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
            select: {
              id: true,
              username: true,
              displayName: true,
              profilePhotoMediaId: true,
            },
          },
          userB: {
            select: {
              id: true,
              username: true,
              displayName: true,
              profilePhotoMediaId: true,
            },
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
        userAProfilePhotoMediaId: match.userA.profilePhotoMediaId,
        userBId: match.userB.id,
        userBUsername: match.userB.username,
        userBDisplayName: match.userB.displayName,
        userBProfilePhotoMediaId: match.userB.profilePhotoMediaId,
        messageCount: match.conversation?._count.messages ?? 0,
        createdAt: match.createdAt,
      })),
      total,
    };
  }

  async matchesStats(now: Date): Promise<AdminMatchesStatsRecord> {
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [
      totalMatches,
      activeMatches,
      unmatchedMatches,
      withMessages,
      matchedToday,
    ] = await Promise.all([
      this.database.match.count(),
      this.database.match.count({ where: { status: MatchStatus.ACTIVE } }),
      this.database.match.count({ where: { status: MatchStatus.UNMATCHED } }),
      this.database.match.count({
        where: { conversation: { messages: { some: {} } } },
      }),
      this.database.match.count({ where: { matchedAt: { gte: dayStart } } }),
    ]);
    return {
      totalMatches,
      activeMatches,
      unmatchedMatches,
      withMessages,
      matchedToday,
    };
  }

  async referralsStats(now: Date): Promise<AdminReferralsStatsRecord> {
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const weekStart = new Date(dayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(dayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
    const trendStart = new Date(dayStart.getTime() - 13 * 24 * 60 * 60 * 1000);
    const consumerWhere = consumerPlatformUserWhere();

    const [
      totalReferrals,
      referralsToday,
      referralsLast7Days,
      referralsLast30Days,
      referralCodesIssued,
      referredSignups,
      totalConsumerUsers,
      rewardAggregate,
      sampleReferral,
      trendRows,
      referrerGroups,
    ] = await Promise.all([
      this.database.referral.count(),
      this.database.referral.count({ where: { createdAt: { gte: dayStart } } }),
      this.database.referral.count({ where: { createdAt: { gte: weekStart } } }),
      this.database.referral.count({ where: { createdAt: { gte: monthStart } } }),
      this.database.referralCode.count(),
      this.database.user.count({
        where: { ...consumerWhere, referredByUserId: { not: null } },
      }),
      this.database.user.count({ where: consumerWhere }),
      this.database.referral.aggregate({ _sum: { rewardPoints: true } }),
      this.database.referral.findFirst({
        select: { rewardPoints: true },
        orderBy: { createdAt: "desc" },
      }),
      this.database.referral.findMany({
        where: { createdAt: { gte: trendStart } },
        select: { createdAt: true },
      }),
      this.database.referral.groupBy({
        by: ["referrerUserId"],
        _count: { _all: true },
      }),
    ]);

    const referredSignupShare = totalConsumerUsers
      ? Math.round((referredSignups / totalConsumerUsers) * 1000) / 10
      : 0;

    return {
      totalReferrals,
      referralsToday,
      referralsLast7Days,
      referralsLast30Days,
      activeReferrers: referrerGroups.length,
      referralCodesIssued,
      referredSignupShare,
      totalRewardPointsPaid: rewardAggregate._sum.rewardPoints ?? 0,
      rewardPerReferral: sampleReferral?.rewardPoints ?? 0,
      sharingActive: referralsLast7Days > 0,
      referralsTrend: buildDailySeries(
        trendStart,
        14,
        trendRows.map((row) => row.createdAt),
      ),
    };
  }

  async listReferrals(
    query: AdminReferralQuery,
  ): Promise<AdminPage<AdminReferralRecord>> {
    const where: Prisma.ReferralWhereInput = {
      ...(query.referrerUserId ? { referrerUserId: query.referrerUserId } : {}),
      ...(query.q
        ? {
            OR: [
              {
                referrer: {
                  username: { contains: query.q, mode: "insensitive" },
                },
              },
              {
                referrer: {
                  displayName: { contains: query.q, mode: "insensitive" },
                },
              },
              {
                referred: {
                  username: { contains: query.q, mode: "insensitive" },
                },
              },
              {
                referred: {
                  displayName: { contains: query.q, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.database.$transaction([
      this.database.referral.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          referrerUserId: true,
          referredUserId: true,
          rewardPoints: true,
          status: true,
          createdAt: true,
          referrer: {
            select: { username: true, displayName: true },
          },
          referred: {
            select: { username: true, displayName: true },
          },
        },
      }),
      this.database.referral.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        referrerUserId: row.referrerUserId,
        referrerUsername: row.referrer.username,
        referrerDisplayName: row.referrer.displayName,
        referredUserId: row.referredUserId,
        referredUsername: row.referred.username,
        referredDisplayName: row.referred.displayName,
        rewardPoints: row.rewardPoints,
        status: row.status,
        createdAt: row.createdAt,
      })),
      total,
    };
  }

  async listReferralLeaderboard(
    query: OffsetPage,
  ): Promise<AdminPage<AdminReferralLeaderboardRecord>> {
    const grouped = await this.database.referral.groupBy({
      by: ["referrerUserId"],
      _count: { _all: true },
      _sum: { rewardPoints: true },
      _max: { createdAt: true },
      orderBy: { _count: { referrerUserId: "desc" } },
    });

    const total = grouped.length;
    const pageRows = grouped.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize,
    );
    const userIds = pageRows.map((row) => row.referrerUserId);
    if (userIds.length === 0) {
      return { items: [], total };
    }

    const [users, codes] = await Promise.all([
      this.database.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          username: true,
          displayName: true,
          profilePhotoMediaId: true,
        },
      }),
      this.database.referralCode.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, code: true },
      }),
    ]);

    const userById = new Map(users.map((user) => [user.id, user]));
    const codeByUserId = new Map(codes.map((code) => [code.userId, code.code]));

    return {
      items: pageRows.map((row) => {
        const user = userById.get(row.referrerUserId);
        return {
          userId: row.referrerUserId,
          username: user?.username ?? "unknown",
          displayName: user?.displayName ?? null,
          profilePhotoMediaId: user?.profilePhotoMediaId ?? null,
          referralCode: codeByUserId.get(row.referrerUserId) ?? "—",
          referralCount: row._count._all,
          totalEarned: row._sum.rewardPoints ?? 0,
          lastReferralAt: row._max.createdAt,
        };
      }),
      total,
    };
  }

  async lookupReferralCode(
    code: string,
  ): Promise<AdminReferralCodeLookupRecord | null> {
    const normalized = normalizeReferralCode(code);
    const row = await this.database.referralCode.findUnique({
      where: { code: normalized },
      select: {
        code: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            profilePhotoMediaId: true,
            status: true,
          },
        },
      },
    });
    if (!row) return null;

    const aggregate = await this.database.referral.aggregate({
      where: { referrerUserId: row.user.id },
      _count: { _all: true },
      _sum: { rewardPoints: true },
    });

    return {
      code: row.code,
      userId: row.user.id,
      username: row.user.username,
      displayName: row.user.displayName,
      profilePhotoMediaId: row.user.profilePhotoMediaId,
      userStatus: row.user.status,
      referralCount: aggregate._count._all,
      totalEarned: aggregate._sum.rewardPoints ?? 0,
      codeCreatedAt: row.createdAt,
    };
  }

  async listConversations(
    query: AdminConversationQuery,
  ): Promise<AdminPage<AdminConversationRecord>> {
    const bucket = query.bucket ?? "all";
    const where: Prisma.ConversationWhereInput = {
      ...(query.q
        ? {
            OR: [
              ...(isUuid(query.q) ? [{ id: query.q }, { matchId: query.q }] : []),
              {
                members: {
                  some: {
                    user: {
                      username: { contains: query.q, mode: "insensitive" },
                    },
                  },
                },
              },
              {
                members: {
                  some: {
                    user: {
                      displayName: { contains: query.q, mode: "insensitive" },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    if (bucket === "active") {
      where.status = ConversationStatus.ACTIVE;
    } else if (bucket === "closed") {
      where.status = ConversationStatus.CLOSED;
    } else if (bucket === "reported") {
      where.messages = { some: openReportMessageFilter };
    }

    const [rows, total] = await this.database.$transaction([
      this.database.conversation.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: conversationAdminSelect,
      }),
      this.database.conversation.count({ where }),
    ]);

    const reportCounts = await this.openReportCountsByConversation(
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) =>
        mapAdminConversation(row, reportCounts.get(row.id) ?? 0),
      ),
      total,
    };
  }

  async conversationsStats(now: Date): Promise<AdminConversationsStatsRecord> {
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [
      totalConversations,
      activeConversations,
      closedConversations,
      reportedConversations,
      totalMessages,
      messagesToday,
    ] = await Promise.all([
      this.database.conversation.count(),
      this.database.conversation.count({
        where: { status: ConversationStatus.ACTIVE },
      }),
      this.database.conversation.count({
        where: { status: ConversationStatus.CLOSED },
      }),
      this.database.conversation.count({
        where: { messages: { some: openReportMessageFilter } },
      }),
      this.database.message.count({
        where: { deletedForEveryoneAt: null },
      }),
      this.database.message.count({
        where: { createdAt: { gte: dayStart }, deletedForEveryoneAt: null },
      }),
    ]);
    return {
      totalConversations,
      activeConversations,
      closedConversations,
      reportedConversations,
      totalMessages,
      messagesToday,
    };
  }

  async listConversationMessages(
    conversationId: string,
    query: OffsetPage,
  ): Promise<AdminPage<AdminConversationMessageRecord>> {
    const where: Prisma.MessageWhereInput = { conversationId };
    const [rows, total] = await this.database.$transaction([
      this.database.message.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          conversationId: true,
          type: true,
          body: true,
          deletedForEveryoneAt: true,
          createdAt: true,
          sender: { select: { id: true, username: true } },
          mediaAsset: { select: { id: true, mimeType: true } },
          reports: {
            where: {
              status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
            },
            select: { id: true },
          },
        },
      }),
      this.database.message.count({ where }),
    ]);
    return {
      items: rows.map((message) => mapAdminConversationMessage(message)),
      total,
    };
  }

  deleteMessageForEveryone(
    data: DeleteAdminMessageData,
  ): Promise<AdminConversationMessageRecord | null> {
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

        const message = await transaction.message.findUnique({
          where: { id: data.messageId },
          select: {
            id: true,
            conversationId: true,
            senderId: true,
            type: true,
            body: true,
            deletedForEveryoneAt: true,
            createdAt: true,
            mediaAssetId: true,
            sender: { select: { id: true, username: true } },
            mediaAsset: { select: { id: true, mimeType: true } },
            reports: {
              where: {
                status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
              },
              select: { id: true },
            },
          },
        });
        if (!message) return null;
        if (message.deletedForEveryoneAt) throw new AdminStateConflictError();

        const deletedAt = new Date();
        await transaction.message.update({
          where: { id: message.id },
          data: {
            body: null,
            mediaAssetId: null,
            deletedForEveryoneAt: deletedAt,
          },
        });
        if (message.mediaAssetId) {
          await transaction.mediaAsset.update({
            where: { id: message.mediaAssetId },
            data: { deletedAt },
          });
        }
        await transaction.moderationAction.create({
          data: {
            actorId: data.actorId,
            targetUserId: message.senderId,
            actionCode: "MESSAGE_REMOVED",
            note: data.note ?? null,
            metadata: {
              messageId: message.id,
              conversationId: message.conversationId,
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            actorType: AuditActorType.ADMIN,
            actorUserId: data.actorId,
            action: "admin.message.deleted",
            resourceType: "message",
            resourceId: message.id,
            metadata: {
              actionCode: "MESSAGE_REMOVED",
              conversationId: message.conversationId,
            },
          },
        });
        return mapAdminConversationMessage({
          ...message,
          body: null,
          deletedForEveryoneAt: deletedAt,
          mediaAsset: null,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async openReportCountsByConversation(
    conversationIds: string[],
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await this.database.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        reports: {
          some: {
            status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
          },
        },
      },
      select: { conversationId: true },
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.conversationId, (counts.get(row.conversationId) ?? 0) + 1);
    }
    return counts;
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
    const demographicsWhere = {
      deletedAt: null,
      status: { not: UserStatus.DELETED },
    } as const;

    const [users, posts, reports, genderGroups, ageGroups, countryGroups, demographicsTotal] =
      await Promise.all([
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
      this.database.user.groupBy({
        by: ["gender"],
        where: demographicsWhere,
        _count: { _all: true },
      }),
      this.database.user.groupBy({
        by: ["ageRange"],
        where: demographicsWhere,
        _count: { _all: true },
      }),
      this.database.user.groupBy({
        by: ["country"],
        where: demographicsWhere,
        _count: { _all: true },
        orderBy: { _count: { country: "desc" } },
        take: 20,
      }),
      this.database.user.count({ where: demographicsWhere }),
    ]);

    return {
      userSignups: buildDailySeries(start, days, users.map((row) => row.createdAt)),
      postsCreated: buildDailySeries(start, days, posts.map((row) => row.createdAt)),
      reportsFiled: buildDailySeries(start, days, reports.map((row) => row.createdAt)),
      demographics: {
        totalUsers: demographicsTotal,
        gender: buildDemographicBuckets(
          genderGroups.map((row) => ({
            key: row.gender,
            count: row._count._all,
          })),
          demographicsTotal,
          formatGenderLabel,
        ),
        ageRanges: buildDemographicBuckets(
          ageGroups.map((row) => ({
            key: row.ageRange,
            count: row._count._all,
          })),
          demographicsTotal,
          formatAgeRangeLabel,
          ageRangeSortKey,
        ),
        countries: buildDemographicBuckets(
          countryGroups.map((row) => ({
            key: row.country,
            count: row._count._all,
          })),
          demographicsTotal,
          (key) => key.trim() || "Unknown",
        ),
      },
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

  async walletStats(): Promise<AdminWalletStatsRecord> {
    const [aggregate, adminAdjustmentsCount] = await Promise.all([
      this.database.wallet.aggregate({
        _count: { userId: true },
        _sum: { balance: true, lifetimeEarned: true },
      }),
      this.database.walletTransaction.count({
        where: { type: WalletTransactionType.ADMIN_ADJUST },
      }),
    ]);
    return {
      totalWallets: aggregate._count.userId,
      totalBalance: aggregate._sum.balance ?? 0,
      totalLifetimeEarned: aggregate._sum.lifetimeEarned ?? 0,
      adminAdjustmentsCount,
    };
  }

  async getWalletUser(userId: string): Promise<AdminWalletUserRecord | null> {
    const user = await this.database.user.findFirst({
      where: { id: userId, ...consumerPlatformUserWhere },
      select: {
        id: true,
        username: true,
        displayName: true,
        wallet: {
          select: {
            balance: true,
            lifetimeEarned: true,
            lifetimeSpent: true,
          },
        },
      },
    });
    if (!user) return null;
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      balance: user.wallet?.balance ?? 0,
      lifetimeEarned: user.wallet?.lifetimeEarned ?? 0,
      lifetimeSpent: user.wallet?.lifetimeSpent ?? 0,
    };
  }

  adjustWallet(data: AdminAdjustWalletData): Promise<AdminWalletAdjustResultRecord> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const user = await transaction.user.findFirst({
        where: { id: data.userId, ...consumerPlatformUserWhere },
        select: { id: true, username: true },
      });
      if (!user) throw new AdminStateConflictError();

      const existing = await transaction.wallet.findUnique({
        where: { userId: data.userId },
      });
      if (!existing) {
        await transaction.wallet.create({
          data: {
            userId: data.userId,
            balance: 0,
            lifetimeEarned: 0,
            lifetimeSpent: 0,
          },
        });
      }

      const adjustmentId = randomUUID();
      const idempotencyKey = `admin-adjust:${adjustmentId}`;
      const description =
        data.note?.trim() ||
        (data.direction === "credit" ? "Admin credit" : "Admin debit");

      if (data.direction === "credit") {
        await creditWallet(transaction, {
          userId: data.userId,
          amount: data.points,
          type: WalletTransactionType.ADMIN_ADJUST,
          idempotencyKey,
          referenceType: "admin_adjust",
          referenceId: adjustmentId,
          description,
        });
      } else {
        try {
          await debitWallet(transaction, {
            userId: data.userId,
            amount: data.points,
            type: WalletTransactionType.ADMIN_ADJUST,
            idempotencyKey,
            referenceType: "admin_adjust",
            referenceId: adjustmentId,
            description,
          });
        } catch (error) {
          if (error instanceof InsufficientWalletBalanceError) {
            throw error;
          }
          throw error;
        }
      }

      const updated = await transaction.wallet.findUniqueOrThrow({
        where: { userId: data.userId },
        select: { balance: true, lifetimeEarned: true, lifetimeSpent: true },
      });

      await this.writeAudit(
        transaction,
        actor.id,
        "admin.wallet.adjusted",
        "wallet",
        data.userId,
        {
          direction: data.direction,
          points: data.points,
          note: data.note ?? null,
        },
      );

      return {
        userId: user.id,
        username: user.username,
        balance: updated.balance,
        lifetimeEarned: updated.lifetimeEarned,
        lifetimeSpent: updated.lifetimeSpent,
        direction: data.direction,
        points: data.points,
      };
    });
  }

  async listWalletTransactions(
    query: AdminWalletTransactionQuery,
  ): Promise<AdminPage<AdminWalletTransactionRecord>> {
    const where: Prisma.WalletTransactionWhereInput = {
      ...(query.userId ? { walletUserId: query.userId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.q
        ? {
            OR: [
              ...(isUuid(query.q) ? [{ id: query.q }, { walletUserId: query.q }] : []),
              {
                wallet: {
                  user: {
                    username: { contains: query.q, mode: "insensitive" },
                  },
                },
              },
              {
                wallet: {
                  user: {
                    displayName: { contains: query.q, mode: "insensitive" },
                  },
                },
              },
              { description: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.database.$transaction([
      this.database.walletTransaction.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          walletUserId: true,
          type: true,
          amount: true,
          balanceAfter: true,
          description: true,
          createdAt: true,
          wallet: {
            select: {
              user: { select: { username: true } },
            },
          },
        },
      }),
      this.database.walletTransaction.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        userId: row.walletUserId,
        username: row.wallet.user.username,
        type: row.type,
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        description: row.description,
        createdAt: row.createdAt,
      })),
      total,
    };
  }

  async listPointPurchaseRates(
    query: OffsetPage,
  ): Promise<AdminPage<AdminPointPurchaseRateRecord>> {
    const [rows, total] = await this.database.$transaction([
      this.database.pointPurchaseRate.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.pointPurchaseRate.count(),
    ]);
    return { items: rows.map(mapPointPurchaseRate), total };
  }

  createPointPurchaseRate(
    data: CreatePointPurchaseRateData,
  ): Promise<AdminPointPurchaseRateRecord> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const created = await transaction.pointPurchaseRate.create({
        data: {
          currency: data.currency.toUpperCase(),
          amountMinor: data.amountMinor,
          points: data.points,
          label: data.label ?? null,
          isActive: data.isActive ?? true,
          sortOrder: data.sortOrder ?? 0,
          updatedById: actor.id,
        },
      });
      await this.writeAudit(
        transaction,
        actor.id,
        "admin.point_rate.created",
        "point_purchase_rate",
        created.id,
        { currency: created.currency, amountMinor: created.amountMinor, points: created.points },
      );
      return mapPointPurchaseRate(created);
    });
  }

  updatePointPurchaseRate(
    data: UpdatePointPurchaseRateData,
  ): Promise<AdminPointPurchaseRateRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const actor = await this.requireAdminActor(transaction, data.actorId);
      const existing = await transaction.pointPurchaseRate.findUnique({
        where: { id: data.rateId },
      });
      if (!existing) return null;
      const updated = await transaction.pointPurchaseRate.update({
        where: { id: data.rateId },
        data: {
          ...(data.currency !== undefined
            ? { currency: data.currency.toUpperCase() }
            : {}),
          ...(data.amountMinor !== undefined ? { amountMinor: data.amountMinor } : {}),
          ...(data.points !== undefined ? { points: data.points } : {}),
          ...(data.label !== undefined ? { label: data.label } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
          updatedById: actor.id,
        },
      });
      await this.writeAudit(
        transaction,
        actor.id,
        "admin.point_rate.updated",
        "point_purchase_rate",
        updated.id,
        {},
      );
      return mapPointPurchaseRate(updated);
    });
  }
}

function mapPointPurchaseRate(row: {
  id: string;
  currency: string;
  amountMinor: number;
  points: number;
  label: string | null;
  isActive: boolean;
  sortOrder: number;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AdminPointPurchaseRateRecord {
  return {
    id: row.id,
    currency: row.currency,
    amountMinor: row.amountMinor,
    points: row.points,
    label: row.label,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    updatedById: row.updatedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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

const subscriptionAdminSelect = {
  id: true,
  userId: true,
  planId: true,
  billingCycle: true,
  status: true,
  startsAt: true,
  endsAt: true,
  cancelledAt: true,
  createdAt: true,
  user: {
    select: {
      username: true,
      displayName: true,
      profilePhotoMediaId: true,
    },
  },
  plan: { select: { name: true, code: true, tier: true } },
} satisfies Prisma.UserSubscriptionSelect;

type SubscriptionAdminRow = Prisma.UserSubscriptionGetPayload<{
  select: typeof subscriptionAdminSelect;
}>;

function mapAdminSubscriptionRecord(row: SubscriptionAdminRow): AdminSubscriptionRecord {
  return {
    id: row.id,
    userId: row.userId,
    username: row.user.username,
    displayName: row.user.displayName,
    profilePhotoMediaId: row.user.profilePhotoMediaId,
    planId: row.planId,
    planName: row.plan.name,
    planCode: row.plan.code,
    planTier: row.plan.tier,
    billingCycle: row.billingCycle,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function mapAdminPost(
  post: Prisma.PostGetPayload<{ select: typeof postAdminSelect }>,
): AdminPostRecord {
  const hasPendingReview = post.reports.some(
    (report) => report.status === ReportStatus.UNDER_REVIEW,
  );
  return {
    id: post.id,
    authorId: post.author.id,
    authorUsername: post.author.username,
    authorDisplayName: post.author.displayName,
    authorIsVerifiedBadge: post.author.isVerifiedBadge,
    authorProfilePhotoMediaId: post.author.profilePhotoMediaId,
    bodyPreview: truncatePreview(post.body),
    mediaCount: post._count.media,
    mediaPreview: post.media.map((row) => ({
      id: row.mediaAsset.id,
      mimeType: row.mediaAsset.mimeType,
    })),
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    shareCount: post.shareCount,
    hasOpenReport: post.reports.length > 0,
    hasPendingReview,
    isHidden: post.isHidden,
    deletedAt: post.deletedAt,
    createdAt: post.createdAt,
  };
}

function mapAdminConversation(
  row: Prisma.ConversationGetPayload<{ select: typeof conversationAdminSelect }>,
  openReportCount: number,
): AdminConversationRecord {
  const last = row.messages[0];
  return {
    id: row.id,
    status: row.status,
    matchId: row.matchId,
    messageCount: row._count.messages,
    openReportCount,
    lastMessageAt: last?.createdAt ?? null,
    lastMessagePreview: adminMessagePreview(last),
    lastMessageType: last?.type ?? null,
    members: row.members.map((member) => ({
      id: member.user.id,
      username: member.user.username,
      displayName: member.user.displayName,
      profilePhotoMediaId: member.user.profilePhotoMediaId,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAdminConversationMessage(message: {
  id: string;
  conversationId: string;
  type: string;
  body: string | null;
  deletedForEveryoneAt: Date | null;
  createdAt: Date;
  sender: { id: string; username: string };
  mediaAsset: { id: string; mimeType: string } | null;
  reports: Array<{ id: string }>;
}): AdminConversationMessageRecord {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.sender.id,
    senderUsername: message.sender.username,
    type: message.type,
    bodyPreview: adminMessagePreview({
      body: message.body,
      type: message.type as MessageType,
      deletedForEveryoneAt: message.deletedForEveryoneAt,
    }),
    mediaAssetId: message.mediaAsset?.id ?? null,
    mimeType: message.mediaAsset?.mimeType ?? null,
    hasOpenReport: message.reports.length > 0,
    deletedForEveryoneAt: message.deletedForEveryoneAt,
    createdAt: message.createdAt,
  };
}

function adminMessagePreview(
  message:
    | {
        body: string | null;
        type: MessageType | string;
        deletedForEveryoneAt: Date | null;
      }
    | undefined,
): string | null {
  if (!message) return null;
  if (message.deletedForEveryoneAt) return "[Removed]";
  if (message.type === MessageType.IMAGE || message.type === "IMAGE") {
    return message.body?.trim() ? truncatePreview(message.body) : "[Image]";
  }
  if (message.type === MessageType.SYSTEM || message.type === "SYSTEM") {
    return "[System]";
  }
  return truncatePreview(message.body);
}

function mapAdminStory(
  story: Prisma.StoryGetPayload<{ select: typeof storyAdminSelect }>,
): AdminStoryRecord {
  return {
    id: story.id,
    authorId: story.author.id,
    authorUsername: story.author.username,
    authorDisplayName: story.author.displayName,
    authorIsVerifiedBadge: story.author.isVerifiedBadge,
    authorProfilePhotoMediaId: story.author.profilePhotoMediaId,
    mediaAssetId: story.mediaAsset.id,
    mimeType: story.mediaAsset.mimeType,
    captionPreview: truncatePreview(story.caption),
    viewCount: story._count.views,
    expiresAt: story.expiresAt,
    deletedAt: story.deletedAt,
    createdAt: story.createdAt,
  };
}

function mapAdminComment(
  comment: Prisma.CommentGetPayload<{ select: typeof commentAdminSelect }>,
): AdminCommentRecord {
  return {
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId,
    depth: comment.depth,
    replyCount: comment.replyCount,
    authorId: comment.author.id,
    authorUsername: comment.author.username,
    authorDisplayName: comment.author.displayName,
    authorIsVerifiedBadge: comment.author.isVerifiedBadge,
    authorProfilePhotoMediaId: comment.author.profilePhotoMediaId,
    bodyPreview: truncatePreview(comment.body),
    likeCount: comment.likeCount,
    hasOpenReport: comment.reports.length > 0,
    isHidden: comment.isHidden,
    deletedAt: comment.deletedAt,
    createdAt: comment.createdAt,
  };
}

function premiumPlanSelect() {
  return {
    id: true,
    code: true,
    name: true,
    description: true,
    tier: true,
    sortOrder: true,
    badgeLabel: true,
    priceCents: true,
    currency: true,
    durationDays: true,
    adsFree: true,
    houseAdsFree: true,
    profileViews: true,
    discoverBoost: true,
    grantVerifiedBadge: true,
    dailyInterestLimit: true,
    interstitialAdsFree: true,
    directMessageEnabled: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    prices: {
      orderBy: { billingCycle: "asc" },
      select: {
        id: true,
        billingCycle: true,
        priceCents: true,
        durationDays: true,
        isActive: true,
      },
    },
    _count: {
      select: {
        subscriptions: { where: { status: SubscriptionStatus.ACTIVE } },
      },
    },
  } as const;
}

function mapPremiumPlan(
  plan: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    tier: string;
    sortOrder: number;
    badgeLabel: string;
    priceCents: number;
    currency: string;
    durationDays: number;
    adsFree: boolean;
    houseAdsFree: boolean;
    profileViews: boolean;
    discoverBoost: number;
    grantVerifiedBadge: boolean;
    dailyInterestLimit: number;
    interstitialAdsFree: boolean;
    directMessageEnabled: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    prices: AdminPlanPriceRecord[];
    _count: { subscriptions: number };
  },
): AdminPremiumPlanRecord {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    tier: plan.tier,
    sortOrder: plan.sortOrder,
    badgeLabel: plan.badgeLabel,
    priceCents: plan.priceCents,
    currency: plan.currency,
    durationDays: plan.durationDays,
    adsFree: plan.adsFree,
    houseAdsFree: plan.houseAdsFree,
    profileViews: plan.profileViews,
    discoverBoost: plan.discoverBoost,
    grantVerifiedBadge: plan.grantVerifiedBadge,
    dailyInterestLimit: plan.dailyInterestLimit,
    interstitialAdsFree: plan.interstitialAdsFree,
    directMessageEnabled: plan.directMessageEnabled,
    isActive: plan.isActive,
    prices: plan.prices.map((price) => ({
      id: price.id,
      billingCycle: price.billingCycle,
      priceCents: price.priceCents,
      durationDays: price.durationDays,
      isActive: price.isActive,
    })),
    subscriberCount: plan._count.subscriptions,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function defaultPlanPricesFromMonthly(
  monthlyCents: number,
  monthlyDays: number,
): PremiumPlanPriceInput[] {
  return [
    {
      billingCycle: "MONTHLY",
      priceCents: monthlyCents,
      durationDays: monthlyDays,
    },
    {
      billingCycle: "YEARLY",
      priceCents: monthlyCents * 10,
      durationDays: 365,
    },
    {
      billingCycle: "ONE_TIME",
      priceCents: monthlyCents * 20,
      durationDays: 3650,
    },
  ];
}

async function upsertPlanPrices(
  transaction: Prisma.TransactionClient,
  planId: string,
  prices: PremiumPlanPriceInput[],
): Promise<void> {
  for (const price of prices) {
    await transaction.premiumPlanPrice.upsert({
      where: {
        planId_billingCycle: {
          planId,
          billingCycle: price.billingCycle as PremiumBillingCycle,
        },
      },
      create: {
        planId,
        billingCycle: price.billingCycle as PremiumBillingCycle,
        priceCents: price.priceCents,
        durationDays: price.durationDays,
        isActive: price.isActive ?? true,
      },
      update: {
        priceCents: price.priceCents,
        durationDays: price.durationDays,
        ...(price.isActive !== undefined ? { isActive: price.isActive } : {}),
      },
    });
  }
  const monthly = prices.find((price) => price.billingCycle === "MONTHLY");
  if (monthly) {
    await transaction.premiumPlan.update({
      where: { id: planId },
      data: {
        priceCents: monthly.priceCents,
        durationDays: monthly.durationDays,
      },
    });
  }
}

function mapAd(ad: {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  targetUrl: string | null;
  ctaLabel: string | null;
  placement: string;
  priority: number;
  insertEvery: number | null;
  isActive: boolean;
  impressionCount: number;
  clickCount: number;
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
    ctaLabel: ad.ctaLabel,
    placement: ad.placement,
    priority: ad.priority,
    insertEvery: ad.insertEvery,
    isActive: ad.isActive,
    impressionCount: ad.impressionCount,
    clickCount: ad.clickCount,
    startsAt: ad.startsAt,
    endsAt: ad.endsAt,
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt,
  };
}

function mapAdPlacementConfig(row: {
  placement: string;
  label: string;
  description: string | null;
  isEnabled: boolean;
  insertEvery: number;
  updatedAt: Date;
}): AdminAdPlacementConfigRecord {
  return {
    placement: row.placement,
    label: row.label,
    description: row.description,
    isEnabled: row.isEnabled,
    insertEvery: row.insertEvery,
    updatedAt: row.updatedAt,
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

function mapBlogPost(post: {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMarkdown: string;
  coverImageUrl: string | null;
  metaDescription: string | null;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AdminBlogPostRecord {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    bodyMarkdown: post.bodyMarkdown,
    coverImageUrl: post.coverImageUrl,
    metaDescription: post.metaDescription,
    status: post.status,
    publishedAt: post.publishedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
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

function buildDemographicBuckets(
  rows: Array<{ key: string; count: number }>,
  total: number,
  labelFn: (key: string) => string,
  sortFn?: (a: { key: string; count: number }, b: { key: string; count: number }) => number,
): Array<{ key: string; label: string; count: number; percentage: number }> {
  const sorted = sortFn
    ? [...rows].sort(sortFn)
    : [...rows].sort((a, b) => b.count - a.count);
  return sorted.map((row) => ({
    key: row.key,
    label: labelFn(row.key),
    count: row.count,
    percentage: total ? Math.round((row.count / total) * 1000) / 10 : 0,
  }));
}

function formatGenderLabel(key: string): string {
  const labels: Record<string, string> = {
    MALE: "Male",
    FEMALE: "Female",
    NON_BINARY: "Non-binary",
    OTHER: "Other",
    PREFER_NOT_TO_SAY: "Prefer not to say",
  };
  return labels[key] ?? key;
}

function formatAgeRangeLabel(key: string): string {
  const labels: Record<string, string> = {
    AGE_18_24: "18–24",
    AGE_25_28: "25–28",
    AGE_29_34: "29–34",
    AGE_35_39: "35–39",
    AGE_40_44: "40–44",
    AGE_45_49: "45–49",
    AGE_50_54: "50–54",
    AGE_55_59: "55–59",
    AGE_60_64: "60–64",
    AGE_65_70: "65–70",
  };
  return labels[key] ?? key;
}

function ageRangeSortKey(
  a: { key: string; count: number },
  b: { key: string; count: number },
): number {
  return a.key.localeCompare(b.key);
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
