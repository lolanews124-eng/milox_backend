import type { NotificationType, Prisma } from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import {
  presentPublicAuthor,
  type PostAuthorViewRecord,
} from "../../posts/application/post-view.js";

export interface NotificationViewRecord {
  id: string;
  type: NotificationType;
  payload: Prisma.JsonValue;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  actor: PostAuthorViewRecord | null;
}

export function presentNotification(
  notification: NotificationViewRecord,
  config: AppConfig,
): object {
  return {
    id: notification.id,
    type: notification.type,
    actor: notification.actor
      ? presentPublicAuthor(notification.actor, config)
      : null,
    payload: notification.payload,
    isRead: notification.isRead,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}
