import {
  OutboxStatus,
  Prisma,
  type OutboxEvent,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import type { ChatService } from "../../modules/chat/application/services/chat-service.js";
import type { ChatIo } from "../../modules/chat/realtime/chat-gateway.js";

const createdPayloadSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
});
const deletedPayloadSchema = createdPayloadSchema.extend({
  actorId: z.uuid(),
  scope: z.enum(["me", "everyone"]),
});
const unmatchedPayloadSchema = z.object({
  matchId: z.uuid(),
  conversationId: z.uuid().nullable(),
});
const CHAT_EVENTS = [
  "chat.message.created",
  "chat.message.deleted",
  "chat.message.edited",
  "chat.match.unmatched",
];

export class ChatOutboxWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly database: PrismaClient,
    private readonly chat: ChatService,
    private readonly io: ChatIo,
    private readonly config: AppConfig,
  ) {}

  async start(): Promise<void> {
    if (this.timer) return;
    await this.recoverStaleEvents();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.CHAT_OUTBOX_POLL_MS);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let processed = 0; processed < 100; processed += 1) {
        const event = await this.claimNextEvent();
        if (!event) return;
        try {
          await this.deliver(event);
          await this.database.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: OutboxStatus.PROCESSED,
              processedAt: new Date(),
              lastError: null,
            },
          });
        } catch (error) {
          await this.failOrRetry(event, error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async deliver(event: OutboxEvent): Promise<void> {
    if (event.eventType === "chat.message.created") {
      const payload = createdPayloadSchema.parse(event.payload);
      const message = await this.chat.messageForRealtime(payload.messageId);
      if (message) {
        const memberIds = await this.chat.activeConversationMemberIds(
          payload.conversationId,
        );
        for (const memberId of memberIds) {
          this.io
            .in(`user:${memberId}`)
            .socketsJoin(`conversation:${payload.conversationId}`);
        }
        this.io
          .to(`conversation:${payload.conversationId}`)
          .emit("message:new", message);
      }
      return;
    }
    if (event.eventType === "chat.message.edited") {
      const payload = createdPayloadSchema.parse(event.payload);
      const message = await this.chat.messageForRealtime(payload.messageId);
      if (message) {
        this.io
          .to(`conversation:${payload.conversationId}`)
          .emit("message:edited", message);
      }
      return;
    }
    if (event.eventType === "chat.match.unmatched") {
      const payload = unmatchedPayloadSchema.parse(event.payload);
      if (payload.conversationId) {
        const room = `conversation:${payload.conversationId}`;
        this.io.to(room).emit("match:ended", {
          matchId: payload.matchId,
          conversationId: payload.conversationId,
        });
        this.io.in(room).socketsLeave(room);
      }
      return;
    }
    const payload = deletedPayloadSchema.parse(event.payload);
    const room =
      payload.scope === "everyone"
        ? `conversation:${payload.conversationId}`
        : `user:${payload.actorId}`;
    this.io.to(room).emit("message:deleted", {
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      scope: payload.scope,
    });
  }

  private claimNextEvent(): Promise<OutboxEvent | null> {
    return this.database.$transaction(
      async (transaction) => {
        const event = await transaction.outboxEvent.findFirst({
          where: {
            eventType: { in: CHAT_EVENTS },
            status: OutboxStatus.PENDING,
            availableAt: { lte: new Date() },
          },
          orderBy: { createdAt: "asc" },
        });
        if (!event) return null;
        const claimed = await transaction.outboxEvent.updateMany({
          where: { id: event.id, status: OutboxStatus.PENDING },
          data: {
            status: OutboxStatus.PROCESSING,
            attempts: { increment: 1 },
          },
        });
        if (claimed.count !== 1) return null;
        return transaction.outboxEvent.findUnique({
          where: { id: event.id },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async failOrRetry(
    event: OutboxEvent,
    error: unknown,
  ): Promise<void> {
    const exhausted = event.attempts >= 10;
    const message =
      error instanceof Error ? error.message.slice(0, 1_000) : "Unknown error";
    await this.database.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: exhausted ? OutboxStatus.FAILED : OutboxStatus.PENDING,
        availableAt: new Date(
          Date.now() + Math.min(2 ** event.attempts * 1_000, 60_000),
        ),
        lastError: message,
      },
    });
  }

  private recoverStaleEvents(): Promise<{ count: number }> {
    return this.database.outboxEvent.updateMany({
      where: {
        eventType: { in: CHAT_EVENTS },
        status: OutboxStatus.PROCESSING,
        updatedAt: { lt: new Date(Date.now() - 5 * 60_000) },
      },
      data: {
        status: OutboxStatus.PENDING,
        availableAt: new Date(),
      },
    });
  }
}
