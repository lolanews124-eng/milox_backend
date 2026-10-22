import { describe, expect, it, vi } from "vitest";

import {
  assertBotDailyLimitAllows,
  BOT_DAILY_LIMIT_TIMEZONE,
  dailyCapFor,
  getBotDailyUsage,
  readBotPermissions,
  startOfUtcDay,
} from "../src/modules/bots/application/bot-daily-limits.js";
import { BotActivityExecutor } from "../src/modules/bots/application/bot-activity-executor.js";

describe("bot daily limits", () => {
  it("documents UTC day boundary", () => {
    expect(BOT_DAILY_LIMIT_TIMEZONE).toBe("UTC");
    const noon = new Date("2026-10-16T12:30:00.000Z");
    expect(startOfUtcDay(noon).toISOString()).toBe("2026-10-16T00:00:00.000Z");
    const justBefore = new Date("2026-10-16T23:59:59.999Z");
    expect(startOfUtcDay(justBefore).toISOString()).toBe(
      "2026-10-16T00:00:00.000Z",
    );
    const nextDay = new Date("2026-10-17T00:00:00.000Z");
    expect(startOfUtcDay(nextDay).toISOString()).toBe(
      "2026-10-17T00:00:00.000Z",
    );
  });

  it("uses defaults when permissions are missing", () => {
    const perms = readBotPermissions(undefined);
    expect(perms.maxLikesPerDay).toBe(20);
    expect(perms.maxCommentsPerDay).toBe(5);
    expect(perms.maxFollowsPerDay).toBe(10);
    expect(dailyCapFor(perms, "LIKE_POST")).toBe(20);
  });

  it("blocks enqueue when successful + in-flight reach the daily cap", async () => {
    const database = {
      postLike: { count: vi.fn().mockResolvedValue(19) },
      comment: { count: vi.fn() },
      follow: { count: vi.fn() },
      botActivityJob: { count: vi.fn().mockResolvedValue(1) },
    };
    const usage = await getBotDailyUsage(database as never, {
      botAccountId: "bot-1",
      botUserId: "user-1",
      activityType: "LIKE_POST",
      permissions: readBotPermissions({ maxLikesPerDay: 20 }),
      now: new Date("2026-10-16T15:00:00.000Z"),
    });
    expect(usage.successful).toBe(19);
    expect(usage.inFlight).toBe(1);
    expect(usage.remaining).toBe(0);

    const allow = await assertBotDailyLimitAllows(database as never, {
      botAccountId: "bot-1",
      botUserId: "user-1",
      activityType: "LIKE_POST",
      permissions: { maxLikesPerDay: 20 },
      now: new Date("2026-10-16T15:00:00.000Z"),
    });
    expect(allow).toEqual({
      ok: false,
      reason: "daily_limit_like_post",
    });
  });

  it("resets remaining at the next UTC day", async () => {
    const database = {
      postLike: {
        count: vi.fn().mockImplementation(async ({ where }) => {
          // No likes yet on Oct 17
          expect(where.createdAt.gte.toISOString()).toBe(
            "2026-10-17T00:00:00.000Z",
          );
          return 0;
        }),
      },
      comment: { count: vi.fn() },
      follow: { count: vi.fn() },
      botActivityJob: { count: vi.fn().mockResolvedValue(0) },
    };
    const allow = await assertBotDailyLimitAllows(database as never, {
      botAccountId: "bot-1",
      botUserId: "user-1",
      activityType: "LIKE_POST",
      permissions: { maxLikesPerDay: 1 },
      now: new Date("2026-10-17T00:05:00.000Z"),
    });
    expect(allow).toEqual({ ok: true });
  });

  it("excludes the claimed job from in-flight when checking before execute", async () => {
    const database = {
      postLike: { count: vi.fn().mockResolvedValue(19) },
      comment: { count: vi.fn() },
      follow: { count: vi.fn() },
      botActivityJob: {
        count: vi.fn().mockImplementation(async ({ where }) => {
          expect(where.id).toEqual({ not: "job-claimed" });
          return 0;
        }),
      },
    };
    const allow = await assertBotDailyLimitAllows(database as never, {
      botAccountId: "bot-1",
      botUserId: "user-1",
      activityType: "LIKE_POST",
      permissions: { maxLikesPerDay: 20 },
      excludeJobId: "job-claimed",
      now: new Date("2026-10-16T15:00:00.000Z"),
    });
    expect(allow).toEqual({ ok: true });
  });

  it("executor skips when daily limit is already reached", async () => {
    const database = {
      botAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bot-1",
          status: "ACTIVE",
          permissions: { maxLikesPerDay: 1 },
          user: {
            id: "user-1",
            status: "ACTIVE",
            deletedAt: null,
            isAutomatedAccount: true,
          },
        }),
      },
      postLike: { count: vi.fn().mockResolvedValue(1) },
      comment: { count: vi.fn() },
      follow: { count: vi.fn() },
      botActivityJob: { count: vi.fn().mockResolvedValue(0) },
      post: { findFirst: vi.fn() },
    };
    const posts = { like: vi.fn() };
    const executor = new BotActivityExecutor({
      database: database as never,
      posts: posts as never,
      comments: {} as never,
      follows: {} as never,
    });

    const result = await executor.execute({
      id: "job-1",
      botAccountId: "bot-1",
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: "post-1",
      metadata: {},
    });

    expect(result).toEqual({
      outcome: "skipped",
      reason: "daily_limit_like_post",
    });
    expect(posts.like).not.toHaveBeenCalled();
  });

  it("respects disabled activity flags in missing/partial settings", async () => {
    const database = {
      postLike: { count: vi.fn().mockResolvedValue(0) },
      comment: { count: vi.fn() },
      follow: { count: vi.fn() },
      botActivityJob: { count: vi.fn().mockResolvedValue(0) },
    };
    const allow = await assertBotDailyLimitAllows(database as never, {
      botAccountId: "bot-1",
      botUserId: "user-1",
      activityType: "LIKE_POST",
      permissions: { likesEnabled: false },
    });
    expect(allow).toEqual({ ok: false, reason: "likes_disabled" });
  });
});
