import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import type { NotificationViewRecord } from "./notification-view.js";

export interface NotificationPreview {
  kind: "post" | "profile";
  postId?: string;
  username?: string;
  imageUrl: string | null;
}

export async function buildNotificationPreviews(
  notifications: NotificationViewRecord[],
  database: PrismaClient,
  config: AppConfig,
): Promise<Map<string, NotificationPreview | null>> {
  const result = new Map<string, NotificationPreview | null>();
  const postIds = new Set<string>();

  for (const notification of notifications) {
    const postId = readPayloadString(notification.payload, "postId");
    if (postId) postIds.add(postId);
  }

  const postImages = postIds.size
    ? await loadPostPreviewImages([...postIds], database, config)
    : new Map<string, string | null>();

  for (const notification of notifications) {
    result.set(
      notification.id,
      previewForNotification(notification, postImages, config),
    );
  }

  return result;
}

function previewForNotification(
  notification: NotificationViewRecord,
  postImages: Map<string, string | null>,
  config: AppConfig,
): NotificationPreview | null {
  const postId = readPayloadString(notification.payload, "postId");

  if (postId) {
    return {
      kind: "post",
      postId,
      imageUrl: postImages.get(postId) ?? null,
    };
  }

  if (
    notification.actor &&
    (
      notification.type === "MATCH_CREATED" ||
      notification.type === "INTEREST_RECEIVED" ||
      notification.type === "INTEREST_ACCEPTED" ||
      notification.type === "NEW_FOLLOWER" ||
      notification.type === "FOLLOW_REQUEST"
    )
  ) {
    return {
      kind: "profile",
      username: notification.actor.username,
      imageUrl: mediaUrl(notification.actor.profilePhoto?.id, config),
    };
  }

  return null;
}

async function loadPostPreviewImages(
  postIds: string[],
  database: PrismaClient,
  config: AppConfig,
): Promise<Map<string, string | null>> {
  const rows = await database.post.findMany({
    where: { id: { in: postIds }, deletedAt: null, isHidden: false },
    select: {
      id: true,
      media: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: {
          mediaAsset: {
            select: { id: true },
          },
        },
      },
      author: {
        select: {
          profilePhoto: { select: { id: true } },
        },
      },
    },
  });

  const map = new Map<string, string | null>();
  for (const row of rows) {
    const mediaId = row.media[0]?.mediaAsset.id;
    const fallbackPhotoId = row.author.profilePhoto?.id;
    map.set(row.id, mediaUrl(mediaId ?? fallbackPhotoId, config));
  }
  return map;
}

function readPayloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mediaUrl(mediaId: string | undefined, config: AppConfig): string | null {
  if (!mediaId) return null;
  return `${config.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/media/${mediaId}`;
}
