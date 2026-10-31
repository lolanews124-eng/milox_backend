/**
 * SQL parity integration tests for consolidated admin aggregates.
 *
 * Opt-in only:
 *   $env:ADMIN_STATS_PG="1"
 *   $env:ADMIN_STATS_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/milox_admin_stats_e2e?schema=public"
 *
 * Requires a dedicated local database named exactly `milox_admin_stats_e2e`
 * with the current Prisma schema applied. Never uses milox_live_copy / production.
 *
 * Setup example (local only):
 *   createdb milox_admin_stats_e2e
 *   $env:DATABASE_URL="postgresql://…@127.0.0.1:5432/milox_admin_stats_e2e?schema=public"
 *   npx prisma migrate deploy
 *   Then run with ADMIN_STATS_PG=1 and ADMIN_STATS_DATABASE_URL pointing at that DB.
 */
import { randomUUID } from "node:crypto";

import { PrismaClient, ReportStatus, UserStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaAdminRepository } from "../../src/modules/admin/infrastructure/prisma-admin-repository.js";
import { startOfIstDay } from "../../src/shared/ist-time.js";
import {
  referenceDashboard,
  referenceReferralLeaderboard,
  referenceReferralsStats,
  referenceUsersStats,
} from "./reference-aggregates.js";
import {
  assertAdminStatsPgEnabled,
  assertSafeAdminStatsDatabaseUrl,
} from "./safety.js";

const optedIn = process.env.ADMIN_STATS_PG === "1";
const describePg = optedIn ? describe : describe.skip;

const RUN = `astats_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

describe("admin stats PG safety gate", () => {
  it("refuses milox_live_copy", () => {
    expect(() =>
      assertSafeAdminStatsDatabaseUrl(
        "postgresql://postgres:x@127.0.0.1:5432/milox_live_copy?schema=public",
      ),
    ).toThrow(/milox_admin_stats_e2e/);
  });

  it("accepts milox_admin_stats_e2e on loopback", () => {
    const safe = assertSafeAdminStatsDatabaseUrl(
      "postgresql://postgres:x@127.0.0.1:5432/milox_admin_stats_e2e?schema=public",
    );
    expect(safe.database).toBe("milox_admin_stats_e2e");
  });

  it("documents opt-in when disabled", () => {
    if (optedIn) return;
    expect(process.env.ADMIN_STATS_PG).not.toBe("1");
  });
});

describePg("admin consolidated SQL parity (PostgreSQL)", () => {
  let database: PrismaClient;
  let repo: PrismaAdminRepository;
  const userIds: string[] = [];
  const reportIds: string[] = [];
  const referralIds: string[] = [];

  beforeAll(async () => {
    assertAdminStatsPgEnabled();
    const safe = assertSafeAdminStatsDatabaseUrl(
      process.env.ADMIN_STATS_DATABASE_URL,
    );
    database = new PrismaClient({
      datasources: { db: { url: safe.url } },
    });
    repo = new PrismaAdminRepository(database);
    await database.$connect();
  });

  afterAll(async () => {
    if (!database) return;
    if (referralIds.length > 0) {
      await database.referral.deleteMany({ where: { id: { in: referralIds } } });
    }
    if (reportIds.length > 0) {
      await database.report.deleteMany({ where: { id: { in: reportIds } } });
    }
    // Referral codes use userId PK.
    if (userIds.length > 0) {
      await database.referralCode.deleteMany({
        where: { userId: { in: userIds } },
      });
      await database.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await database.$disconnect();
  });

  async function createUser(input: {
    username: string;
    role?: "USER" | "ADMIN";
    status?: UserStatus;
    isSystemAccount?: boolean;
    gender?: "MALE" | "FEMALE" | "OTHER";
    isVerifiedBadge?: boolean;
    lastSeenAt?: Date | null;
    lastLoginAt?: Date | null;
    createdAt?: Date;
    deletedAt?: Date | null;
    referredByUserId?: string | null;
  }) {
    const id = randomUUID();
    userIds.push(id);
    const username = `${RUN}_${input.username}`.slice(0, 32);
    await database.user.create({
      data: {
        id,
        username,
        usernameNormalized: username.toLowerCase(),
        email: `${username}@astats.milox.local`,
        passwordHash: "itest-not-a-real-hash",
        ageRange: "AGE_25_28",
        gender: input.gender ?? "OTHER",
        country: "India",
        role: input.role ?? "USER",
        status: input.status ?? UserStatus.ACTIVE,
        isSystemAccount: input.isSystemAccount ?? false,
        isVerifiedBadge: input.isVerifiedBadge ?? false,
        lastSeenAt: input.lastSeenAt === undefined ? null : input.lastSeenAt,
        lastLoginAt: input.lastLoginAt === undefined ? null : input.lastLoginAt,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        deletedAt: input.deletedAt ?? null,
        referredByUserId: input.referredByUserId ?? null,
      },
    });
    return id;
  }

  it("matches empty/zero baselines before fixtures (dashboard + usersStats)", async () => {
    // May be non-zero if DB already has data; still require exact parity.
    const now = new Date();
    const [dashSql, dashRef, statsSql, statsRef] = await Promise.all([
      repo.dashboard(now),
      referenceDashboard(database, now),
      repo.usersStats(now),
      referenceUsersStats(database, now),
    ]);
    expect(dashSql).toEqual(dashRef);
    expect(statsSql).toEqual(statsRef);
  });

  it("matches fixture covering null presence, statuses, system users, IST boundary, reports, referrals", async () => {
    const now = new Date("2026-10-31T12:00:00.000Z");
    const dayStart = startOfIstDay(now);
    const justBeforeDay = new Date(dayStart.getTime() - 1);
    const justAfterDay = new Date(dayStart.getTime() + 60_000);

    const activeNullPresence = await createUser({
      username: "null_presence",
      gender: "MALE",
      lastSeenAt: null,
      lastLoginAt: null,
      createdAt: justAfterDay,
    });
    await createUser({
      username: "dau",
      gender: "FEMALE",
      lastSeenAt: justAfterDay,
      lastLoginAt: null,
      isVerifiedBadge: true,
      createdAt: justBeforeDay,
    });
    await createUser({
      username: "suspended_staff",
      role: "ADMIN",
      status: UserStatus.SUSPENDED,
      gender: "MALE",
    });
    await createUser({
      username: "system",
      isSystemAccount: true,
      gender: "MALE",
      lastSeenAt: justAfterDay,
    });
    await createUser({
      username: "deleted",
      deletedAt: now,
      status: UserStatus.PENDING_DELETION,
      gender: "FEMALE",
    });
    await createUser({
      username: "quiet",
      gender: "MALE",
      lastSeenAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      lastLoginAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      createdAt: justBeforeDay,
    });

    const referrerA = await createUser({ username: "ref_a", gender: "MALE" });
    const referrerB = await createUser({ username: "ref_b", gender: "FEMALE" });
    const referred1 = await createUser({
      username: "refd1",
      referredByUserId: referrerA,
    });
    const referred2 = await createUser({
      username: "refd2",
      referredByUserId: referrerA,
    });
    const referred3 = await createUser({
      username: "refd3",
      referredByUserId: referrerB,
    });
    const referred4 = await createUser({
      username: "refd4",
      referredByUserId: referrerB,
    });

    await database.referralCode.create({
      data: { userId: referrerA, code: `${RUN}A`.slice(0, 16) },
    });
    await database.referralCode.create({
      data: { userId: referrerB, code: `${RUN}B`.slice(0, 16) },
    });

    // rewardPoints is NOT NULL in schema — cover 0 and non-zero.
    for (const [referrerUserId, referredUserId, rewardPoints] of [
      [referrerA, referred1, 100],
      [referrerA, referred2, 0],
      [referrerB, referred3, 100],
      [referrerB, referred4, 50],
    ] as const) {
      const id = randomUUID();
      referralIds.push(id);
      await database.referral.create({
        data: {
          id,
          referrerUserId,
          referredUserId,
          rewardPoints,
          createdAt: justAfterDay,
        },
      });
    }

    const openReportId = randomUUID();
    const underReviewId = randomUUID();
    reportIds.push(openReportId, underReviewId);
    await database.report.create({
      data: {
        id: openReportId,
        reporterId: activeNullPresence,
        reportedUserId: referrerA,
        targetType: "USER",
        reasonCode: "SPAM",
        status: ReportStatus.OPEN,
      },
    });
    await database.report.create({
      data: {
        id: underReviewId,
        reporterId: activeNullPresence,
        reportedUserId: referrerB,
        targetType: "USER",
        reasonCode: "HARASSMENT",
        status: ReportStatus.UNDER_REVIEW,
      },
    });

    const [dashSql, dashRef, statsSql, statsRef, refSql, refRef] =
      await Promise.all([
        repo.dashboard(now),
        referenceDashboard(database, now),
        repo.usersStats(now),
        referenceUsersStats(database, now),
        repo.referralsStats(now),
        referenceReferralsStats(database, now),
      ]);

    expect(dashSql).toEqual(dashRef);
    expect(statsSql).toEqual(statsRef);
    expect(statsSql.suspendedUsers).toBeGreaterThanOrEqual(1);
    expect(statsSql.reportedUsers).toBeGreaterThanOrEqual(2);
    expect({
      totalReferrals: refSql.totalReferrals,
      referralsToday: refSql.referralsToday,
      referralsLast7Days: refSql.referralsLast7Days,
      referralsLast30Days: refSql.referralsLast30Days,
      activeReferrers: refSql.activeReferrers,
      referralCodesIssued: refSql.referralCodesIssued,
      referredSignupShare: refSql.referredSignupShare,
      totalRewardPointsPaid: refSql.totalRewardPointsPaid,
      rewardPerReferral: refSql.rewardPerReferral,
      sharingActive: refSql.sharingActive,
    }).toEqual(refRef);
    expect(refSql.referralsTrend).toHaveLength(14);

    const [boardSql, boardRef] = await Promise.all([
      repo.listReferralLeaderboard({ page: 1, pageSize: 50 }),
      referenceReferralLeaderboard(database, 1, 50),
    ]);
    expect(boardSql.total).toBe(boardRef.total);
    expect(
      boardSql.items.map((row) => ({
        userId: row.userId,
        referralCount: row.referralCount,
        totalEarned: row.totalEarned,
      })),
    ).toEqual(
      boardRef.items.map((row) => ({
        userId: row.userId,
        referralCount: row.referralCount,
        totalEarned: row.totalEarned,
      })),
    );

    // Equal counts (both fixture referrers have 2): stable userId ASC tie-break.
    const tied = boardSql.items.filter(
      (row) => row.userId === referrerA || row.userId === referrerB,
    );
    expect(tied).toHaveLength(2);
    expect(tied[0]?.referralCount).toBe(2);
    expect(tied[1]?.referralCount).toBe(2);
    expect(tied[0]!.userId < tied[1]!.userId).toBe(true);

    const deepPage = await repo.listReferralLeaderboard({
      page: 99,
      pageSize: 10,
    });
    expect(deepPage.items).toEqual([]);
    expect(deepPage.total).toBe(boardSql.total);
  });
});
