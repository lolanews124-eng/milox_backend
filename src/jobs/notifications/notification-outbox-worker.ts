import {
  NotificationType,
  OutboxStatus,
  Prisma,
  type OutboxEvent,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";

import type { AppConfig } from "../../config/env.js";
import type { ChatIo } from "../../modules/chat/realtime/chat-gateway.js";
import type { NotificationService } from "../../modules/notifications/application/services/notification-service.js";

const directPayloadSchema = z.object({
  actorId: z.uuid(),
  recipientId: z.uuid(),
  postId: z.uuid().optional(),
  commentId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  followId: z.uuid().optional(),
  interestId: z.uuid().optional(),
  matchId: z.uuid().optional(),
});
const matchPayloadSchema = z.object({
  matchId: z.uuid(),
  userAId: z.uuid(),
  userBId: z.uuid(),
});
const messagePayloadSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  senderId: z.uuid(),
});
const NOTIFICATION_EVENTS = [
  "post.liked",
  "post.commented",
  "comment.replied",
  "comment.liked",
  "user.followed",
  "follow.requested",
  "follow.accepted",
  "interest.received",
  "interest.accepted",
  "match.created",
  "message.created",
];

interface NotificationJob {
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  payload: Prisma.InputJsonObject;
}

export class NotificationOutboxWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly database: PrismaClient,
    private readonly notifications: NotificationService,
    private readonly io: ChatIo,
    private readonly config: AppConfig,
  ) {}

  async start(): Promise<void> {
    if (this.timer) return;
    await this.recoverStaleEvents();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.NOTIFICATION_OUTBOX_POLL_MS);
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
          const jobs = await this.jobsForEvent(event);
          for (const job of jobs) {
            const notification = await this.notifications.createFromEvent({
              sourceEventId: event.id,
              ...job,
            });
            if (notification) {
              this.io
                .to(`user:${job.recipientId}`)
                .emit("notification:new", notification);
            }
          }
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

  private async jobsForEvent(
    event: OutboxEvent,
  ): Promise<NotificationJob[]> {
    if (event.eventType === "match.created") {
      const payload = matchPayloadSchema.parse(event.payload);
      return [
        {
          recipientId: payload.userAId,
          actorId: payload.userBId,
          type: NotificationType.MATCH_CREATED,
          payload: { matchId: payload.matchId },
        },
        {
          recipientId: payload.userBId,
          actorId: payload.userAId,
          type: NotificationType.MATCH_CREATED,
          payload: { matchId: payload.matchId },
        },
      ];
    }
    if (event.eventType === "message.created") {
      const payload = messagePayloadSchema.parse(event.payload);
      const target = await this.notifications.resolveMessageTarget(
        payload.conversationId,
        payload.senderId,
      );
      return target
        ? [
            {
              recipientId: target.recipientId,
              actorId: payload.senderId,
              type: NotificationType.NEW_MESSAGE,
              payload: {
                conversationId: payload.conversationId,
                messageId: payload.messageId,
              },
            },
          ]
        : [];
    }

    const payload = directPayloadSchema.parse(event.payload);
    const type = notificationTypeFor(event.eventType);
    if (!type) return [];
    return [
      {
        recipientId: payload.recipientId,
        actorId: payload.actorId,
        type,
        payload: directNotificationPayload(event.eventType, payload),
      },
    ];
  }

  private claimNextEvent(): Promise<OutboxEvent | null> {
    return this.database.$transaction(
      async (transaction) => {
        const event = await transaction.outboxEvent.findFirst({
          where: {
            eventType: { in: NOTIFICATION_EVENTS },
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
        eventType: { in: NOTIFICATION_EVENTS },
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

function notificationTypeFor(eventType: string): NotificationType | null {
  const mapping: Record<string, NotificationType> = {
    "post.liked": NotificationType.NEW_LIKE,
    "post.commented": NotificationType.NEW_COMMENT,
    "comment.replied": NotificationType.NEW_COMMENT,
    "comment.liked": NotificationType.NEW_LIKE,
    "user.followed": NotificationType.NEW_FOLLOWER,
    "follow.requested": NotificationType.FOLLOW_REQUEST,
    "follow.accepted": NotificationType.SYSTEM,
    "interest.received": NotificationType.INTEREST_RECEIVED,
    "interest.accepted": NotificationType.INTEREST_ACCEPTED,
  };
  return mapping[eventType] ?? null;
}

function directNotificationPayload(
  eventType: string,
  payload: z.infer<typeof directPayloadSchema>,
): Prisma.InputJsonObject {
  return {
    ...(payload.postId ? { postId: payload.postId } : {}),
    ...(payload.commentId ? { commentId: payload.commentId } : {}),
    ...(payload.parentId ? { parentId: payload.parentId } : {}),
    ...(payload.followId ? { followId: payload.followId } : {}),
    ...(payload.interestId ? { interestId: payload.interestId } : {}),
    ...(payload.matchId ? { matchId: payload.matchId } : {}),
    ...(eventType === "follow.accepted"
      ? { code: "FOLLOW_ACCEPTED" }
      : {}),
  };
}
