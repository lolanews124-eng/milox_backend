import { describe, expect, it, vi } from "vitest";

import { BotActivityExecutor } from "../src/modules/bots/application/bot-activity-executor.js";
import { BOTS_TEST_FIXTURE_MARKER } from "../src/modules/bots/application/bot-target-policy.js";
import { botJobBackoffMs } from "../src/shared/claim-bot-activity-job.js";
import { AppError } from "../src/shared/errors/app-error.js";

function limitMocks() {
  return {
    postLike: { count: vi.fn().mockResolvedValue(0) },
    comment: { count: vi.fn().mockResolvedValue(0) },
    follow: { count: vi.fn().mockResolvedValue(0) },
    botActivityJob: { count: vi.fn().mockResolvedValue(0) },
  };
}

describe("bot activity executor", () => {
  it("skips likes when bot is paused", async () => {
    const database = {
      botAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bot-1",
          status: "PAUSED",
          permissions: {},
          user: {
            id: "user-1",
            status: "ACTIVE",
            deletedAt: null,
            isAutomatedAccount: true,
          },
        }),
      },
      post: { findFirst: vi.fn() },
      ...limitMocks(),
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
      reason: "bot_status_paused",
    });
    expect(posts.like).not.toHaveBeenCalled();
  });

  it("likes via PostService when eligible", async () => {
    const database = {
      botAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bot-1",
          status: "ACTIVE",
          permissions: {},
          user: {
            id: "user-1",
            status: "ACTIVE",
            deletedAt: null,
            isAutomatedAccount: true,
          },
        }),
      },
      post: {
        findFirst: vi.fn().mockResolvedValue({
          id: "post-1",
          body: `eligible ${BOTS_TEST_FIXTURE_MARKER}`,
        }),
      },
      ...limitMocks(),
    };
    const posts = { like: vi.fn().mockResolvedValue({}) };
    const executor = new BotActivityExecutor({
      database: database as never,
      posts: posts as never,
      comments: {} as never,
      follows: {} as never,
      targetPolicy: "test_fixtures_only",
    });

    const result = await executor.execute({
      id: "job-1",
      botAccountId: "bot-1",
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: "post-1",
      metadata: {},
    });

    expect(result).toEqual({ outcome: "processed", detail: "liked" });
    expect(posts.like).toHaveBeenCalledWith("post-1", "user-1");
  });

  it("maps ALREADY_LIKED to skipped", async () => {
    const database = {
      botAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bot-1",
          status: "ACTIVE",
          permissions: {},
          user: {
            id: "user-1",
            status: "ACTIVE",
            deletedAt: null,
            isAutomatedAccount: true,
          },
        }),
      },
      post: {
        findFirst: vi.fn().mockResolvedValue({
          id: "post-1",
          body: `eligible ${BOTS_TEST_FIXTURE_MARKER}`,
        }),
      },
      ...limitMocks(),
    };
    const posts = {
      like: vi
        .fn()
        .mockRejectedValue(new AppError("ALREADY_LIKED", "already", 409)),
    };
    const executor = new BotActivityExecutor({
      database: database as never,
      posts: posts as never,
      comments: {} as never,
      follows: {} as never,
      targetPolicy: "test_fixtures_only",
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
      reason: "already_liked",
    });
  });

  it("skips private follow targets", async () => {
    const database = {
      botAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bot-1",
          status: "ACTIVE",
          permissions: {},
          user: {
            id: "user-1",
            status: "ACTIVE",
            deletedAt: null,
            isAutomatedAccount: true,
          },
        }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({
          username: "target",
          isPrivateAccount: true,
        }),
      },
      ...limitMocks(),
    };
    const follows = { follow: vi.fn() };
    const executor = new BotActivityExecutor({
      database: database as never,
      posts: {} as never,
      comments: {} as never,
      follows: follows as never,
      targetPolicy: "test_fixtures_only",
    });

    const result = await executor.execute({
      id: "job-1",
      botAccountId: "bot-1",
      activityType: "FOLLOW_USER",
      targetType: "user",
      targetId: "user-2",
      metadata: {},
    });

    expect(result).toEqual({
      outcome: "skipped",
      reason: "private_account",
    });
    expect(follows.follow).not.toHaveBeenCalled();
  });

  it("never executes view activities", async () => {
    const database = {
      botAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bot-1",
          status: "ACTIVE",
          permissions: {},
          user: {
            id: "user-1",
            status: "ACTIVE",
            deletedAt: null,
            isAutomatedAccount: true,
          },
        }),
      },
      ...limitMocks(),
    };
    const executor = new BotActivityExecutor({
      database: database as never,
      posts: {} as never,
      comments: {} as never,
      follows: {} as never,
    });

    const result = await executor.execute({
      id: "job-1",
      botAccountId: "bot-1",
      activityType: "VIEW_POST",
      targetType: "post",
      targetId: "post-1",
      metadata: {},
    });

    expect(result).toEqual({ outcome: "skipped", reason: "views_disabled" });
  });
});

describe("bot job backoff", () => {
  it("increases delay with attempts", () => {
    expect(botJobBackoffMs(1)).toBe(5_000);
    expect(botJobBackoffMs(2)).toBe(10_000);
    expect(botJobBackoffMs(3)).toBe(20_000);
  });
});
