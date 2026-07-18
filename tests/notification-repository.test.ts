import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { NotificationViewRecord } from "../src/modules/notifications/application/notification-view.js";
import { PrismaNotificationRepository } from "../src/modules/notifications/infrastructure/prisma-notification-repository.js";

const recipientId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const actorId = "fca0622f-cba7-4398-bfe7-11842c026990";
const eventId = "98ea1ca9-5f22-4207-8659-3db6e5d54861";

describe("PrismaNotificationRepository", () => {
  it("deduplicates outbox retries before another insert", async () => {
    const notification = notificationFixture();
    const findUnique = vi.fn().mockResolvedValue(notification);
    const create = vi.fn();
    const database = {
      notification: { findUnique, create },
      user: { findFirst: vi.fn() },
    } as unknown as PrismaClient;

    const result = await new PrismaNotificationRepository(database).create({
      sourceEventId: eventId,
      recipientId,
      actorId,
      type: "NEW_LIKE",
      payload: { postId: "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e" },
    });

    expect(result).toEqual(notification);
    expect(create).not.toHaveBeenCalled();
  });

  it("scopes mark-read updates to the authenticated recipient", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      notification: { updateMany },
    } as unknown as PrismaClient;

    await new PrismaNotificationRepository(database).markRead(recipientId, {
      all: false,
      ids: ["a04189bc-c1f2-4da2-bef8-c8289b5ad4a1"],
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recipientId,
          isRead: false,
        }),
        data: {
          isRead: true,
          readAt: expect.any(Date),
        },
      }),
    );
  });
});

function notificationFixture(): NotificationViewRecord {
  return {
    id: "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1",
    type: "NEW_LIKE",
    payload: { postId: "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e" },
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    actor: null,
  };
}
