import {
  ConversationStatus,
  MatchStatus,
  MediaKind,
  MediaVisibility,
  MessageDeliveryStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import type {
  ChatRepository,
  ConversationPageQuery,
  CreatedMessage,
  DeletedMessage,
  DeliveryReceipt,
  MessagePageQuery,
  PresenceAudience,
  ReadReceipt,
  ResolvedChatMedia,
  SendMessageData,
} from "../application/ports/chat-repository.js";
import {
  ChatActionConflictError,
  ChatIdempotencyConflictError,
  ChatMediaOwnershipError,
  ChatReplyNotFoundError,
} from "../application/ports/chat-repository.js";
import type {
  ConversationViewRecord,
  MessageViewRecord,
} from "../application/chat-view.js";
import { visibleUserCardWhere } from "../../posts/infrastructure/post-query-policy.js";
import {
  conversationViewSelect,
  messageViewSelect,
} from "./chat-query-policy.js";

const CREATE_SCOPE = "messages.create";

export class PrismaChatRepository implements ChatRepository {
  constructor(private readonly database: PrismaClient) {}

  async listConversations(
    query: ConversationPageQuery,
  ): Promise<ConversationViewRecord[]> {
    const rows = await this.database.conversation.findMany({
      where: {
        ...activeConversationWhere(query.userId),
        members: {
          some: {
            userId: query.userId,
            leftAt: null,
            ...(query.filter === "archived"
              ? { isArchived: true }
              : query.filter === "pinned"
                ? { isPinned: true, isArchived: false }
                : { isArchived: false }),
          },
        },
        ...conversationCursorWhere(query.before),
      },
      orderBy: [
        { updatedAt: "desc" },
        { id: "desc" },
      ],
      take: query.limit + 1,
      select: conversationViewSelect(query.userId),
    });
    return rows.map((row) => mapConversation(row, query.userId));
  }

  async findConversation(
    conversationId: string,
    userId: string,
  ): Promise<ConversationViewRecord | null> {
    const row = await this.database.conversation.findFirst({
      where: activeConversationWhere(userId, conversationId),
      select: conversationViewSelect(userId),
    });
    return row ? mapConversation(row, userId) : null;
  }

  async updateSettings(
    conversationId: string,
    userId: string,
    settings: {
      isMuted?: boolean | undefined;
      isPinned?: boolean | undefined;
      isArchived?: boolean | undefined;
    },
  ): Promise<ConversationViewRecord | null> {
    const accessible = await this.canAccessConversation(
      conversationId,
      userId,
    );
    if (!accessible) return null;
    const data = {
      ...(settings.isMuted !== undefined
        ? { isMuted: settings.isMuted }
        : {}),
      ...(settings.isPinned !== undefined
        ? { isPinned: settings.isPinned }
        : {}),
      ...(settings.isArchived !== undefined
        ? { isArchived: settings.isArchived }
        : {}),
    };
    const updated = await this.database.conversationMember.updateMany({
      where: { conversationId, userId, leftAt: null },
      data,
    });
    if (updated.count === 0) return null;
    return this.findConversation(conversationId, userId);
  }

  async listMessages(
    query: MessagePageQuery,
  ): Promise<MessageViewRecord[] | null> {
    if (
      !(await this.canAccessConversation(query.conversationId, query.userId))
    ) {
      return null;
    }
    return this.database.message.findMany({
      where: {
        conversationId: query.conversationId,
        deletions: { none: { userId: query.userId } },
        ...messageCursorWhere(query.before),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: messageViewSelect(),
    });
  }

  async sendMessage(
    data: SendMessageData,
  ): Promise<CreatedMessage | null> {
    const replay = await this.findReplay(data);
    if (replay) return replay;

    try {
      const message = await this.database.$transaction(async (transaction) => {
        const conversation = await transaction.conversation.findFirst({
          where: activeConversationWhere(
            data.senderId,
            data.conversationId,
          ),
          select: { id: true },
        });
        if (!conversation) return null;

        if (data.mediaId) {
          const media = await transaction.mediaAsset.findFirst({
            where: {
              id: data.mediaId,
              ownerUserId: data.senderId,
              kind: MediaKind.CHAT_IMAGE,
              visibility: MediaVisibility.MATCH_ONLY,
              deletedAt: null,
              messages: { none: {} },
            },
            select: { id: true },
          });
          if (!media) throw new ChatMediaOwnershipError();
        }
        if (data.replyToId) {
          const reply = await transaction.message.findFirst({
            where: {
              id: data.replyToId,
              conversationId: data.conversationId,
              deletedForEveryoneAt: null,
            },
            select: { id: true },
          });
          if (!reply) throw new ChatReplyNotFoundError();
        }

        const created = await transaction.message.create({
          data: {
            conversationId: data.conversationId,
            senderId: data.senderId,
            type: data.type,
            body: data.body,
            ...(data.mediaId ? { mediaAssetId: data.mediaId } : {}),
            ...(data.replyToId ? { replyToId: data.replyToId } : {}),
          },
          select: messageViewSelect(),
        });
        await transaction.conversation.update({
          where: { id: data.conversationId },
          data: { updatedAt: created.createdAt },
        });
        await transaction.conversationMember.updateMany({
          where: {
            conversationId: data.conversationId,
            userId: { not: data.senderId },
            leftAt: null,
          },
          data: {
            unreadCount: { increment: 1 },
            isArchived: false,
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            userId: data.senderId,
            scope: CREATE_SCOPE,
            key: data.idempotencyKey,
            requestHash: data.requestHash,
            resourceType: "message",
            resourceId: created.id,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        const eventPayload = {
          messageId: created.id,
          conversationId: data.conversationId,
          senderId: data.senderId,
        };
        await transaction.outboxEvent.createMany({
          data: [
            {
              eventType: "chat.message.created",
              aggregateType: "message",
              aggregateId: created.id,
              payload: eventPayload,
            },
            {
              eventType: "message.created",
              aggregateType: "message",
              aggregateId: created.id,
              payload: eventPayload,
            },
          ],
        });
        return created;
      });
      return message ? { message, replayed: false } : null;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrentReplay = await this.findReplay(data);
        if (concurrentReplay) return concurrentReplay;
        if (data.mediaId) throw new ChatMediaOwnershipError();
      }
      throw error;
    }
  }

  markRead(
    conversationId: string,
    userId: string,
    lastReadMessageId: string,
  ): Promise<ReadReceipt | null> {
    return this.database.$transaction(async (transaction) => {
      const member = await transaction.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
          leftAt: null,
          conversation: { is: activeConversationWhere(userId, conversationId) },
        },
        select: {
          id: true,
          lastReadMessage: { select: { id: true, createdAt: true } },
        },
      });
      if (!member) return null;
      const target = await transaction.message.findFirst({
        where: { id: lastReadMessageId, conversationId },
        select: { id: true, createdAt: true },
      });
      if (!target) return null;
      if (
        member.lastReadMessage &&
        member.lastReadMessage.createdAt > target.createdAt
      ) {
        return {
          conversationId,
          lastReadMessageId: member.lastReadMessage.id,
          at: new Date(),
        };
      }

      const unreadCount = await transaction.message.count({
        where: {
          conversationId,
          senderId: { not: userId },
          createdAt: { gt: target.createdAt },
          deletions: { none: { userId } },
        },
      });
      const at = new Date();
      await transaction.conversationMember.update({
        where: { id: member.id },
        data: { lastReadMessageId: target.id, unreadCount },
      });
      await transaction.message.updateMany({
        where: {
          conversationId,
          senderId: { not: userId },
          createdAt: { lte: target.createdAt },
          deliveryStatus: {
            in: [
              MessageDeliveryStatus.SENT,
              MessageDeliveryStatus.DELIVERED,
            ],
          },
        },
        data: {
          deliveryStatus: MessageDeliveryStatus.SEEN,
          seenAt: at,
          deliveredAt: at,
        },
      });
      return {
        conversationId,
        lastReadMessageId: target.id,
        at,
      };
    });
  }

  markDelivered(
    conversationId: string,
    userId: string,
    messageId: string,
  ): Promise<DeliveryReceipt | null> {
    return this.database.$transaction(async (transaction) => {
      const message = await transaction.message.findFirst({
        where: {
          id: messageId,
          conversationId,
          senderId: { not: userId },
          conversation: { is: activeConversationWhere(userId, conversationId) },
        },
        select: {
          id: true,
          conversationId: true,
          deliveredAt: true,
          deliveryStatus: true,
        },
      });
      if (!message) return null;
      const at = message.deliveredAt ?? new Date();
      if (message.deliveryStatus === MessageDeliveryStatus.SENT) {
        await transaction.message.update({
          where: { id: message.id },
          data: {
            deliveryStatus: MessageDeliveryStatus.DELIVERED,
            deliveredAt: at,
          },
        });
      }
      return { conversationId, messageId: message.id, at };
    });
  }

  deleteMessage(
    messageId: string,
    userId: string,
    scope: "me" | "everyone",
  ): Promise<DeletedMessage | null> {
    return this.database.$transaction(async (transaction) => {
      const message = await transaction.message.findFirst({
        where: {
          id: messageId,
          conversation: { is: activeConversationWhere(userId) },
        },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          mediaAssetId: true,
          deletedForEveryoneAt: true,
        },
      });
      if (!message) return null;
      if (scope === "everyone") {
        if (message.senderId !== userId) {
          throw new ChatActionConflictError("not_sender");
        }
        if (!message.deletedForEveryoneAt) {
          const deletedAt = new Date();
          await transaction.message.update({
            where: { id: message.id },
            data: {
              body: null,
              mediaAssetId: null,
              deletedForEveryoneAt: deletedAt,
            },
          });
          if (message.mediaAssetId) {
            await transaction.mediaAsset.update({
              where: { id: message.mediaAssetId },
              data: { deletedAt },
            });
          }
        }
      } else {
        await transaction.messageDeletion.upsert({
          where: {
            messageId_userId: { messageId: message.id, userId },
          },
          create: { messageId: message.id, userId },
          update: {},
        });
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: "chat.message.deleted",
          aggregateType: "message",
          aggregateId: message.id,
          payload: {
            messageId: message.id,
            conversationId: message.conversationId,
            actorId: userId,
            scope,
          },
        },
      });
      return {
        conversationId: message.conversationId,
        messageId: message.id,
        scope,
      };
    });
  }

  editMessage(
    messageId: string,
    userId: string,
    body: string,
  ): Promise<MessageViewRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const message = await transaction.message.findFirst({
        where: {
          id: messageId,
          senderId: userId,
          type: "TEXT",
          deletedForEveryoneAt: null,
          conversation: { is: activeConversationWhere(userId) },
        },
        select: { id: true, conversationId: true, body: true },
      });
      if (!message) return null;
      if (message.body === body) {
        return transaction.message.findUnique({
          where: { id: message.id },
          select: messageViewSelect(),
        });
      }
      const editedAt = new Date();
      await transaction.message.update({
        where: { id: message.id },
        data: { body, editedAt },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: "chat.message.edited",
          aggregateType: "message",
          aggregateId: message.id,
          payload: {
            messageId: message.id,
            conversationId: message.conversationId,
            actorId: userId,
          },
        },
      });
      return transaction.message.findUnique({
        where: { id: message.id },
        select: messageViewSelect(),
      });
    });
  }

  async activeConversationIds(userId: string): Promise<string[]> {
    const rows = await this.database.conversation.findMany({
      where: activeConversationWhere(userId),
      select: { id: true },
    });
    return rows.map(({ id }) => id);
  }

  async activeConversationMemberIds(
    conversationId: string,
  ): Promise<string[]> {
    const conversation = await this.database.conversation.findFirst({
      where: {
        id: conversationId,
        status: ConversationStatus.ACTIVE,
        match: { is: { status: MatchStatus.ACTIVE } },
      },
      select: {
        members: {
          where: { leftAt: null },
          select: { userId: true },
        },
      },
    });
    return conversation?.members.map(({ userId }) => userId) ?? [];
  }

  async canAccessConversation(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const conversation = await this.database.conversation.findFirst({
      where: activeConversationWhere(userId, conversationId),
      select: { id: true },
    });
    return Boolean(conversation);
  }

  async updatePresence(
    userId: string,
    online: boolean,
  ): Promise<PresenceAudience> {
    const now = new Date();
    const user = await this.database.user.update({
      where: { id: userId },
      data: online ? {} : { lastSeenAt: now },
      select: {
        hideOnline: true,
        hideLastSeen: true,
        matchesAsUserA: {
          where: {
            status: MatchStatus.ACTIVE,
            userB: { is: visibleUserCardWhere(userId) },
          },
          select: { userBId: true },
        },
        matchesAsUserB: {
          where: {
            status: MatchStatus.ACTIVE,
            userA: { is: visibleUserCardWhere(userId) },
          },
          select: { userAId: true },
        },
      },
    });
    const recipientIds = [
      ...user.matchesAsUserA.map(({ userBId }) => userBId),
      ...user.matchesAsUserB.map(({ userAId }) => userAId),
    ];
    return {
      recipientIds,
      payload: user.hideOnline
        ? null
        : {
            userId,
            online,
            ...(!online && !user.hideLastSeen
              ? { lastSeenAt: now.toISOString() }
              : {}),
          },
    };
  }

  async resolveChatMedia(
    conversationId: string,
    mediaId: string,
    userId: string,
  ): Promise<ResolvedChatMedia | null> {
    const message = await this.database.message.findFirst({
      where: {
        conversationId,
        mediaAssetId: mediaId,
        deletedForEveryoneAt: null,
        conversation: { is: activeConversationWhere(userId, conversationId) },
        mediaAsset: {
          is: {
            kind: MediaKind.CHAT_IMAGE,
            visibility: MediaVisibility.MATCH_ONLY,
            deletedAt: null,
          },
        },
      },
      select: {
        mediaAsset: {
          select: {
            storageKey: true,
            mimeType: true,
            checksumSha256: true,
          },
        },
      },
    });
    return message?.mediaAsset
      ? {
          storageKey: message.mediaAsset.storageKey,
          mimeType: message.mediaAsset.mimeType,
          checksum: message.mediaAsset.checksumSha256,
        }
      : null;
  }

  findMessageForRealtime(
    messageId: string,
  ): Promise<MessageViewRecord | null> {
    return this.database.message.findUnique({
      where: { id: messageId },
      select: messageViewSelect(),
    });
  }

  private async findReplay(
    data: SendMessageData,
  ): Promise<CreatedMessage | null> {
    const record = await this.database.idempotencyRecord.findUnique({
      where: {
        userId_scope_key: {
          userId: data.senderId,
          scope: CREATE_SCOPE,
          key: data.idempotencyKey,
        },
      },
      select: { requestHash: true, resourceId: true },
    });
    if (!record) return null;
    if (record.requestHash !== data.requestHash || !record.resourceId) {
      throw new ChatIdempotencyConflictError();
    }
    const message = await this.database.message.findUnique({
      where: { id: record.resourceId },
      select: messageViewSelect(),
    });
    if (!message) throw new ChatIdempotencyConflictError();
    return { message, replayed: true };
  }
}

function activeConversationWhere(
  userId: string,
  conversationId?: string,
): Prisma.ConversationWhereInput {
  return {
    ...(conversationId ? { id: conversationId } : {}),
    status: ConversationStatus.ACTIVE,
    members: { some: { userId, leftAt: null } },
    match: {
      is: {
        status: MatchStatus.ACTIVE,
        OR: [
          {
            userAId: userId,
            userB: { is: visibleUserCardWhere(userId) },
          },
          {
            userBId: userId,
            userA: { is: visibleUserCardWhere(userId) },
          },
        ],
      },
    },
  };
}

function conversationCursorWhere(
  before: ConversationPageQuery["before"],
): Prisma.ConversationWhereInput {
  if (!before) return {};
  return {
    OR: [
      { updatedAt: { lt: before.updatedAt } },
      { updatedAt: before.updatedAt, id: { lt: before.id } },
    ],
  };
}

function messageCursorWhere(
  before: MessagePageQuery["before"],
): Prisma.MessageWhereInput {
  if (!before) return {};
  return {
    OR: [
      { createdAt: { lt: before.createdAt } },
      { createdAt: before.createdAt, id: { lt: before.id } },
    ],
  };
}

type ConversationRow = Prisma.ConversationGetPayload<{
  select: ReturnType<typeof conversationViewSelect>;
}>;

function mapConversation(
  row: ConversationRow,
  userId: string,
): ConversationViewRecord {
  const member = row.members[0];
  if (!member) throw new Error("Conversation member projection is missing");
  return {
    id: row.id,
    matchId: row.matchId,
    peer: row.match.userAId === userId ? row.match.userB : row.match.userA,
    unreadCount: member.unreadCount,
    isMuted: member.isMuted,
    isPinned: member.isPinned,
    isArchived: member.isArchived,
    updatedAt: row.updatedAt,
    lastMessage: row.messages[0] ?? null,
  };
}
