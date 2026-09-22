import { createHash } from "node:crypto";
import path from "node:path";

import type { MessageType, PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type { FeedCursorCodec } from "../../../feed/application/services/feed-cursor.js";
import { resolveUserEntitlements } from "../../../premium/application/entitlements.js";
import type {
  ChatRepository,
  DeletedMessage,
  DeliveryReceipt,
  PresenceAudience,
  ReadReceipt,
} from "../ports/chat-repository.js";
import {
  AlreadyMemberError,
  CannotRemoveAdminError,
  ChatActionConflictError,
  ChatIdempotencyConflictError,
  ChatMediaOwnershipError,
  ChatReplyNotFoundError,
  NotGroupAdminError,
  NotGroupError,
  NotMatchedError,
  BroadcastDisabledError,
} from "../ports/chat-repository.js";
import {
  presentConversation,
  presentMessage,
} from "../chat-view.js";
import { presentPublicAuthor } from "../../../posts/application/post-view.js";
import { recordDailyMission } from "../../../rewards/application/daily-engagement.js";

export interface ChatPage {
  items: object[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class ChatService {
  constructor(
    private readonly repository: ChatRepository,
    private readonly cursors: FeedCursorCodec,
    private readonly config: AppConfig,
    private readonly database: PrismaClient,
    private readonly hooks?: { wakeOutbox?: () => void },
  ) {}

  async listConversations(
    userId: string,
    options: {
      filter: "all" | "archived" | "pinned" | "unread" | "groups" | "broadcasts";
      cursor?: string;
      limit: number;
    },
  ): Promise<ChatPage> {
    const cursor = this.decodeCursor(options.cursor, "conversations");
    const rows = await this.repository.listConversations({
      userId,
      filter: options.filter,
      limit: options.limit,
      ...(cursor
        ? {
            before: {
              id: cursor.id,
              updatedAt: new Date(cursor.createdAt),
            },
          }
        : {}),
    });
    return this.page(
      rows,
      options.limit,
      (row) => presentConversation(row, this.config),
      (row) => row.updatedAt,
    );
  }

  async getConversation(
    conversationId: string,
    userId: string,
  ): Promise<object> {
    const conversation = await this.repository.findConversation(
      conversationId,
      userId,
    );
    if (!conversation) throw conversationNotFound();
    return presentConversation(conversation, this.config);
  }

  async startDirectConversation(
    senderId: string,
    recipientId: string,
  ): Promise<object> {
    const entitlements = await resolveUserEntitlements(
      this.database,
      senderId,
      this.config.INTEREST_DAILY_LIMIT,
    );
    if (!entitlements.features.directMessageEnabled) {
      throw new AppError(
        "PREMIUM_REQUIRED",
        "Direct messaging requires Milox Connect or an eligible premium plan",
        403,
      );
    }

    try {
      const conversation = await this.repository.findOrCreateDirectConversation(
        senderId,
        recipientId,
      );
      if (!conversation) {
        throw new AppError("NOT_FOUND", "User not found", 404);
      }
      return presentConversation(conversation, this.config);
    } catch (error) {
      if (
        error instanceof ChatActionConflictError &&
        error.message === "blocked"
      ) {
        throw new AppError(
          "USER_BLOCKED",
          "You cannot message this user",
          403,
        );
      }
      throw error;
    }
  }

  async updateSettings(
    conversationId: string,
    userId: string,
    settings: {
      isMuted?: boolean | undefined;
      isPinned?: boolean | undefined;
      isArchived?: boolean | undefined;
    },
  ): Promise<object> {
    if (Object.keys(settings).length === 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        "At least one setting is required",
        400,
      );
    }
    const conversation = await this.repository.updateSettings(
      conversationId,
      userId,
      settings,
    );
    if (!conversation) throw conversationNotFound();
    return presentConversation(conversation, this.config);
  }

  async leaveConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    try {
      const left = await this.repository.leaveConversation(
        conversationId,
        userId,
      );
      if (!left) throw conversationNotFound();
      this.hooks?.wakeOutbox?.();
    } catch (error) {
      if (
        error instanceof ChatActionConflictError &&
        error.message === "read_only"
      ) {
        throw new AppError(
          "FORBIDDEN",
          "Official conversations cannot be deleted",
          403,
        );
      }
      if (
        error instanceof ChatActionConflictError &&
        error.message === "match_use_unmatch"
      ) {
        throw new AppError(
          "INVALID_ACTION",
          "Use unmatch to delete match conversations",
          409,
        );
      }
      throw error;
    }
  }

  async createGroup(
    creatorId: string,
    input: { title: string; memberIds: string[] },
  ): Promise<object> {
    try {
      const conversation = await this.repository.createGroup({
        creatorId,
        title: input.title,
        memberIds: input.memberIds,
      });
      this.hooks?.wakeOutbox?.();
      return presentConversation(conversation, this.config);
    } catch (error) {
      mapGroupError(error);
    }
  }

  async createBroadcast(
    creatorId: string,
    input: { title: string; memberIds: string[] },
  ): Promise<object> {
    try {
      const conversation = await this.repository.createBroadcast({
        creatorId,
        title: input.title,
        memberIds: input.memberIds,
      });
      this.hooks?.wakeOutbox?.();
      return presentConversation(conversation, this.config);
    } catch (error) {
      mapGroupError(error);
    }
  }

  async addGroupMember(
    conversationId: string,
    actorId: string,
    userId: string,
  ): Promise<object> {
    return this.addGroupMembers(conversationId, actorId, [userId]);
  }

  async addGroupMembers(
    conversationId: string,
    actorId: string,
    userIds: string[],
  ): Promise<object> {
    try {
      const conversation = await this.repository.addGroupMembers({
        conversationId,
        actorId,
        userIds,
      });
      if (!conversation) throw conversationNotFound();
      this.hooks?.wakeOutbox?.();
      return presentConversation(conversation, this.config);
    } catch (error) {
      mapGroupError(error);
    }
  }

  async removeGroupMember(
    conversationId: string,
    actorId: string,
    userId: string,
  ): Promise<object> {
    try {
      const conversation = await this.repository.removeGroupMember({
        conversationId,
        actorId,
        userId,
      });
      if (!conversation) throw conversationNotFound();
      this.hooks?.wakeOutbox?.();
      return presentConversation(conversation, this.config);
    } catch (error) {
      mapGroupError(error);
    }
  }

  async listGroupMembers(
    conversationId: string,
    userId: string,
  ): Promise<object[]> {
    try {
      const members = await this.repository.listGroupMembers(
        conversationId,
        userId,
      );
      if (!members) throw conversationNotFound();
      return members.map((member) => ({
        userId: member.userId,
        role: member.role,
        user: presentPublicAuthor(member.user, this.config),
      }));
    } catch (error) {
      mapGroupError(error);
    }
  }

  async listMessages(
    conversationId: string,
    userId: string,
    options: { cursor?: string; limit: number },
  ): Promise<ChatPage> {
    const cursor = this.decodeCursor(options.cursor, "messages");
    const rows = await this.repository.listMessages({
      conversationId,
      userId,
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
    if (!rows) throw conversationNotFound();
    return this.page(
      rows,
      options.limit,
      (row) => presentMessage(row, this.config),
      (row) => row.createdAt,
    );
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    input: {
      type: Exclude<MessageType, "SYSTEM">;
      body?: string | null | undefined;
      mediaId?: string | null | undefined;
      replyToId?: string | null | undefined;
    },
    idempotencyKey: string,
  ): Promise<{ item: object; replayed: boolean }> {
    const body = normalizeBody(input.body);
    const mediaId = input.mediaId ?? null;
    const replyToId = input.replyToId ?? null;
    if (input.type === "TEXT" && !body) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Text messages require a non-blank body",
        400,
      );
    }
    if (input.type === "TEXT" && mediaId) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Text messages cannot include media",
        400,
      );
    }
    if (input.type === "IMAGE" && !mediaId) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Image messages require mediaId",
        400,
      );
    }

    try {
      const created = await this.repository.sendMessage({
        conversationId,
        senderId,
        type: input.type,
        body,
        mediaId,
        replyToId,
        idempotencyKey,
        requestHash: hashRequest({
          conversationId,
          type: input.type,
          body,
          mediaId,
          replyToId,
        }),
      });
      if (!created) throw conversationNotFound();
      if (!created.replayed) {
        this.hooks?.wakeOutbox?.();
        void recordDailyMission(
          this.database,
          this.config,
          senderId,
          "CHAT",
        ).catch(() => undefined);
      }
      return {
        item: presentMessage(created.message, this.config),
        replayed: created.replayed,
      };
    } catch (error) {
      if (error instanceof ChatActionConflictError) {
        if (error.message === "read_only") {
          throw new AppError(
            "READ_ONLY_CONVERSATION",
            "This conversation cannot receive replies",
            403,
          );
        }
        if (error.message === "group_images_disabled") {
          throw new AppError(
            "GROUP_IMAGES_DISABLED",
            "Images are not allowed in group or broadcast chats",
            400,
          );
        }
      }
      if (error instanceof ChatMediaOwnershipError) {
        throw new AppError(
          "MEDIA_NOT_OWNED",
          "Chat media must be unused and owned by the sender",
          403,
        );
      }
      if (error instanceof ChatReplyNotFoundError) {
        throw new AppError(
          "MESSAGE_NOT_FOUND",
          "Reply target is unavailable",
          404,
        );
      }
      if (error instanceof ChatIdempotencyConflictError) {
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "This idempotency key was used with different input",
          409,
        );
      }
      throw error;
    }
  }

  async markRead(
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ): Promise<ReadReceipt> {
    const receipt = await this.repository.markRead(
      conversationId,
      userId,
      lastReadMessageId,
    );
    if (!receipt) throw conversationNotFound();
    return receipt;
  }

  markDelivered(
    conversationId: string,
    userId: string,
    messageId: string,
  ): Promise<DeliveryReceipt | null> {
    return this.repository.markDelivered(conversationId, userId, messageId);
  }

  async deleteMessage(
    messageId: string,
    userId: string,
    scope: "me" | "everyone",
  ): Promise<DeletedMessage> {
    try {
      const deleted = await this.repository.deleteMessage(
        messageId,
        userId,
        scope,
      );
      if (!deleted) {
        throw new AppError("MESSAGE_NOT_FOUND", "Message not found", 404);
      }
      this.hooks?.wakeOutbox?.();
      return deleted;
    } catch (error) {
      if (
        error instanceof ChatActionConflictError &&
        error.message === "not_sender"
      ) {
        throw new AppError(
          "CANNOT_DELETE_OTHERS_MESSAGE",
          "Only the sender can delete a message for everyone",
          403,
        );
      }
      throw error;
    }
  }

  async editMessage(
    messageId: string,
    userId: string,
    body: string,
  ): Promise<object> {
    const normalized = normalizeBody(body);
    if (!normalized) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Edited text cannot be blank",
        400,
      );
    }
    const edited = await this.repository.editMessage(
      messageId,
      userId,
      normalized,
    );
    if (!edited) {
      throw new AppError(
        "MESSAGE_NOT_FOUND",
        "Message not found or cannot be edited",
        404,
      );
    }
    this.hooks?.wakeOutbox?.();
    return presentMessage(edited, this.config);
  }

  activeConversationIds(userId: string): Promise<string[]> {
    return this.repository.activeConversationIds(userId);
  }

  activeConversationMemberIds(conversationId: string): Promise<string[]> {
    return this.repository.activeConversationMemberIds(conversationId);
  }

  canAccessConversation(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    return this.repository.canAccessConversation(conversationId, userId);
  }

  updatePresence(
    userId: string,
    online: boolean,
  ): Promise<PresenceAudience> {
    return this.repository.updatePresence(userId, online);
  }

  async resolveChatMedia(
    conversationId: string,
    mediaId: string,
    userId: string,
  ): Promise<{
    absolutePath: string;
    mimeType: string;
    checksum: string | null;
  }> {
    const media = await this.repository.resolveChatMedia(
      conversationId,
      mediaId,
      userId,
    );
    if (!media) throw new AppError("MEDIA_NOT_FOUND", "Media not found", 404);
    const uploadRoot = path.resolve(this.config.UPLOAD_ROOT);
    const absolutePath = path.resolve(uploadRoot, media.storageKey);
    if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
      throw new AppError("MEDIA_NOT_FOUND", "Media not found", 404);
    }
    return {
      absolutePath,
      mimeType: media.mimeType,
      checksum: media.checksum,
    };
  }

  async messageForRealtime(messageId: string): Promise<object | null> {
    const message = await this.repository.findMessageForRealtime(messageId);
    return message ? presentMessage(message, this.config) : null;
  }

  private page<T extends { id: string }>(
    rows: T[],
    limit: number,
    present: (row: T) => object,
    timestamp: (row: T) => Date,
  ): ChatPage {
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(present),
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.id,
              createdAt: timestamp(last).toISOString(),
            })
          : null,
      hasMore,
    };
  }

  private decodeCursor(encoded: string | undefined, resource: string) {
    const cursor = encoded ? this.cursors.decode(encoded) : undefined;
    if (cursor && cursor.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        `This cursor cannot be used for ${resource}`,
        400,
      );
    }
    return cursor;
  }
}

function normalizeBody(body: string | null | undefined): string | null {
  const normalized = body?.trim();
  return normalized ? normalized : null;
}

function hashRequest(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function conversationNotFound(): AppError {
  return new AppError(
    "CONVERSATION_NOT_FOUND",
    "Active conversation not found",
    404,
  );
}

function mapGroupError(error: unknown): never {
  if (error instanceof NotMatchedError) {
    throw new AppError(
      "NOT_MATCHED",
      "You can only add users you are matched with",
      403,
    );
  }
  if (error instanceof AlreadyMemberError) {
    throw new AppError(
      "ALREADY_MEMBER",
      "User is already a member of this group",
      409,
    );
  }
  if (error instanceof NotGroupAdminError) {
    throw new AppError(
      "FORBIDDEN",
      "Only group admins can remove members",
      403,
    );
  }
  if (error instanceof CannotRemoveAdminError) {
    throw new AppError(
      "FORBIDDEN",
      "Group admins cannot be removed",
      403,
    );
  }
  if (error instanceof NotGroupError) {
    throw new AppError(
      "FORBIDDEN",
      "This conversation is not a group",
      403,
    );
  }
  if (error instanceof BroadcastDisabledError) {
    throw new AppError(
      "BROADCAST_DISABLED",
      "Broadcast lists require admin approval",
      403,
    );
  }
  if (
    error instanceof ChatActionConflictError &&
    error.message === "invalid_title"
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Title must be between 1 and 80 characters",
      400,
    );
  }
  if (
    error instanceof ChatActionConflictError &&
    error.message === "broadcast_needs_recipients"
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Add at least one recipient to the broadcast list",
      400,
    );
  }
  if (
    error instanceof ChatActionConflictError &&
    error.message === "cannot_remove_self"
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Use leave conversation to remove yourself",
      400,
    );
  }
  throw error;
}
