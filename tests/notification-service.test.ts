import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { NotificationRepository } from "../src/modules/notifications/application/ports/notification-repository.js";
import type { NotificationViewRecord } from "../src/modules/notifications/application/notification-view.js";
import { NotificationService } from "../src/modules/notifications/application/services/notification-service.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "notification-service-secret-32bytes",
} as AppConfig;
const recipientId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const actorId = "fca0622f-cba7-4398-bfe7-11842c026990";
const notificationId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";

describe("NotificationService", () => {
  it("returns privacy-safe pages and signed cursors", async () => {
    const repository = createRepository();
    vi.mocked(repository.list).mockResolvedValue([
      notificationFixture(true),
      notificationFixture(false),
    ]);

    const page = await createService(repository).list(recipientId, {
      unreadOnly: true,
      limit: 1,
    });

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));
    const actor = (page.items[0] as {
      actor: Record<string, unknown>;
    }).actor;
    expect(actor).not.toHaveProperty("age");
    expect(actor).not.toHaveProperty("countryCode");
    expect(actor).not.toHaveProperty("email");
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId, unreadOnly: true }),
    );
  });

  it("returns the authoritative unread count", async () => {
    const repository = createRepository();
    vi.mocked(repository.unreadCount).mockResolvedValue(7);

    await expect(
      createService(repository).unreadCount(recipientId),
    ).resolves.toEqual({ count: 7 });
  });

  it("requires either all or IDs when marking read", async () => {
    const repository = createRepository();
    const service = createService(repository);
    await expect(
      service.markRead(recipientId, { all: false, ids: [] }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.markRead(recipientId, {
        all: true,
        ids: [notificationId],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(repository.markRead).not.toHaveBeenCalled();
  });

  it("marks only recipient-owned IDs", async () => {
    const repository = createRepository();
    vi.mocked(repository.markRead).mockResolvedValue(1);

    await createService(repository).markRead(recipientId, {
      all: false,
      ids: [notificationId],
    });

    expect(repository.markRead).toHaveBeenCalledWith(recipientId, {
      all: false,
      ids: [notificationId],
    });
  });
});

function createService(
  repository: NotificationRepository,
): NotificationService {
  return new NotificationService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
}

function createRepository(): NotificationRepository {
  return {
    list: vi.fn(),
    unreadCount: vi.fn(),
    markRead: vi.fn(),
    create: vi.fn(),
    resolveMessageTarget: vi.fn(),
  };
}

function notificationFixture(hidden: boolean): NotificationViewRecord {
  return {
    id: notificationId,
    type: "NEW_LIKE",
    payload: { postId: "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e" },
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    actor: {
      id: actorId,
      username: "actor",
      displayName: null,
      bio: null,
      dateOfBirth: new Date("2000-01-01T00:00:00.000Z"),
      gender: "OTHER",
      countryCode: "IN",
      relationshipGoal: null,
      websiteUrl: null,
      instagramHandle: null,
      isVerifiedBadge: false,
      isPrivateAccount: false,
      hideAge: hidden,
      hideCountry: hidden,
      followerCount: 0,
      followingCount: 0,
      postCount: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      profilePhoto: null,
      coverPhoto: null,
      interests: [],
    },
  };
}
