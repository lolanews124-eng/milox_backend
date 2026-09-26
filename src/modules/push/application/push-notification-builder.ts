import { MILOX_OFFICIAL_USERNAME } from "../../official-chat/official-chat-config.js";

interface PushActor {
  username: string;
  displayName: string | null;
}

interface PresentedNotification {
  id: string;
  type: string;
  actor: PushActor | null;
  payload: unknown;
}

export interface PushNotificationMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

export function buildPushNotificationMessage(
  notification: PresentedNotification,
): PushNotificationMessage {
  const actorLabel = actorName(notification.actor);
  const action = notificationAction(notification);
  const payload = asRecord(notification.payload);
  const previewText = readPayloadString(payload, "previewText");
  const isOfficialMessage =
    notification.type === "NEW_MESSAGE" &&
    notification.actor?.username === MILOX_OFFICIAL_USERNAME;

  const title =
    notification.type === "NEW_MESSAGE"
      ? isOfficialMessage
        ? "Milox Official"
        : actorLabel ?? "New message"
      : "Milox";
  const body =
    isOfficialMessage && previewText
      ? previewText
      : actorLabel
        ? `${actorLabel} ${action}`
        : action;

  const data: Record<string, string> = {
    type: notification.type,
    notificationId: notification.id,
    title,
    body,
  };

  const actorUsername = notification.actor?.username;
  if (actorUsername) {
    data.actorUsername = actorUsername;
  }

  const conversationId = payload.conversationId;
  if (typeof conversationId === "string" && conversationId.length > 0) {
    data.conversationId = conversationId;
  }

  return { title, body, data };
}

function actorName(actor: PushActor | null): string | null {
  if (!actor) return null;
  const displayName = actor.displayName?.trim();
  if (displayName) return displayName;
  return actor.username;
}

function notificationAction(notification: PresentedNotification): string {
  const payload = asRecord(notification.payload);

  if (notification.type === "SYSTEM") {
    return switchSystemAction(payload);
  }
  if (
    notification.type === "NEW_LIKE" &&
    typeof payload.commentId === "string"
  ) {
    return "liked your comment";
  }
  if (
    notification.type === "NEW_COMMENT" &&
    typeof payload.parentId === "string"
  ) {
    return "replied to your comment";
  }

  const mapping: Record<string, string> = {
    NEW_LIKE:
      typeof payload.reelId === "string" && typeof payload.commentId !== "string"
        ? "liked your reel"
        : "liked your post",
    NEW_COMMENT:
      typeof payload.reelId === "string" && typeof payload.parentId !== "string"
        ? "commented on your reel"
        : "commented on your post",
    NEW_FOLLOWER: "started following you",
    FOLLOW_REQUEST: "requested to follow you",
    INTEREST_RECEIVED: "sent you an interest",
    INTEREST_ACCEPTED: "accepted your interest",
    MATCH_CREATED: "matched with you",
    NEW_MESSAGE: "sent you a message",
    POST_MENTION:
      typeof payload.reelId === "string" && typeof payload.commentId === "string"
        ? "mentioned you in a comment"
        : typeof payload.reelId === "string"
          ? "mentioned you in a reel"
          : "mentioned you in a post",
  };
  return mapping[notification.type] ?? "sent you an update";
}

function switchSystemAction(payload: Record<string, unknown>): string {
  const code = payload.code;
  if (code === "POST_SHARED") return "shared your post";
  if (code === "REEL_SHARED") return "shared your reel";
  if (code === "FOLLOW_ACCEPTED") return "accepted your follow request";
  if (code === "REEL_REJECTED") {
    const label =
      typeof payload.reasonLabel === "string" && payload.reasonLabel.trim()
        ? payload.reasonLabel.trim()
        : "it breaks the community rules";
    return `Your reel was rejected: ${label}`;
  }
  return "sent you an update";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readPayloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
