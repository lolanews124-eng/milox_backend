import {
  OutboxStatus,
  type OutboxEvent,
  type PrismaClient,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { ChatOutboxWorker } from "../src/jobs/chat/chat-outbox-worker.js";
import type { ChatService } from "../src/modules/chat/application/services/chat-service.js";
import type { ChatIo } from "../src/modules/chat/realtime/chat-gateway.js";

const conversationId = "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e";
const messageId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";

describe("ChatOutboxWorker", () => {
  it("delivers a persisted message event and marks it processed", async () => {
    const event = eventFixture();
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
    const socketsJoin = vi.fn();
    const io = {
      to: vi.fn(() => ({ emit })),
      in: vi.fn(() => ({ socketsJoin })),
    } as unknown as ChatIo;
    const chat = {
      activeConversationMemberIds: vi
        .fn()
        .mockResolvedValue(["8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9"]),
      messageForRealtime: vi.fn().mockResolvedValue({
        id: messageId,
        conversationId,
        body: "hello",
      }),
    } as unknown as ChatService;
    const worker = new ChatOutboxWorker(database, chat, io, {
      CHAT_OUTBOX_POLL_MS: 500,
    } as AppConfig);

    await worker.tick();

    expect(io.to).toHaveBeenCalledWith(`conversation:${conversationId}`);
    expect(socketsJoin).toHaveBeenCalledWith(
      `conversation:${conversationId}`,
    );
    expect(emit).toHaveBeenCalledWith(
      "message:new",
      expect.objectContaining({ id: messageId }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: {
        status: OutboxStatus.PROCESSED,
        processedAt: expect.any(Date),
        lastError: null,
      },
    });
  });
});

function eventFixture(): OutboxEvent {
  return {
    id: "98ea1ca9-5f22-4207-8659-3db6e5d54861",
    eventType: "chat.message.created",
    aggregateType: "message",
    aggregateId: messageId,
    payload: { messageId, conversationId },
    status: OutboxStatus.PROCESSING,
    attempts: 1,
    availableAt: new Date("2026-07-17T00:00:00.000Z"),
    processedAt: null,
    lastError: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
  };
}
