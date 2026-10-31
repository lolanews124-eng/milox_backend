/**
 * Reference aggregates reproducing the pre-consolidation Prisma filter semantics.
 * Used only by SQL parity integration tests — not production code.
 */
import {
  ReportStatus,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";

import { startOfIstDay } from "../../src/shared/ist-time.js";
import {
  consumerPlatformUserWhere,
  recentPresenceWhere,
  stalePresenceWhere,
} from "../../src/shared/user-visibility.js";

export async function referenceDashboard(database: PrismaClient, now: Date) {
  const dayStart = startOfIstDay(now);
  const [
    totalUsers,
    dailyActiveUsers,
    newUsersToday,
    deletedUsers,
    totalPosts,
    openReports,
    commerceRows,
  ] = await Promise.all([
    database.user.count({
      where: {
        status: { not: UserStatus.DELETED },
        deletedAt: null,
        ...consumerPlatformUserWhere(),
      },
    }),
    database.user.count({
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
    database.user.count({
      where: {
        createdAt: { gte: dayStart },
        deletedAt: null,
        ...consumerPlatformUserWhere(),
      },
    }),
    database.user.count({
      where: {
        deletedAt: { not: null },
        ...consumerPlatformUserWhere(),
      },
    }),
    database.post.count({ where: { deletedAt: null } }),
    database.report.count({
      where: {
        status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
      },
    }),
    database.$queryRaw<
      Array<{ premiumUsers: bigint; revenueCents: bigint }>
    >`
      SELECT
        COUNT(DISTINCT s."userId") FILTER (
          WHERE s.status = 'ACTIVE'
            AND s."startsAt" <= ${now}
            AND s."endsAt" > ${now}
        )::bigint AS "premiumUsers",
        COALESCE(SUM(p."priceCents") FILTER (
          WHERE s.status = 'ACTIVE'
            AND s."startsAt" <= ${now}
            AND s."endsAt" > ${now}
        ), 0)::bigint AS "revenueCents"
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
    totalComments: 0,
    totalMessages: 0,
    openReports,
    premiumUsers: Number(commerceRows[0]?.premiumUsers ?? 0),
    revenueCents: Number(commerceRows[0]?.revenueCents ?? 0),
  };
}

export async function referenceUsersStats(database: PrismaClient, now: Date) {
  const dayStart = startOfIstDay(now);
  const onlineSince = new Date(now.getTime() - 15 * 60 * 1000);
  const quietSince = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const activeWhere = {
    deletedAt: null,
    status: { not: UserStatus.DELETED },
    ...consumerPlatformUserWhere(),
  } as const;

  const [
    totalUsers,
    verifiedUsers,
    onlineNow,
    activeToday,
    quiet14d,
    newUsersToday,
    suspendedUsers,
    reportedUsers,
    deletedUsers,
    genderGroups,
  ] = await Promise.all([
    database.user.count({ where: activeWhere }),
    database.user.count({
      where: { ...activeWhere, isVerifiedBadge: true },
    }),
    database.user.count({
      where: { ...activeWhere, lastSeenAt: { gte: onlineSince } },
    }),
    database.user.count({
      where: { ...activeWhere, ...recentPresenceWhere(dayStart) },
    }),
    database.user.count({
      where: {
        ...activeWhere,
        status: UserStatus.ACTIVE,
        ...stalePresenceWhere(quietSince),
      },
    }),
    database.user.count({
      where: { ...activeWhere, createdAt: { gte: dayStart } },
    }),
    database.user.count({ where: { status: UserStatus.SUSPENDED } }),
    database.report.count({
      where: {
        status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
        reportedUserId: { not: null },
      },
    }),
    database.user.count({
      where: {
        deletedAt: { not: null },
        ...consumerPlatformUserWhere(),
      },
    }),
    database.user.groupBy({
      by: ["gender"],
      where: activeWhere,
      _count: { _all: true },
    }),
  ]);

  return {
    totalUsers,
    verifiedUsers,
    onlineNow,
    activeToday,
    quiet14d,
    newUsersToday,
    maleUsers:
      genderGroups.find((row) => row.gender === "MALE")?._count._all ?? 0,
    femaleUsers:
      genderGroups.find((row) => row.gender === "FEMALE")?._count._all ?? 0,
    suspendedUsers,
    reportedUsers,
    deletedUsers,
  };
}

export async function referenceReferralsStats(
  database: PrismaClient,
  now: Date,
) {
  const dayStart = startOfIstDay(now);
  const weekStart = new Date(dayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(dayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
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
    referrerGroups,
  ] = await Promise.all([
    database.referral.count(),
    database.referral.count({ where: { createdAt: { gte: dayStart } } }),
    database.referral.count({ where: { createdAt: { gte: weekStart } } }),
    database.referral.count({ where: { createdAt: { gte: monthStart } } }),
    database.referralCode.count(),
    database.user.count({
      where: { ...consumerWhere, referredByUserId: { not: null } },
    }),
    database.user.count({ where: consumerWhere }),
    database.referral.aggregate({ _sum: { rewardPoints: true } }),
    database.referral.findFirst({
      select: { rewardPoints: true },
      orderBy: { createdAt: "desc" },
    }),
    database.referral.groupBy({
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
  };
}

export async function referenceReferralLeaderboard(
  database: PrismaClient,
  page: number,
  pageSize: number,
) {
  const grouped = await database.referral.groupBy({
    by: ["referrerUserId"],
    _count: { _all: true },
    _sum: { rewardPoints: true },
    _max: { createdAt: true },
  });

  // Match consolidated SQL: count DESC, userId ASC for stable ties.
  const sorted = [...grouped].sort((a, b) => {
    const countDiff = b._count._all - a._count._all;
    if (countDiff !== 0) return countDiff;
    return a.referrerUserId.localeCompare(b.referrerUserId);
  });

  const total = sorted.length;
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
  return {
    total,
    items: pageRows.map((row) => ({
      userId: row.referrerUserId,
      referralCount: row._count._all,
      totalEarned: row._sum.rewardPoints ?? 0,
      lastReferralAt: row._max.createdAt,
    })),
  };
}
