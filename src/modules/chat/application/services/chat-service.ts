import { createHash } from "node:crypto";
import path from "node:path";

import type { MessageType } from "@prisma/client";

import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type { FeedCursorCodec } from "../../../feed/application/services/feed-cursor.js";
import type {
  ChatRepository,
  DeletedMessage,
  DeliveryReceipt,
  PresenceAudience,
  ReadReceipt,
} from "../ports/chat-repository.js";
import {
  ChatActionConflictError,
  ChatIdempotencyConflictError,
  ChatMediaOwnershipError,
  ChatReplyNotFoundError,
} from "../ports/chat-repository.js";
import {
  presentConversation,
  presentMessage,
} from "../chat-view.js";

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
    private readonly hooks?: { wakeOutbox?: () => void },
  ) {}

  async listConversations(
    userId: string,
    options: {
      filter: "all" | "archived" | "pinned";
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
      }
      return {
        item: presentMessage(created.message, this.config),
        replayed: created.replayed,
      };
    } catch (error) {
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
