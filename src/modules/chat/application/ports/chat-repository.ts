import type { ConversationMemberRole, MessageType } from "@prisma/client";

import type { PostAuthorViewRecord } from "../../../posts/application/post-view.js";
import type {
  ConversationViewRecord,
  MessageViewRecord,
} from "../chat-view.js";

export interface ConversationPageQuery {
  userId: string;
  filter: "all" | "archived" | "pinned";
  limit: number;
  before?: { id: string; updatedAt: Date };
}

export interface MessagePageQuery {
  conversationId: string;
  userId: string;
  limit: number;
  before?: { id: string; createdAt: Date };
}

export interface SendMessageData {
  conversationId: string;
  senderId: string;
  type: Exclude<MessageType, "SYSTEM">;
  body: string | null;
  mediaId: string | null;
  replyToId: string | null;
  idempotencyKey: string;
  requestHash: string;
  /** @deprecated Messaging is free; quota is no longer enforced. */
  messagingQuota?: {
    freeLimit: number;
    hasUnlimited: boolean;
  };
}

export interface CreatedMessage {
  message: MessageViewRecord;
  replayed: boolean;
}

export interface ReadReceipt {
  conversationId: string;
  lastReadMessageId: string;
  at: Date;
}

export interface DeliveryReceipt {
  conversationId: string;
  messageId: string;
  at: Date;
}

export interface DeletedMessage {
  conversationId: string;
  messageId: string;
  scope: "me" | "everyone";
}

export interface PresenceAudience {
  recipientIds: string[];
  payload: {
    userId: string;
    online: boolean;
    lastSeenAt?: string;
  } | null;
}

export interface ResolvedChatMedia {
  storageKey: string;
  mimeType: string;
  checksum: string | null;
}

export interface GroupMemberRecord {
  userId: string;
  role: ConversationMemberRole;
  user: PostAuthorViewRecord;
}

export interface ChatRepository {
  listConversations(query: ConversationPageQuery): Promise<ConversationViewRecord[]>;
  findConversation(
    conversationId: string,
    userId: string,
  ): Promise<ConversationViewRecord | null>;
  updateSettings(
    conversationId: string,
    userId: string,
    settings: {
      isMuted?: boolean | undefined;
      isPinned?: boolean | undefined;
      isArchived?: boolean | undefined;
    },
  ): Promise<ConversationViewRecord | null>;
  listMessages(query: MessagePageQuery): Promise<MessageViewRecord[] | null>;
  sendMessage(data: SendMessageData): Promise<CreatedMessage | null>;
  markRead(
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ): Promise<ReadReceipt | null>;
  markDelivered(
    conversationId: string,
    userId: string,
    messageId: string,
  ): Promise<DeliveryReceipt | null>;
  deleteMessage(
    messageId: string,
    userId: string,
    scope: "me" | "everyone",
  ): Promise<DeletedMessage | null>;
  editMessage(
    messageId: string,
    userId: string,
    body: string,
  ): Promise<MessageViewRecord | null>;
  activeConversationIds(userId: string): Promise<string[]>;
  activeConversationMemberIds(conversationId: string): Promise<string[]>;
  canAccessConversation(
    conversationId: string,
    userId: string,
  ): Promise<boolean>;
  updatePresence(userId: string, online: boolean): Promise<PresenceAudience>;
  resolveChatMedia(
    conversationId: string,
    mediaId: string,
    userId: string,
  ): Promise<ResolvedChatMedia | null>;
  findMessageForRealtime(messageId: string): Promise<MessageViewRecord | null>;
  findOrCreateDirectConversation(
    senderId: string,
    recipientId: string,
  ): Promise<ConversationViewRecord | null>;
  leaveConversation(conversationId: string, userId: string): Promise<boolean>;
  createGroup(input: {
    creatorId: string;
    title: string;
    memberIds: string[];
  }): Promise<ConversationViewRecord>;
  createBroadcast(input: {
    creatorId: string;
    title: string;
    memberIds: string[];
  }): Promise<ConversationViewRecord>;
  addGroupMember(input: {
    conversationId: string;
    actorId: string;
    userId: string;
  }): Promise<ConversationViewRecord | null>;
  addGroupMembers(input: {
    conversationId: string;
    actorId: string;
    userIds: string[];
  }): Promise<ConversationViewRecord | null>;
  removeGroupMember(input: {
    conversationId: string;
    actorId: string;
    userId: string;
  }): Promise<ConversationViewRecord | null>;
  listGroupMembers(
    conversationId: string,
    userId: string,
  ): Promise<GroupMemberRecord[] | null>;
}

export class ChatMediaOwnershipError extends Error {}
export class ChatReplyNotFoundError extends Error {}
export class ChatActionConflictError extends Error {}
export class ChatIdempotencyConflictError extends Error {}
export class MessageLimitReachedError extends Error {}
export class NotMatchedError extends Error {}
export class AlreadyMemberError extends Error {}
export class NotGroupAdminError extends Error {}
export class NotGroupError extends Error {}
export class CannotRemoveAdminError extends Error {}
export class BroadcastDisabledError extends Error {}
