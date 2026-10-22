import {
  OutboxStatus,
  type OutboxEvent,
  type PrismaClient,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { NotificationOutboxWorker } from "../src/jobs/notifications/notification-outbox-worker.js";
import { BotActivityExecutor } from "../src/modules/bots/application/bot-activity-executor.js";
import { BOTS_TEST_FIXTURE_MARKER } from "../src/modules/bots/application/bot-target-policy.js";
import type { ChatIo } from "../src/modules/chat/realtime/chat-gateway.js";
import { PrismaCommentRepository } from "../src/modules/comments/infrastructure/prisma-comment-repository.js";
import { PrismaFollowRepository } from "../src/modules/follows/infrastructure/prisma-follow-repository.js";
import type { NotificationService } from "../src/modules/notifications/application/services/notification-service.js";
import { PrismaNotificationRepository } from "../src/modules/notifications/infrastructure/prisma-notification-repository.js";
import { PrismaPostRepository } from "../src/modules/posts/infrastructure/prisma-post-repository.js";
import type { PushSender } from "../src/modules/push/application/services/fcm-push-sender.js";
import { AppError } from "../src/shared/errors/app-error.js";

const botUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const recipientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const postId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const commentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const followId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const eventId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function limitMocks() {
  return {
    postLike: { count: vi.fn().mockResolvedValue(0) },
    comment: { count: vi.fn().mockResolvedValue(0) },
    follow: { count: vi.fn().mockResolvedValue(0) },
    botActivityJob: { count: vi.fn().mockResolvedValue(0) },
  };
}

function activeBotDatabase(extra: Record<string, unknown> = {}) {
  return {
    botAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: "bot-1",
        status: "ACTIVE",
        permissions: {},
        user: {
          id: botUserId,
          status: "ACTIVE",
          deletedAt: null,
          isAutomatedAccount: true,
        },
      }),
    },
    ...limitMocks(),
    ...extra,
  };
}

describe("bot activity → notification outbox (domain path)", () => {
  it("automated like still creates post.liked outbox for the post owner", async () => {
    const outboxCreate = vi.fn().mockResolvedValue({});
    const transaction = {
      post: {
        findFirst: vi.fn().mockResolvedValue({ authorId: recipientId }),
        findUnique: vi.fn().mockResolvedValue({ id: postId }),
        update: vi.fn(),
      },
      postLike: { create: vi.fn().mockResolvedValue({}) },
      user: {
        findUnique: vi.fn().mockResolvedValue({ isAutomatedAccount: true }),
      },
      outboxEvent: { create: outboxCreate },
    };
    const database = {
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    } as unknown as PrismaClient;

    await new PrismaPostRepository(database).like(postId, botUserId);

    expect(transaction.post.update).toHaveBeenCalledWith({
      where: { id: postId },
      data: { likeCount: { increment: 1 } },
    });
    expect(outboxCreate).toHaveBeenCalledWith({
      data: {
        eventType: "post.liked",
        aggregateType: "post",
        aggregateId: postId,
        payload: {
          postId,
          actorId: botUserId,
          recipientId,
        },
      },
    });
  });

  it("automated comment still creates post.commented outbox", async () => {
    const outboxCreate = vi.fn().mockResolvedValue({});
    const transaction = {
      post: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: postId, authorId: recipientId }),
        update: vi.fn(),
      },
      comment: {
        create: vi.fn().mockResolvedValue({ id: commentId }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: commentId }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ isAutomatedAccount: true }),
      },
      outboxEvent: { create: outboxCreate },
    };
    const database = {
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    } as unknown as PrismaClient;

    await new PrismaCommentRepository(database).create({
      postId,
      authorId: botUserId,
      body: "nice post",
    });

    expect(transaction.post.update).toHaveBeenCalledWith({
      where: { id: postId },
      data: { commentCount: { increment: 1 } },
    });
    expect(outboxCreate).toHaveBeenCalledWith({
      data: {
        eventType: "post.commented",
        aggregateType: "comment",
        aggregateId: commentId,
        payload: {
          commentId,
          postId,
          actorId: botUserId,
          recipientId,
        },
      },
    });
  });

  it("automated follow still creates user.followed outbox", async () => {
    const outboxCreate = vi.fn().mockResolvedValue({});
    const transaction = {
      follow: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: followId }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ isAutomatedAccount: true }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ followerCount: 3 }),
        update: vi.fn().mockResolvedValue({ followerCount: 4 }),
      },
      outboxEvent: { create: outboxCreate },
    };
    const database = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: recipientId,
          isPrivateAccount: false,
        }),
      },
      follow: { findUnique: vi.fn() },
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    } as unknown as PrismaClient;

    await new PrismaFollowRepository(database).follow("target_user", botUserId);

    expect(transaction.user.update).toHaveBeenCalled();
    expect(outboxCreate).toHaveBeenCalledWith({
      data: {
        eventType: "user.followed",
        aggregateType: "follow",
        aggregateId: followId,
        payload: {
          followId,
          actorId: botUserId,
          recipientId,
        },
      },
    });
  });
});

describe("bot executor → domain services (notification entry points)", () => {
  it("successful like calls PostService.like with the bot user id", async () => {
    const posts = { like: vi.fn().mockResolvedValue({}) };
    const executor = new BotActivityExecutor({
      database: activeBotDatabase({
        post: {
          findFirst: vi.fn().mockResolvedValue({
            id: postId,
            body: `hello ${BOTS_TEST_FIXTURE_MARKER}`,
          }),
        },
      }) as never,
      posts: posts as never,
      comments: {} as never,
      follows: {} as never,
      targetPolicy: "test_fixtures_only",
    });

    const result = await executor.execute({
      id: "job-like",
      botAccountId: "bot-1",
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      metadata: {},
    });

    expect(result).toEqual({ outcome: "processed", detail: "liked" });
    expect(posts.like).toHaveBeenCalledWith(postId, botUserId);
  });

  it("successful comment calls CommentService.create with the bot user id", async () => {
    const comments = { create: vi.fn().mockResolvedValue({}) };
    const limits = limitMocks();
    const executor = new BotActivityExecutor({
      database: activeBotDatabase({
        post: {
          findFirst: vi.fn().mockResolvedValue({
            id: postId,
            body: `hello ${BOTS_TEST_FIXTURE_MARKER}`,
          }),
        },
        comment: {
          ...limits.comment,
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }) as never,
      posts: {} as never,
      comments: comments as never,
      follows: {} as never,
      targetPolicy: "test_fixtures_only",
    });

    const result = await executor.execute({
      id: "job-comment",
      botAccountId: "bot-1",
      activityType: "COMMENT_POST",
      targetType: "post",
      targetId: postId,
      metadata: { body: "great shot" },
    });

    expect(result).toEqual({ outcome: "processed", detail: "commented" });
    expect(comments.create).toHaveBeenCalledWith(postId, botUserId, {
      body: "great shot",
    });
  });

  it("successful follow calls FollowService.follow with the bot user id", async () => {
    const follows = { follow: vi.fn().mockResolvedValue({}) };
    const executor = new BotActivityExecutor({
      database: activeBotDatabase({
        user: {
          findFirst: vi.fn().mockResolvedValue({
            username: "target_user",
            isPrivateAccount: false,
            bio: BOTS_TEST_FIXTURE_MARKER,
            displayName: null,
          }),
        },
      }) as never,
      posts: {} as never,
      comments: {} as never,
      follows: follows as never,
      targetPolicy: "test_fixtures_only",
    });

    const result = await executor.execute({
      id: "job-follow",
      botAccountId: "bot-1",
      activityType: "FOLLOW_USER",
      targetType: "user",
      targetId: recipientId,
      metadata: {},
    });

    expect(result).toEqual({ outcome: "processed", detail: "followed" });
    expect(follows.follow).toHaveBeenCalledWith("target_user", botUserId);
  });

  it("failed like does not leave a path to notifications (domain not called)", async () => {
    const posts = {
      like: vi
        .fn()
        .mockRejectedValue(new AppError("INTERNAL_ERROR", "db down", 500)),
    };
    const executor = new BotActivityExecutor({
      database: activeBotDatabase({
        post: {
          findFirst: vi.fn().mockResolvedValue({
            id: postId,
            body: `hello ${BOTS_TEST_FIXTURE_MARKER}`,
          }),
        },
      }) as never,
      posts: posts as never,
      comments: {} as never,
      follows: {} as never,
      targetPolicy: "test_fixtures_only",
    });

    const result = await executor.execute({
      id: "job-fail",
      botAccountId: "bot-1",
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      metadata: {},
    });

    expect(result.outcome).toBe("failed");
    expect(posts.like).toHaveBeenCalledOnce();
  });

  it("duplicate like is skipped without re-entering the like path successfully", async () => {
    const posts = {
      like: vi
        .fn()
        .mockRejectedValue(new AppError("ALREADY_LIKED", "already", 409)),
    };
    const executor = new BotActivityExecutor({
      database: activeBotDatabase({
        post: {
          findFirst: vi.fn().mockResolvedValue({
            id: postId,
            body: `hello ${BOTS_TEST_FIXTURE_MARKER}`,
          }),
        },
      }) as never,
      posts: posts as never,
      comments: {} as never,
      follows: {} as never,
      targetPolicy: "test_fixtures_only",
    });

    const result = await executor.execute({
      id: "job-dup",
      botAccountId: "bot-1",
      activityType: "LIKE_POST",
      targetType: "post",
      targetId: postId,
      metadata: {},
    });

    expect(result).toEqual({
      outcome: "skipped",
      reason: "already_liked",
    });
  });

  it("duplicate comment body is skipped before CommentService.create", async () => {
    const comments = { create: vi.fn() };
    const limits = limitMocks();
    const executor = new BotActivityExecutor({
      database: activeBotDatabase({
        post: {
          findFirst: vi.fn().mockResolvedValue({
            id: postId,
            body: `hello ${BOTS_TEST_FIXTURE_MARKER}`,
          }),
        },
        comment: {
          ...limits.comment,
          findFirst: vi.fn().mockResolvedValue({ id: commentId }),
        },
      }) as never,
      posts: {} as never,
      comments: comments as never,
      follows: {} as never,
      targetPolicy: "test_fixtures_only",
    });

    const result = await executor.execute({
      id: "job-dup-comment",
      botAccountId: "bot-1",
      activityType: "COMMENT_POST",
      targetType: "post",
      targetId: postId,
      metadata: { body: "great shot" },
    });

    expect(result).toEqual({
      outcome: "skipped",
      reason: "duplicate_comment_body",
    });
    expect(comments.create).not.toHaveBeenCalled();
  });
});

describe("notification outbox → FCM for bot-equivalent events", () => {
  it.each([
    {
      eventType: "post.liked",
      type: "NEW_LIKE",
      payload: { actorId: botUserId, recipientId, postId },
      expectedPayload: { postId },
    },
    {
      eventType: "post.commented",
      type: "NEW_COMMENT",
      payload: {
        actorId: botUserId,
        recipientId,
        postId,
        commentId,
      },
      expectedPayload: { postId, commentId },
    },
    {
      eventType: "user.followed",
      type: "NEW_FOLLOWER",
      payload: { actorId: botUserId, recipientId, followId },
      expectedPayload: { followId },
    },
  ] as const)(
    "creates $type and requests FCM for $eventType",
    async ({ eventType, type, payload, expectedPayload }) => {
      const event = eventFixture(eventType, { ...payload });
      const presented = {
        id: "notification-id",
        type,
        actor: {
          id: botUserId,
          username: "bot_alpha",
          displayName: "Bot Alpha",
        },
        payload: expectedPayload,
      };
      const push: PushSender = {
        isEnabled: () => true,
        sendForNotification: vi.fn().mockResolvedValue(undefined),
        sendData: vi.fn(),
      };
      const harness = createOutboxHarness(event, push);
      vi.mocked(harness.notifications.createFromEvent).mockResolvedValue(
        presented,
      );

      await harness.worker.tick();

      expect(harness.notifications.createFromEvent).toHaveBeenCalledWith({
        sourceEventId: event.id,
        recipientId,
        actorId: botUserId,
        type,
        payload: expectedPayload,
      });
      expect(push.sendForNotification).toHaveBeenCalledWith(
        recipientId,
        presented,
      );
      expect(harness.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OutboxStatus.PROCESSED }),
        }),
      );
    },
  );

  it("does not request FCM when notification creation is suppressed (block/rules)", async () => {
    const event = eventFixture("post.liked", {
      actorId: botUserId,
      recipientId,
      postId,
    });
    const push: PushSender = {
      isEnabled: () => true,
      sendForNotification: vi.fn(),
      sendData: vi.fn(),
    };
    const harness = createOutboxHarness(event, push);
    vi.mocked(harness.notifications.createFromEvent).mockResolvedValue(null);

    await harness.worker.tick();

    expect(push.sendForNotification).not.toHaveBeenCalled();
    expect(harness.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OutboxStatus.PROCESSED }),
      }),
    );
  });

  it("FCM failure does not fail the outbox event (activity stays completed)", async () => {
    const event = eventFixture("user.followed", {
      actorId: botUserId,
      recipientId,
      followId,
    });
    const push: PushSender = {
      isEnabled: () => true,
      sendForNotification: vi
        .fn()
        .mockRejectedValue(new Error("fcm_unavailable")),
      sendData: vi.fn(),
    };
    const harness = createOutboxHarness(event, push);
    vi.mocked(harness.notifications.createFromEvent).mockResolvedValue({
      id: "notification-id",
      type: "NEW_FOLLOWER",
      payload: { followId },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await harness.worker.tick();

    expect(push.sendForNotification).toHaveBeenCalled();
    expect(harness.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OutboxStatus.PROCESSED }),
      }),
    );
    consoleError.mockRestore();
  });
});

describe("notification preferences / block rules (shared repository)", () => {
  it("suppresses create when recipient is not visible to the actor (blocks)", async () => {
    const database = {
      notification: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    const result = await new PrismaNotificationRepository(database).create({
      sourceEventId: eventId,
      recipientId,
      actorId: botUserId,
      type: "NEW_LIKE",
      payload: { postId },
    });

    expect(result).toBeNull();
    expect(database.notification.create).not.toHaveBeenCalled();
  });

  it("deduplicates by sourceEventId so outbox retries do not insert twice", async () => {
    const existing = {
      id: "notification-id",
      type: "NEW_LIKE" as const,
      payload: { postId },
      isRead: false,
      readAt: null,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
      actor: null,
    };
    const create = vi.fn();
    const database = {
      notification: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create,
      },
      user: { findFirst: vi.fn() },
    } as unknown as PrismaClient;

    const result = await new PrismaNotificationRepository(database).create({
      sourceEventId: eventId,
      recipientId,
      actorId: botUserId,
      type: "NEW_LIKE",
      payload: { postId },
    });

    expect(result).toEqual(existing);
    expect(create).not.toHaveBeenCalled();
  });
});

function createOutboxHarness(event: OutboxEvent, push?: PushSender) {
  const update = vi.fn().mockResolvedValue({});
  const database = {
    $queryRaw: vi.fn().mockResolvedValueOnce([event]).mockResolvedValue([]),
    outboxEvent: { update, updateMany: vi.fn() },
  } as unknown as PrismaClient;
  const emit = vi.fn();
  const ioObject = { to: vi.fn(() => ({ emit })) };
  const notificationObject = {
    createFromEvent: vi.fn(),
    resolveMessageTarget: vi.fn(),
  };
  return {
    worker: new NotificationOutboxWorker(
      database,
      notificationObject as unknown as NotificationService,
      ioObject as unknown as ChatIo,
      { NOTIFICATION_OUTBOX_POLL_MS: 500 } as AppConfig,
      push,
    ),
    notifications: notificationObject,
    update,
  };
}

function eventFixture(
  eventType: string,
  payload: Record<string, string>,
): OutboxEvent {
  return {
    id: eventId,
    eventType,
    aggregateType: "test",
    aggregateId: postId,
    payload,
    status: OutboxStatus.PROCESSING,
    attempts: 1,
    availableAt: new Date("2026-07-17T00:00:00.000Z"),
    processedAt: null,
    lastError: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
  };
}
