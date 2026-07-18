import {
  OutboxStatus,
  type OutboxEvent,
  type PrismaClient,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { NotificationOutboxWorker } from "../src/jobs/notifications/notification-outbox-worker.js";
import type { ChatIo } from "../src/modules/chat/realtime/chat-gateway.js";
import type { NotificationService } from "../src/modules/notifications/application/services/notification-service.js";

const actorId = "fca0622f-cba7-4398-bfe7-11842c026990";
const recipientId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const postId = "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e";

describe("NotificationOutboxWorker", () => {
  it("persists and emits a privacy-safe like notification", async () => {
    const event = eventFixture("post.liked", {
      actorId,
      recipientId,
      postId,
    });
    const harness = createHarness(event);
    vi.mocked(harness.notifications.createFromEvent).mockResolvedValue({
      id: "notification-id",
      type: "NEW_LIKE",
      payload: { postId },
    });

    await harness.worker.tick();

    expect(harness.notifications.createFromEvent).toHaveBeenCalledWith({
      sourceEventId: event.id,
      recipientId,
      actorId,
      type: "NEW_LIKE",
      payload: { postId },
    });
    expect(harness.io.to).toHaveBeenCalledWith(`user:${recipientId}`);
    expect(harness.emit).toHaveBeenCalledWith(
      "notification:new",
      expect.objectContaining({ type: "NEW_LIKE" }),
    );
    expect(harness.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OutboxStatus.PROCESSED }),
      }),
    );
  });

  it("suppresses new-message notifications for muted recipients", async () => {
    const event = eventFixture("message.created", {
      messageId: "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1",
      conversationId: "98ea1ca9-5f22-4207-8659-3db6e5d54861",
      senderId: actorId,
    });
    const harness = createHarness(event);
    vi.mocked(harness.notifications.resolveMessageTarget).mockResolvedValue(
      null,
    );

    await harness.worker.tick();

    expect(harness.notifications.createFromEvent).not.toHaveBeenCalled();
    expect(harness.emit).not.toHaveBeenCalled();
    expect(harness.update).toHaveBeenCalled();
  });
});

function createHarness(event: OutboxEvent) {
  const transaction = {
    outboxEvent: {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(event)
        .mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(event),
    },
  };
  const update = vi.fn().mockResolvedValue({});
  const database = {
    $transaction: vi.fn(
      (callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
    ),
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
    ),
    notifications: notificationObject,
    io: ioObject,
    emit,
    update,
  };
}

function eventFixture(
  eventType: string,
  payload: Record<string, string>,
): OutboxEvent {
  return {
    id: "4c960e9a-592a-41e0-9942-2589f5dd0894",
    eventType,
    aggregateType: "test",
    aggregateId: "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1",
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
