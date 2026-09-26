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
import type { PushSender } from "../../modules/push/application/services/fcm-push-sender.js";
import { claimNextOutboxEvent } from "../../shared/claim-outbox-event.js";

const directPayloadSchema = z.object({
  actorId: z.uuid(),
  recipientId: z.uuid(),
  postId: z.uuid().optional(),
  commentId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  followId: z.uuid().optional(),
  interestId: z.uuid().optional(),
  matchId: z.uuid().optional(),
  reelId: z.uuid().optional(),
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
  previewText: z.string().optional(),
});
const reelRejectedPayloadSchema = z.object({
  recipientId: z.uuid(),
  reelId: z.uuid(),
  reason: z.string().min(1).max(64),
  reasonLabel: z.string().min(1).max(160),
});
const NOTIFICATION_EVENTS = [
  "post.liked",
  "post.shared",
  "post.commented",
  "post.mentioned",
  "comment.replied",
  "comment.liked",
  "user.followed",
  "follow.requested",
  "follow.accepted",
  "interest.received",
  "interest.accepted",
  "match.created",
  "message.created",
  "reel.rejected",
  "reel.mentioned",
  "reel.liked",
  "reel.shared",
  "reel.commented",
  "reel.comment.replied",
  "reel.comment.liked",
  "reel.comment.mentioned",
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
  private pendingWake = false;

  constructor(
    private readonly database: PrismaClient,
    private readonly notifications: NotificationService,
    private readonly io: ChatIo,
    private readonly config: AppConfig,
    private readonly push?: PushSender,
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

  wake(): void {
    if (this.running) {
      this.pendingWake = true;
      return;
    }
    void this.tick();
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.pendingWake = true;
      return;
    }
    this.running = true;
    try {
      for (let processed = 0; processed < 100; processed += 1) {
        let event: OutboxEvent | null;
        try {
          event = await this.claimNextEvent();
        } catch (error) {
          console.warn(
            "Notification outbox claim deferred",
            error instanceof Error ? error.message : error,
          );
          return;
        }
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
              if (this.push?.isEnabled()) {
                void this.push
                  .sendForNotification(job.recipientId, notification)
                  .catch((error) => {
                    console.error("Failed to send push notification", error);
                  });
              }
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
      if (this.pendingWake) {
        this.pendingWake = false;
        void this.tick();
      }
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
    if (event.eventType === "reel.rejected") {
      const payload = reelRejectedPayloadSchema.parse(event.payload);
      return [
        {
          recipientId: payload.recipientId,
          actorId: null,
          type: NotificationType.SYSTEM,
          payload: {
            code: "REEL_REJECTED",
            reelId: payload.reelId,
            reason: payload.reason,
            reasonLabel: payload.reasonLabel,
          },
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
                ...(payload.previewText
                  ? { previewText: payload.previewText }
                  : {}),
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
    return claimNextOutboxEvent(this.database, NOTIFICATION_EVENTS);
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
    "post.shared": NotificationType.SYSTEM,
    "post.commented": NotificationType.NEW_COMMENT,
    "post.mentioned": NotificationType.POST_MENTION,
    "reel.mentioned": NotificationType.POST_MENTION,
    "reel.liked": NotificationType.NEW_LIKE,
    "reel.shared": NotificationType.SYSTEM,
    "reel.commented": NotificationType.NEW_COMMENT,
    "reel.comment.replied": NotificationType.NEW_COMMENT,
    "reel.comment.liked": NotificationType.NEW_LIKE,
    "reel.comment.mentioned": NotificationType.POST_MENTION,
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
    ...(payload.reelId ? { reelId: payload.reelId } : {}),
    ...(eventType === "follow.accepted"
      ? { code: "FOLLOW_ACCEPTED" }
      : {}),
    ...(eventType === "post.shared" ? { code: "POST_SHARED" } : {}),
    ...(eventType === "reel.shared" ? { code: "REEL_SHARED" } : {}),
  };
}
