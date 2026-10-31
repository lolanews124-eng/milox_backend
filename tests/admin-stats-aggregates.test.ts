import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAdminRepository } from "../src/modules/admin/infrastructure/prisma-admin-repository.js";
import { startOfIstDay } from "../src/shared/ist-time.js";

describe("PrismaAdminRepository consolidated admin aggregates", () => {
  it("dashboard uses one SQL round-trip and preserves KPI fields", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        totalUsers: 100,
        dailyActiveUsers: 12,
        newUsersToday: 3,
        deletedUsers: 4,
        totalPosts: 50,
        openReports: 2,
        premiumUsers: 7n,
        revenueCents: 9900n,
      },
    ]);
    const database = {
      $queryRaw: queryRaw,
      user: { count: vi.fn() },
      post: { count: vi.fn() },
      report: { count: vi.fn() },
    } as unknown as PrismaClient;

    const result = await new PrismaAdminRepository(database).dashboard(
      new Date("2026-10-31T12:00:00.000Z"),
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(database.user.count).not.toHaveBeenCalled();
    expect(database.post.count).not.toHaveBeenCalled();
    expect(database.report.count).not.toHaveBeenCalled();
    expect(result).toEqual({
      totalUsers: 100,
      dailyActiveUsers: 12,
      newUsersToday: 3,
      deletedUsers: 4,
      totalPosts: 50,
      totalComments: 0,
      totalMessages: 0,
      openReports: 2,
      premiumUsers: 7,
      revenueCents: 9900,
    });
  });

  it("usersStats uses one SQL round-trip and preserves all KPI fields", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        totalUsers: 200,
        verifiedUsers: 20,
        onlineNow: 5,
        activeToday: 40,
        quiet14d: 80,
        newUsersToday: 6,
        maleUsers: 110,
        femaleUsers: 90,
        suspendedUsers: 8,
        deletedUsers: 11,
        reportedUsers: 3,
      },
    ]);
    const database = {
      $queryRaw: queryRaw,
      user: { count: vi.fn(), groupBy: vi.fn() },
      report: { count: vi.fn() },
    } as unknown as PrismaClient;

    const result = await new PrismaAdminRepository(database).usersStats(
      new Date("2026-10-31T12:00:00.000Z"),
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(database.user.count).not.toHaveBeenCalled();
    expect(database.user.groupBy).not.toHaveBeenCalled();
    expect(database.report.count).not.toHaveBeenCalled();
    expect(result).toEqual({
      totalUsers: 200,
      verifiedUsers: 20,
      onlineNow: 5,
      activeToday: 40,
      quiet14d: 80,
      newUsersToday: 6,
      maleUsers: 110,
      femaleUsers: 90,
      suspendedUsers: 8,
      reportedUsers: 3,
      deletedUsers: 11,
    });
  });

  it("referralsStats aggregates in SQL (2 queries) and builds a 14-day trend", async () => {
    const dayStart = startOfIstDay(new Date("2026-10-31T12:00:00.000Z"));
    const dayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dayStart);

    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        {
          totalReferrals: 100,
          referralsToday: 4,
          referralsLast7Days: 20,
          referralsLast30Days: 60,
          activeReferrers: 15,
          totalRewardPointsPaid: 5000,
          rewardPerReferral: 100,
          referralCodesIssued: 40,
          referredSignups: 50,
          totalConsumerUsers: 200,
        },
      ])
      .mockResolvedValueOnce([{ day: dayKey, count: 4 }]);

    const database = {
      $queryRaw: queryRaw,
      referral: {
        count: vi.fn(),
        findMany: vi.fn(),
        groupBy: vi.fn(),
        aggregate: vi.fn(),
        findFirst: vi.fn(),
      },
      referralCode: { count: vi.fn() },
      user: { count: vi.fn() },
    } as unknown as PrismaClient;

    const result = await new PrismaAdminRepository(database).referralsStats(
      new Date("2026-10-31T12:00:00.000Z"),
    );

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(database.referral.findMany).not.toHaveBeenCalled();
    expect(database.referral.groupBy).not.toHaveBeenCalled();
    expect(result.totalReferrals).toBe(100);
    expect(result.activeReferrers).toBe(15);
    expect(result.referredSignupShare).toBe(25);
    expect(result.sharingActive).toBe(true);
    expect(result.referralsTrend).toHaveLength(14);
    expect(result.referralsTrend.find((row) => row.date === dayKey)?.count).toBe(
      4,
    );
  });

  it("listReferralLeaderboard paginates in SQL instead of loading all groups", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ total: 42 }])
      .mockResolvedValueOnce([
        {
          userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          username: "top",
          displayName: "Top",
          profilePhotoMediaId: null,
          referralCode: "TOP1",
          referralCount: 9,
          totalEarned: 900,
          lastReferralAt: new Date("2026-10-30T00:00:00.000Z"),
        },
      ]);

    const database = {
      $queryRaw: queryRaw,
      referral: { groupBy: vi.fn() },
      user: { findMany: vi.fn() },
      referralCode: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const result = await new PrismaAdminRepository(
      database,
    ).listReferralLeaderboard({ page: 1, pageSize: 10 });

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(database.referral.groupBy).not.toHaveBeenCalled();
    expect(database.user.findMany).not.toHaveBeenCalled();
    expect(result.total).toBe(42);
    expect(result.items).toEqual([
      {
        userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        username: "top",
        displayName: "Top",
        profilePhotoMediaId: null,
        referralCode: "TOP1",
        referralCount: 9,
        totalEarned: 900,
        lastReferralAt: new Date("2026-10-30T00:00:00.000Z"),
      },
    ]);
  });
});
