import { describe, expect, it, vi } from "vitest";

import { BotActivityExecutor } from "../src/modules/bots/application/bot-activity-executor.js";
import { BOTS_TEST_FIXTURE_MARKER } from "../src/modules/bots/application/bot-target-policy.js";

/**
 * Counter consistency: executor uses domain services only; duplicates skip;
 * denormalized totals are owned by Post/Comment/Follow repositories.
 */
describe("bot activity counter consistency", () => {
  function activeBotDb() {
    return {
      botAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: "bot-1",
          status: "ACTIVE",
          permissions: {},
          user: {
            id: "bot-user-1",
            status: "ACTIVE",
            deletedAt: null,
            isAutomatedAccount: true,
          },
        }),
      },
      post: {
        findFirst: vi.fn().mockResolvedValue({
          id: "post-1",
          body: `ok ${BOTS_TEST_FIXTURE_MARKER}`,
        }),
      },
      comment: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },
      postLike: { count: vi.fn().mockResolvedValue(0) },
      follow: { count: vi.fn().mockResolvedValue(0) },
      botActivityJob: { count: vi.fn().mockResolvedValue(0) },
      user: {
        findFirst: vi.fn().mockResolvedValue({
          username: "target_user",
          isPrivateAccount: false,
          bio: `ok ${BOTS_TEST_FIXTURE_MARKER}`,
          displayName: "Target",
        }),
      },
    };
  }

  it("LIKE_POST goes through PostService.like (single domain path)", async () => {
    const database = activeBotDb();
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
    expect(posts.like).toHaveBeenCalledTimes(1);
    expect(posts.like).toHaveBeenCalledWith("post-1", "bot-user-1");
  });

  it("duplicate LIKE_POST skips without a second PostService.like success path", async () => {
    const { AppError } = await import("../src/shared/errors/app-error.js");
    const database = activeBotDb();
    const posts = {
      like: vi
        .fn()
        .mockRejectedValue(new AppError("ALREADY_LIKED", "Already liked", 409)),
    };
    const executor = new BotActivityExecutor({
      database: database as never,
      posts: posts as never,
      comments: {} as never,
      follows: {} as never,
      targetPolicy: "test_fixtures_only",
    });

    const result = await executor.execute({
      id: "job-2",
      botAccountId: "bot-1",
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: "post-1",
      metadata: {},
    });

    expect(result.outcome).toBe("skipped");
    expect(posts.like).toHaveBeenCalledTimes(1);
  });

  it("COMMENT_POST and FOLLOW_USER use domain services only", async () => {
    const database = activeBotDb();
    const comments = { create: vi.fn().mockResolvedValue({}) };
    const follows = { follow: vi.fn().mockResolvedValue({}) };
    const executor = new BotActivityExecutor({
      database: database as never,
      posts: {} as never,
      comments: comments as never,
      follows: follows as never,
      targetPolicy: "test_fixtures_only",
    });

    const commented = await executor.execute({
      id: "job-3",
      botAccountId: "bot-1",
      activityType: "COMMENT_POST",
      targetType: "post",
      targetId: "post-1",
      metadata: { body: "hello" },
    });
    expect(commented).toEqual({ outcome: "processed", detail: "commented" });
    expect(comments.create).toHaveBeenCalledWith("post-1", "bot-user-1", {
      body: "hello",
    });

    const followed = await executor.execute({
      id: "job-4",
      botAccountId: "bot-1",
      activityType: "FOLLOW_USER",
      targetType: "user",
      targetId: "user-1",
      metadata: {},
    });
    expect(followed).toEqual({ outcome: "processed", detail: "followed" });
    expect(follows.follow).toHaveBeenCalledWith("target_user", "bot-user-1");
  });
});
