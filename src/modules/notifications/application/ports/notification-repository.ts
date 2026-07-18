import type { NotificationType, Prisma } from "@prisma/client";

import type { NotificationViewRecord } from "../notification-view.js";

export interface NotificationPageQuery {
  recipientId: string;
  unreadOnly: boolean;
  limit: number;
  before?: { id: string; createdAt: Date };
}

export interface CreateNotificationData {
  sourceEventId: string;
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  payload: Prisma.InputJsonObject;
}

export interface MessageNotificationTarget {
  recipientId: string;
}

export interface NotificationRepository {
  list(query: NotificationPageQuery): Promise<NotificationViewRecord[]>;
  unreadCount(recipientId: string): Promise<number>;
  markRead(
    recipientId: string,
    options: { all: boolean; ids: string[] },
  ): Promise<number>;
  create(
    data: CreateNotificationData,
  ): Promise<NotificationViewRecord | null>;
  resolveMessageTarget(
    conversationId: string,
    senderId: string,
  ): Promise<MessageNotificationTarget | null>;
}
