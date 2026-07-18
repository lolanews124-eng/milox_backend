import type {
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
  deliveryStatus: MessageDeliveryStatus;
  deletedForEveryoneAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  mediaAsset: ChatMediaRecord | null;
}

export interface ConversationViewRecord {
  id: string;
  matchId: string;
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
    matchId: conversation.matchId,
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
