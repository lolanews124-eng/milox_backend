import {
  ConversationStatus,
  MatchStatus,
  NotificationType,
  Prisma,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";

import type {
  CreateNotificationData,
  MessageNotificationTarget,
  NotificationPageQuery,
  NotificationRepository,
} from "../application/ports/notification-repository.js";
import type { NotificationViewRecord } from "../application/notification-view.js";
import { visibleUserCardWhere } from "../../posts/infrastructure/post-query-policy.js";
import { notificationViewSelect } from "./notification-query-policy.js";

export class PrismaNotificationRepository
  implements NotificationRepository
{
  constructor(private readonly database: PrismaClient) {}

  list(query: NotificationPageQuery): Promise<NotificationViewRecord[]> {
    return this.database.notification.findMany({
      where: {
        recipientId: query.recipientId,
        ...(query.unreadOnly ? { isRead: false } : {}),
        ...(query.excludeTypes?.length
          ? { type: { notIn: query.excludeTypes } }
          : {}),
        ...cursorWhere(query.before),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: notificationViewSelect(),
    });
  }

  unreadCount(
    recipientId: string,
    options?: { excludeTypes?: NotificationType[] },
  ): Promise<number> {
    return this.database.notification.count({
      where: {
        recipientId,
        isRead: false,
        ...(options?.excludeTypes?.length
          ? { type: { notIn: options.excludeTypes } }
          : {}),
      },
    });
  }

  async markRead(
    recipientId: string,
    options: { all: boolean; ids: string[] },
  ): Promise<number> {
    const updated = await this.database.notification.updateMany({
      where: {
        recipientId,
        isRead: false,
        ...(!options.all ? { id: { in: options.ids } } : {}),
      },
      data: { isRead: true, readAt: new Date() },
    });
    return updated.count;
  }

  async create(
    data: CreateNotificationData,
  ): Promise<NotificationViewRecord | null> {
    if (data.actorId === data.recipientId) return null;
    const existing = await this.findBySource(
      data.sourceEventId,
      data.recipientId,
    );
    if (existing) return existing;

    const recipient = await this.database.user.findFirst({
      where: {
        id: data.recipientId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        ...(data.actorId ? visibleUserCardWhere(data.actorId) : {}),
      },
      select: { id: true },
    });
    if (!recipient) return null;
    if (data.actorId) {
      const actor = await this.database.user.findFirst({
        where: {
          id: data.actorId,
          ...visibleUserCardWhere(data.recipientId),
        },
        select: { id: true },
      });
      if (!actor) return null;
    }

    try {
      return await this.database.notification.create({
        data: {
          sourceEventId: data.sourceEventId,
          recipientId: data.recipientId,
          actorId: data.actorId,
          type: data.type,
          payload: data.payload,
        },
        select: notificationViewSelect(),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return this.findBySource(data.sourceEventId, data.recipientId);
      }
      throw error;
    }
  }

  async resolveMessageTarget(
    conversationId: string,
    senderId: string,
  ): Promise<MessageNotificationTarget | null> {
    const conversation = await this.database.conversation.findFirst({
      where: {
        id: conversationId,
        status: ConversationStatus.ACTIVE,
        match: { is: { status: MatchStatus.ACTIVE } },
        members: { some: { userId: senderId, leftAt: null } },
      },
      select: {
        members: {
          where: {
            userId: { not: senderId },
            leftAt: null,
            isMuted: false,
          },
          take: 1,
          select: { userId: true },
        },
      },
    });
    const recipientId = conversation?.members[0]?.userId;
    return recipientId ? { recipientId } : null;
  }

  private findBySource(
    sourceEventId: string,
    recipientId: string,
  ): Promise<NotificationViewRecord | null> {
    return this.database.notification.findUnique({
      where: {
        sourceEventId_recipientId: { sourceEventId, recipientId },
      },
      select: notificationViewSelect(),
    });
  }
}

function cursorWhere(
  before: NotificationPageQuery["before"],
): Prisma.NotificationWhereInput {
  if (!before) return {};
  return {
    OR: [
      { createdAt: { lt: before.createdAt } },
      { createdAt: before.createdAt, id: { lt: before.id } },
    ],
  };
}
