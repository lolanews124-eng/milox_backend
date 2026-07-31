import type {
  ConversationKind,
  MessageDeliveryStatus,
  MessageType,
} from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import {
  presentPublicAuthor,
  type PostAuthorViewRecord,
} from "../../posts/application/post-view.js";

export interface ChatMediaRecord {
  id: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  blurHash: string | null;
  createdAt: Date;
}

export interface MessageViewRecord {
  id: string;
  conversationId: string;
  senderId: string;
  replyToId: string | null;
  type: MessageType;
  body: string | null;
  metadata: unknown;
  deliveryStatus: MessageDeliveryStatus;
  deletedForEveryoneAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  mediaAsset: ChatMediaRecord | null;
}

export interface ConversationViewRecord {
  id: string;
  kind: ConversationKind;
  matchId: string | null;
  isOfficial: boolean;
  isReadOnly: boolean;
  peer: PostAuthorViewRecord;
  unreadCount: number;
  isMuted: boolean;
  isPinned: boolean;
  isArchived: boolean;
  updatedAt: Date;
  lastMessage: MessageViewRecord | null;
}

export function presentMessage(
  message: MessageViewRecord,
  config: AppConfig,
): object {
  const deleted = message.deletedForEveryoneAt !== null;
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    type: message.type,
    body: deleted ? null : message.body,
    metadata: deleted ? null : normalizeMessageMetadata(message.metadata),
    media:
      deleted || !message.mediaAsset
        ? null
        : {
            id: message.mediaAsset.id,
            kind: message.mediaAsset.kind,
            url: `${config.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/conversations/${message.conversationId}/media/${message.mediaAsset.id}`,
            mimeType: message.mediaAsset.mimeType,
            width: message.mediaAsset.width,
            height: message.mediaAsset.height,
            blurHash: message.mediaAsset.blurHash,
            createdAt: message.mediaAsset.createdAt.toISOString(),
          },
    replyToId: message.replyToId,
    deliveryStatus: message.deliveryStatus,
    deletedForEveryone: deleted,
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

export function presentConversation(
  conversation: ConversationViewRecord,
  config: AppConfig,
): object {
  return {
    id: conversation.id,
    kind: conversation.kind,
    matchId: conversation.matchId,
    isOfficial: conversation.isOfficial,
    isReadOnly: conversation.isReadOnly,
    peer: presentPublicAuthor(conversation.peer, config),
    lastMessage: conversation.lastMessage
      ? presentMessage(conversation.lastMessage, config)
      : null,
    unreadCount: conversation.unreadCount,
    isMuted: conversation.isMuted,
    isPinned: conversation.isPinned,
    isArchived: conversation.isArchived,
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

function normalizeMessageMetadata(metadata: unknown): object | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const buttons = (metadata as { buttons?: unknown }).buttons;
  if (!Array.isArray(buttons) || buttons.length === 0) return null;
  const normalized = buttons
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const label = (entry as { label?: unknown }).label;
      const action = (entry as { action?: unknown }).action;
      if (typeof label !== "string" || !label.trim()) return null;
      if (!action || typeof action !== "object" || Array.isArray(action)) {
        return null;
      }
      const type = (action as { type?: unknown }).type;
      if (type === "OPEN_URL") {
        const url = (action as { url?: unknown }).url;
        if (typeof url !== "string" || !url.trim()) return null;
        return { label: label.trim(), action: { type, url: url.trim() } };
      }
      if (type === "NAVIGATE") {
        const route = (action as { route?: unknown }).route;
        if (typeof route !== "string" || !route.trim()) return null;
        return {
          label: label.trim(),
          action: { type, route: route.trim() },
        };
      }
      return null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  return normalized.length > 0 ? { buttons: normalized } : null;
}
