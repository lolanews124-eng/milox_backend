import {
  OutboxStatus,
  type OutboxEvent,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import type { ChatService } from "../../modules/chat/application/services/chat-service.js";
import type { ChatIo } from "../../modules/chat/realtime/chat-gateway.js";
import type { CallService } from "../../modules/calls/application/call-service.js";
import { CallEndReason } from "@prisma/client";
import { claimNextOutboxEvent } from "../../shared/claim-outbox-event.js";
import {
  CHAT_OUTBOX_IDLE_CAP_MS,
  nextOutboxPollDelay,
  OUTBOX_STALE_RECOVERY_MS,
} from "../outbox-poll.js";

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
const conversationLeftPayloadSchema = z.object({
  conversationId: z.uuid(),
  actorId: z.uuid(),
  peerId: z.uuid().nullable(),
});
const CHAT_EVENTS = [
  "chat.message.created",
  "chat.message.deleted",
  "chat.message.edited",
  "chat.match.unmatched",
  "chat.conversation.left",
];

export class ChatOutboxWorker {
  private timer: NodeJS.Timeout | undefined;
  private recoveryTimer: NodeJS.Timeout | undefined;
  private running = false;
  private started = false;
  private pendingWake = false;
  private emptyStreak = 0;

  constructor(
    private readonly database: PrismaClient,
    private readonly chat: ChatService,
    private readonly io: ChatIo,
    private readonly config: AppConfig,
    private readonly calls?: CallService,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.recoverStaleEvents();
    this.recoveryTimer = setInterval(() => {
      void this.recoverStaleEvents().catch((error: unknown) => {
        console.warn(
          "Chat outbox stale recovery failed",
          error instanceof Error ? error.message : error,
        );
      });
    }, OUTBOX_STALE_RECOVERY_MS);
    this.recoveryTimer.unref();
    this.arm(0);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = undefined;
  }

  wake(): void {
    this.emptyStreak = 0;
    if (this.running) {
      this.pendingWake = true;
      return;
    }
    if (!this.started) {
      void this.tick();
      return;
    }
    this.arm(0);
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.pendingWake = true;
      return;
    }
    this.running = true;
    let processed = 0;
    let batchFull = false;
    let deferred = false;
    try {
      do {
        this.pendingWake = false;
        processed = 0;
        deferred = false;
        for (let index = 0; index < 100; index += 1) {
          let event: OutboxEvent | null;
          try {
            event = await this.claimNextEvent();
          } catch (error) {
            // Transient DB contention — back off instead of spinning.
            console.warn(
              "Chat outbox claim deferred",
              error instanceof Error ? error.message : error,
            );
            deferred = true;
            break;
          }
          if (!event) break;
          processed += 1;
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
        batchFull = processed === 100;
      } while (this.pendingWake && !deferred);
    } finally {
      this.running = false;
      const wakeNow = this.pendingWake;
      this.pendingWake = false;
      if (!this.started) {
        if (wakeNow && !deferred) void this.tick();
      } else if (!deferred && (wakeNow || batchFull)) {
        this.emptyStreak = 0;
        this.arm(0);
      } else if (processed > 0) {
        this.emptyStreak = 0;
        this.arm(this.config.CHAT_OUTBOX_POLL_MS);
      } else {
        this.emptyStreak += 1;
        this.arm(
          nextOutboxPollDelay(
            this.config.CHAT_OUTBOX_POLL_MS,
            this.emptyStreak,
            CHAT_OUTBOX_IDLE_CAP_MS,
          ),
        );
      }
    }
  }

  private arm(delayMs: number): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
    this.timer.unref();
  }

  private async deliver(event: OutboxEvent): Promise<void> {
    if (event.eventType === "chat.message.created") {
      const payload = createdPayloadSchema.parse(event.payload);
      const message = await this.chat.messageForRealtime(payload.messageId);
      if (message) {
        const memberIds = await this.joinConversationMembers(
          payload.conversationId,
        );
        this.emitToConversationMembers(
          payload.conversationId,
          memberIds,
          "message:new",
          message,
        );
      }
      return;
    }
    if (event.eventType === "chat.message.edited") {
      const payload = createdPayloadSchema.parse(event.payload);
      const message = await this.chat.messageForRealtime(payload.messageId);
      if (message) {
        const memberIds = await this.joinConversationMembers(
          payload.conversationId,
        );
        this.emitToConversationMembers(
          payload.conversationId,
          memberIds,
          "message:edited",
          message,
        );
      }
      return;
    }
    if (event.eventType === "chat.match.unmatched") {
      const payload = unmatchedPayloadSchema.parse(event.payload);
      if (payload.conversationId) {
        await this.calls?.endCallsForConversation(
          payload.conversationId,
          CallEndReason.UNMATCH,
        );
        const room = `conversation:${payload.conversationId}`;
        this.io.to(room).emit("match:ended", {
          matchId: payload.matchId,
          conversationId: payload.conversationId,
        });
        this.io.in(room).socketsLeave(room);
      }
      return;
    }
    if (event.eventType === "chat.conversation.left") {
      const payload = conversationLeftPayloadSchema.parse(event.payload);
      const room = `conversation:${payload.conversationId}`;
      this.io.in(`user:${payload.actorId}`).socketsLeave(room);
      if (payload.peerId) {
        this.io.to(`user:${payload.peerId}`).emit("conversation:left", {
          conversationId: payload.conversationId,
          actorId: payload.actorId,
        });
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

  private async joinConversationMembers(
    conversationId: string,
  ): Promise<string[]> {
    const memberIds =
      await this.chat.activeConversationMemberIds(conversationId);
    const room = `conversation:${conversationId}`;
    await Promise.all(
      memberIds.map((memberId) =>
        Promise.resolve(this.io.in(`user:${memberId}`).socketsJoin(room)),
      ),
    );
    return memberIds;
  }

  private emitToConversationMembers(
    conversationId: string,
    memberIds: string[],
    event: "message:new" | "message:edited",
    message: object,
  ): void {
    this.io.to(`conversation:${conversationId}`).emit(event, message);
    for (const memberId of memberIds) {
      this.io.to(`user:${memberId}`).emit(event, message);
    }
  }

  private claimNextEvent(): Promise<OutboxEvent | null> {
    return claimNextOutboxEvent(this.database, CHAT_EVENTS);
  }

  private async failOrRetry(event: OutboxEvent, error: unknown): Promise<void> {
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
