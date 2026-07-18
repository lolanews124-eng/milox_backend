import type {
  NotificationType,
  Prisma,
} from "@prisma/client";

import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type { FeedCursorCodec } from "../../../feed/application/services/feed-cursor.js";
import type {
  NotificationRepository,
} from "../ports/notification-repository.js";
import {
  presentNotification,
} from "../notification-view.js";

export interface NotificationPage {
  items: object[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly cursors: FeedCursorCodec,
    private readonly config: AppConfig,
  ) {}

  async list(
    recipientId: string,
    options: { unreadOnly: boolean; cursor?: string; limit: number },
  ): Promise<NotificationPage> {
    const cursor = options.cursor
      ? this.cursors.decode(options.cursor)
      : undefined;
    if (cursor && cursor.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "This cursor cannot be used for notifications",
        400,
      );
    }
    const rows = await this.repository.list({
      recipientId,
      unreadOnly: options.unreadOnly,
      limit: options.limit,
      ...(cursor
        ? {
            before: {
              id: cursor.id,
              createdAt: new Date(cursor.createdAt),
            },
          }
        : {}),
    });
    const hasMore = rows.length > options.limit;
    const pageRows = rows.slice(0, options.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) =>
        presentNotification(row, this.config),
      ),
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.id,
              createdAt: last.createdAt.toISOString(),
            })
          : null,
      hasMore,
    };
  }

  async unreadCount(recipientId: string): Promise<object> {
    return { count: await this.repository.unreadCount(recipientId) };
  }

  async markRead(
    recipientId: string,
    options: { all: boolean; ids: string[] },
  ): Promise<void> {
    if (
      (options.all && options.ids.length > 0) ||
      (!options.all && options.ids.length === 0)
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Choose either all=true or one or more notification IDs",
        400,
      );
    }
    await this.repository.markRead(recipientId, options);
  }

  async createFromEvent(data: {
    sourceEventId: string;
    recipientId: string;
    actorId: string | null;
    type: NotificationType;
    payload: Prisma.InputJsonObject;
  }): Promise<object | null> {
    const notification = await this.repository.create(data);
    return notification
      ? presentNotification(notification, this.config)
      : null;
  }

  resolveMessageTarget(
    conversationId: string,
    senderId: string,
  ): ReturnType<NotificationRepository["resolveMessageTarget"]> {
    return this.repository.resolveMessageTarget(conversationId, senderId);
  }
}
