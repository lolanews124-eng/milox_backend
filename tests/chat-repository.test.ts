import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { MessageViewRecord } from "../src/modules/chat/application/chat-view.js";
import { PrismaChatRepository } from "../src/modules/chat/infrastructure/prisma-chat-repository.js";

const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const conversationId = "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e";
const messageId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";
const key = "4c960e9a-592a-41e0-9942-2589f5dd0894";

describe("PrismaChatRepository", () => {
  it("replays an idempotent message without a second transaction", async () => {
    const message = messageFixture();
    const database = {
      idempotencyRecord: {
        findUnique: vi.fn().mockResolvedValue({
          requestHash: "a".repeat(64),
          resourceId: messageId,
        }),
      },
      message: { findUnique: vi.fn().mockResolvedValue(message) },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const result = await new PrismaChatRepository(database).sendMessage(
      sendData(),
    );

    expect(result).toEqual({ message, replayed: true });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("persists message, unread count, idempotency and outbox atomically", async () => {
    const message = messageFixture();
    const transaction = {
      conversation: {
        findFirst: vi.fn().mockResolvedValue({ id: conversationId }),
        update: vi.fn().mockResolvedValue({}),
      },
      message: { create: vi.fn().mockResolvedValue(message) },
      conversationMember: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      idempotencyRecord: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    const database = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      message: { findUnique: vi.fn() },
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    } as unknown as PrismaClient;

    const result = await new PrismaChatRepository(database).sendMessage(
      sendData(),
    );

    expect(result).toEqual({ message, replayed: false });
    expect(transaction.conversationMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unreadCount: { increment: 1 },
          isArchived: false,
        }),
      }),
    );
    expect(transaction.outboxEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ eventType: "chat.message.created" }),
          expect.objectContaining({ eventType: "message.created" }),
        ]),
      }),
    );
  });
});

function sendData() {
  return {
    conversationId,
    senderId: userId,
    type: "TEXT" as const,
    body: "hello",
    mediaId: null,
    replyToId: null,
    idempotencyKey: key,
    requestHash: "a".repeat(64),
  };
}

function messageFixture(): MessageViewRecord {
  return {
    id: messageId,
    conversationId,
    senderId: userId,
    replyToId: null,
    type: "TEXT",
    body: "hello",
    deliveryStatus: "SENT",
    deletedForEveryoneAt: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    mediaAsset: null,
  };
}
