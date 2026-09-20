import {
  ConversationKind,
  ConversationMemberRole,
  ConversationStatus,
  MatchStatus,
  MediaKind,
  MediaVisibility,
  MessageDeliveryStatus,
  MessageType,
  Prisma,
  UserStatus,
  type PrismaClient,
  AgeRange,
  Gender,
} from "@prisma/client";

import type {
  ChatRepository,
  ConversationPageQuery,
  CreatedMessage,
  DeletedMessage,
  DeliveryReceipt,
  GroupMemberRecord,
  MessagePageQuery,
  PresenceAudience,
  ReadReceipt,
  ResolvedChatMedia,
  SendMessageData,
} from "../application/ports/chat-repository.js";
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
} from "../application/ports/chat-repository.js";
import type { PostAuthorViewRecord } from "../../posts/application/post-view.js";
import type {
  ConversationViewRecord,
  MessageViewRecord,
} from "../application/chat-view.js";
import {
  MILOX_OFFICIAL_AVATAR_MEDIA_ID,
  MILOX_OFFICIAL_DISPLAY_NAME,
  MILOX_OFFICIAL_USERNAME,
} from "../../official-chat/official-chat-config.js";
import {
  publicAuthorSelect,
  visibleUserCardWhere,
} from "../../posts/infrastructure/post-query-policy.js";
import {
  conversationViewSelect,
  messageViewSelect,
  activeConversationWhere,
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
      let fanOutBody: string | null = null;
      const message = await this.database.$transaction(async (transaction) => {
        const conversation = await transaction.conversation.findFirst({
          where: activeConversationWhere(
            data.senderId,
            data.conversationId,
          ),
          select: { id: true, kind: true },
        });
        if (!conversation) return null;
        if (conversation.kind === ConversationKind.OFFICIAL) {
          throw new ChatActionConflictError("read_only");
        }
        if (
          (conversation.kind === ConversationKind.GROUP ||
            conversation.kind === ConversationKind.BROADCAST) &&
          data.type === "IMAGE"
        ) {
          throw new ChatActionConflictError("group_images_disabled");
        }

        // Messaging is free — do not enforce lifetime send caps.
        // (Legacy messagingQuota path intentionally unused.)

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

        // Fan-out after commit — large recipient lists must not run inside
        // this transaction (timeout / all-or-nothing failure risk).
        if (
          conversation.kind === ConversationKind.BROADCAST &&
          data.type === "TEXT" &&
          data.body
        ) {
          fanOutBody = data.body;
        }

        return created;
      });

      if (message && fanOutBody) {
        try {
          await fanOutBroadcastMessage(this.database, {
            broadcastConversationId: data.conversationId,
            senderId: data.senderId,
            body: fanOutBody,
          });
        } catch (error) {
          // Message is already committed; never fail the send on fan-out.
          // Idempotent retries would otherwise skip fan-out entirely.
          console.error("Broadcast fan-out failed", {
            conversationId: data.conversationId,
            senderId: data.senderId,
            error,
          });
        }
      }

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
      orderBy: { updatedAt: "desc" },
      take: 100,
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
        OR: [
          { kind: ConversationKind.OFFICIAL },
          { kind: ConversationKind.DIRECT },
          { kind: ConversationKind.GROUP },
          { kind: ConversationKind.BROADCAST },
          { match: { is: { status: MatchStatus.ACTIVE } } },
        ],
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

  async findOrCreateDirectConversation(
    senderId: string,
    recipientId: string,
  ): Promise<ConversationViewRecord | null> {
    if (senderId === recipientId) return null;

    const [directUserLowId, directUserHighId] =
      senderId < recipientId
        ? [senderId, recipientId]
        : [recipientId, senderId];

    const block = await this.database.block.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: recipientId },
          { blockerId: recipientId, blockedId: senderId },
        ],
      },
      select: { id: true },
    });
    if (block) throw new ChatActionConflictError("blocked");

    const recipient = await this.database.user.findFirst({
      where: {
        id: recipientId,
        ...visibleUserCardWhere(senderId),
      },
      select: { id: true },
    });
    if (!recipient) return null;

    const activeMatch = await this.database.match.findFirst({
      where: {
        status: MatchStatus.ACTIVE,
        OR: [
          { userAId: senderId, userBId: recipientId },
          { userAId: recipientId, userBId: senderId },
        ],
        conversation: { is: { status: ConversationStatus.ACTIVE } },
      },
      select: { conversation: { select: { id: true } } },
    });
    if (activeMatch?.conversation) {
      return this.findConversation(activeMatch.conversation.id, senderId);
    }

    const existing = await this.database.conversation.findFirst({
      where: {
        kind: ConversationKind.DIRECT,
        directUserLowId,
        directUserHighId,
        status: ConversationStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (existing) {
      await this.database.conversationMember.updateMany({
        where: {
          conversationId: existing.id,
          userId: senderId,
          leftAt: { not: null },
        },
        data: { leftAt: null, clearedAt: null, isArchived: false },
      });
      return this.findConversation(existing.id, senderId);
    }

    const created = await this.database.conversation.create({
      data: {
        kind: ConversationKind.DIRECT,
        directUserLowId,
        directUserHighId,
        members: {
          create: [{ userId: senderId }, { userId: recipientId }],
        },
      },
      select: { id: true },
    });
    return this.findConversation(created.id, senderId);
  }

  async leaveConversation(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const conversation = await this.database.conversation.findFirst({
      where: { id: conversationId },
      select: { id: true, kind: true, status: true },
    });
    if (!conversation || conversation.status !== ConversationStatus.ACTIVE) {
      return false;
    }
    if (conversation.kind === ConversationKind.OFFICIAL) {
      throw new ChatActionConflictError("read_only");
    }
    if (conversation.kind === ConversationKind.MATCH) {
      throw new ChatActionConflictError("match_use_unmatch");
    }

    const now = new Date();
    return this.database.$transaction(async (transaction) => {
      const members = await transaction.conversationMember.findMany({
        where: { conversationId, leftAt: null },
        select: { userId: true, role: true },
      });
      const leaving = members.find((member) => member.userId === userId);
      if (!leaving) return false;

      const updated = await transaction.conversationMember.updateMany({
        where: {
          conversationId,
          userId,
          leftAt: null,
        },
        data: { leftAt: now, clearedAt: now, isArchived: false },
      });
      if (updated.count === 0) return false;

      if (conversation.kind === ConversationKind.GROUP) {
        await ensureGroupHasAdmin(transaction, conversationId);
        const leaver = await transaction.user.findUnique({
          where: { id: userId },
          select: { username: true, displayName: true },
        });
        const label =
          leaver?.displayName?.trim() || leaver?.username || "Someone";
        await createSystemMessage(
          transaction,
          conversationId,
          userId,
          `${label} left the group`,
        );
        // Do not notify other members with conversation:left — they stay in the group.
        await transaction.outboxEvent.create({
          data: {
            eventType: "chat.conversation.left",
            aggregateType: "conversation",
            aggregateId: conversationId,
            payload: {
              conversationId,
              actorId: userId,
              peerId: null,
            },
          },
        });
        return true;
      }

      if (conversation.kind === ConversationKind.BROADCAST) {
        await transaction.broadcastRecipient.deleteMany({
          where: { conversationId },
        });
        await transaction.conversation.update({
          where: { id: conversationId },
          data: { status: ConversationStatus.CLOSED, updatedAt: now },
        });
        await transaction.outboxEvent.create({
          data: {
            eventType: "chat.conversation.left",
            aggregateType: "conversation",
            aggregateId: conversationId,
            payload: {
              conversationId,
              actorId: userId,
              peerId: null,
            },
          },
        });
        return true;
      }

      const peerId =
        members.find((member) => member.userId !== userId)?.userId ?? null;
      await transaction.outboxEvent.create({
        data: {
          eventType: "chat.conversation.left",
          aggregateType: "conversation",
          aggregateId: conversationId,
          payload: {
            conversationId,
            actorId: userId,
            peerId,
          },
        },
      });
      return true;
    });
  }

  async createGroup(input: {
    creatorId: string;
    title: string;
    memberIds: string[];
  }): Promise<ConversationViewRecord> {
    const title = input.title.trim();
    if (title.length < 1 || title.length > 80) {
      throw new ChatActionConflictError("invalid_title");
    }

    const uniqueMemberIds = [
      ...new Set(input.memberIds.filter((id) => id !== input.creatorId)),
    ];
    for (const memberId of uniqueMemberIds) {
      const matched = await findActiveMatch(
        this.database,
        input.creatorId,
        memberId,
      );
      if (!matched) throw new NotMatchedError();
    }

    const created = await this.database.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.create({
        data: {
          kind: ConversationKind.GROUP,
          title,
          createdByUserId: input.creatorId,
          members: {
            create: [
              {
                userId: input.creatorId,
                role: ConversationMemberRole.ADMIN,
              },
              ...uniqueMemberIds.map((userId) => ({
                userId,
                role: ConversationMemberRole.MEMBER,
              })),
            ],
          },
        },
        select: { id: true },
      });
      const creator = await transaction.user.findUnique({
        where: { id: input.creatorId },
        select: { username: true, displayName: true },
      });
      const label =
        creator?.displayName?.trim() || creator?.username || "Someone";
      await createSystemMessage(
        transaction,
        conversation.id,
        input.creatorId,
        `${label} created the group`,
      );
      return conversation.id;
    });

    const view = await this.findConversation(created, input.creatorId);
    if (!view) throw new Error("Created group conversation is missing");
    return view;
  }

  async createBroadcast(input: {
    creatorId: string;
    title: string;
    memberIds: string[];
  }): Promise<ConversationViewRecord> {
    const creator = await this.database.user.findFirst({
      where: {
        id: input.creatorId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        broadcastEnabled: true,
      },
      select: { id: true, username: true, displayName: true },
    });
    if (!creator) throw new BroadcastDisabledError();

    const title = input.title.trim();
    if (title.length < 1 || title.length > 80) {
      throw new ChatActionConflictError("invalid_title");
    }

    const uniqueMemberIds = [
      ...new Set(input.memberIds.filter((id) => id !== input.creatorId)),
    ];
    if (uniqueMemberIds.length < 1) {
      throw new ChatActionConflictError("broadcast_needs_recipients");
    }
    for (const memberId of uniqueMemberIds) {
      const matched = await findActiveMatch(
        this.database,
        input.creatorId,
        memberId,
      );
      if (!matched) throw new NotMatchedError();
    }

    const created = await this.database.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.create({
        data: {
          kind: ConversationKind.BROADCAST,
          title,
          createdByUserId: input.creatorId,
          members: {
            create: [
              {
                userId: input.creatorId,
                role: ConversationMemberRole.ADMIN,
              },
            ],
          },
          broadcastRecipients: {
            create: uniqueMemberIds.map((userId) => ({ userId })),
          },
        },
        select: { id: true },
      });
      const label =
        creator.displayName?.trim() || creator.username || "Someone";
      await createSystemMessage(
        transaction,
        conversation.id,
        input.creatorId,
        `${label} created the broadcast list`,
      );
      return conversation.id;
    });

    const view = await this.findConversation(created, input.creatorId);
    if (!view) throw new Error("Created broadcast conversation is missing");
    return view;
  }

  async addGroupMember(input: {
    conversationId: string;
    actorId: string;
    userId: string;
  }): Promise<ConversationViewRecord | null> {
    return this.addGroupMembers({
      conversationId: input.conversationId,
      actorId: input.actorId,
      userIds: [input.userId],
    });
  }

  async addGroupMembers(input: {
    conversationId: string;
    actorId: string;
    userIds: string[];
  }): Promise<ConversationViewRecord | null> {
    const uniqueIds = [
      ...new Set(input.userIds.filter((id) => id !== input.actorId)),
    ];
    if (uniqueIds.length === 0) {
      return this.findConversation(input.conversationId, input.actorId);
    }

    const conversation = await this.database.conversation.findFirst({
      where: {
        id: input.conversationId,
        status: ConversationStatus.ACTIVE,
      },
      select: { id: true, kind: true },
    });
    if (!conversation) return null;
    if (
      conversation.kind !== ConversationKind.GROUP &&
      conversation.kind !== ConversationKind.BROADCAST
    ) {
      throw new NotGroupError();
    }

    const actor = await this.database.conversationMember.findFirst({
      where: {
        conversationId: input.conversationId,
        userId: input.actorId,
        leftAt: null,
      },
      select: { id: true },
    });
    if (!actor) return null;

    for (const userId of uniqueIds) {
      const matched = await findActiveMatch(
        this.database,
        input.actorId,
        userId,
      );
      if (!matched) throw new NotMatchedError();
    }

    if (conversation.kind === ConversationKind.BROADCAST) {
      const existing = await this.database.broadcastRecipient.findMany({
        where: {
          conversationId: input.conversationId,
          userId: { in: uniqueIds },
        },
        select: { userId: true },
      });
      if (existing.length > 0) throw new AlreadyMemberError();

      await this.database.$transaction(async (transaction) => {
        await transaction.broadcastRecipient.createMany({
          data: uniqueIds.map((userId) => ({
            conversationId: input.conversationId,
            userId,
          })),
        });
        await transaction.conversation.update({
          where: { id: input.conversationId },
          data: { updatedAt: new Date() },
        });
      });
      return this.findConversation(input.conversationId, input.actorId);
    }

    const existingRows = await this.database.conversationMember.findMany({
      where: {
        conversationId: input.conversationId,
        userId: { in: uniqueIds },
      },
      select: { id: true, userId: true, leftAt: true },
    });
    const existingByUser = new Map(
      existingRows.map((row) => [row.userId, row] as const),
    );
    for (const userId of uniqueIds) {
      const existing = existingByUser.get(userId);
      if (existing && existing.leftAt === null) {
        throw new AlreadyMemberError();
      }
    }

    await this.database.$transaction(async (transaction) => {
      for (const userId of uniqueIds) {
        const existing = existingByUser.get(userId);
        if (existing) {
          await transaction.conversationMember.update({
            where: { id: existing.id },
            data: {
              leftAt: null,
              clearedAt: null,
              isArchived: false,
              role: ConversationMemberRole.MEMBER,
              unreadCount: 0,
            },
          });
        } else {
          await transaction.conversationMember.create({
            data: {
              conversationId: input.conversationId,
              userId,
              role: ConversationMemberRole.MEMBER,
            },
          });
        }
      }

      const [actorUser, addedUsers] = await Promise.all([
        transaction.user.findUnique({
          where: { id: input.actorId },
          select: { username: true, displayName: true },
        }),
        transaction.user.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, username: true, displayName: true },
        }),
      ]);
      const actorLabel =
        actorUser?.displayName?.trim() || actorUser?.username || "Someone";
      const nameById = new Map(
        addedUsers.map(
          (user) =>
            [
              user.id,
              user.displayName?.trim() || user.username || "Someone",
            ] as const,
        ),
      );
      const labels = uniqueIds.map(
        (id) => nameById.get(id) ?? "Someone",
      );
      const addedLabel =
        labels.length === 1
          ? labels[0]
          : labels.length === 2
            ? `${labels[0]} and ${labels[1]}`
            : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
      await createSystemMessage(
        transaction,
        input.conversationId,
        input.actorId,
        `${actorLabel} added ${addedLabel}`,
      );

      await transaction.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });
    });

    return this.findConversation(input.conversationId, input.actorId);
  }

  async removeGroupMember(input: {
    conversationId: string;
    actorId: string;
    userId: string;
  }): Promise<ConversationViewRecord | null> {
    if (input.actorId === input.userId) {
      throw new ChatActionConflictError("cannot_remove_self");
    }

    const conversation = await this.database.conversation.findFirst({
      where: {
        id: input.conversationId,
        status: ConversationStatus.ACTIVE,
      },
      select: { id: true, kind: true },
    });
    if (!conversation) return null;
    if (
      conversation.kind !== ConversationKind.GROUP &&
      conversation.kind !== ConversationKind.BROADCAST
    ) {
      throw new NotGroupError();
    }

    const actor = await this.database.conversationMember.findFirst({
      where: {
        conversationId: input.conversationId,
        userId: input.actorId,
        leftAt: null,
      },
      select: { id: true, role: true },
    });
    if (!actor) return null;
    if (actor.role !== ConversationMemberRole.ADMIN) {
      throw new NotGroupAdminError();
    }

    if (conversation.kind === ConversationKind.BROADCAST) {
      const deleted = await this.database.broadcastRecipient.deleteMany({
        where: {
          conversationId: input.conversationId,
          userId: input.userId,
        },
      });
      if (deleted.count === 0) return null;
      await this.database.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });
      return this.findConversation(input.conversationId, input.actorId);
    }

    const now = new Date();
    const removed = await this.database.$transaction(async (transaction) => {
      const target = await transaction.conversationMember.findFirst({
        where: {
          conversationId: input.conversationId,
          userId: input.userId,
          leftAt: null,
        },
        select: { id: true, role: true },
      });
      if (!target) return false;
      if (target.role === ConversationMemberRole.ADMIN) {
        throw new CannotRemoveAdminError();
      }

      await transaction.conversationMember.update({
        where: { id: target.id },
        data: { leftAt: now, clearedAt: now, isArchived: false },
      });
      await ensureGroupHasAdmin(transaction, input.conversationId);
      await transaction.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: now },
      });
      const removedUser = await transaction.user.findUnique({
        where: { id: input.userId },
        select: { username: true, displayName: true },
      });
      const label =
        removedUser?.displayName?.trim() ||
        removedUser?.username ||
        "Someone";
      await createSystemMessage(
        transaction,
        input.conversationId,
        input.actorId,
        `${label} was removed from the group`,
      );
      // Notify only the removed member to drop this conversation from their inbox.
      await transaction.outboxEvent.create({
        data: {
          eventType: "chat.conversation.left",
          aggregateType: "conversation",
          aggregateId: input.conversationId,
          payload: {
            conversationId: input.conversationId,
            actorId: input.actorId,
            peerId: input.userId,
          },
        },
      });
      return true;
    });
    if (!removed) return null;

    return this.findConversation(input.conversationId, input.actorId);
  }

  async listGroupMembers(
    conversationId: string,
    userId: string,
  ): Promise<GroupMemberRecord[] | null> {
    const conversation = await this.database.conversation.findFirst({
      where: {
        id: conversationId,
        status: ConversationStatus.ACTIVE,
        members: { some: { userId, leftAt: null } },
      },
      select: {
        kind: true,
        members: {
          where: { leftAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            userId: true,
            role: true,
            user: { select: publicAuthorSelect() },
          },
        },
      },
    });
    if (!conversation) return null;
    if (
      conversation.kind !== ConversationKind.GROUP &&
      conversation.kind !== ConversationKind.BROADCAST
    ) {
      throw new NotGroupError();
    }
    if (conversation.kind === ConversationKind.BROADCAST) {
      const recipients = await this.database.broadcastRecipient.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        select: {
          userId: true,
          user: { select: publicAuthorSelect() },
        },
      });
      // Recipients only — creator is the sole ConversationMember, not a recipient.
      return recipients.map((recipient) => ({
        userId: recipient.userId,
        role: ConversationMemberRole.MEMBER,
        user: recipient.user,
      }));
    }
    return conversation.members.map((member) => ({
      userId: member.userId,
      role: member.role,
      user: member.user,
    }));
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
  const member = row.members.find((entry) => entry.userId === userId);
  if (!member) throw new Error("Conversation member projection is missing");
  const isOfficial = row.kind === ConversationKind.OFFICIAL;
  const isDirect = row.kind === ConversationKind.DIRECT;
  const isGroup = row.kind === ConversationKind.GROUP;
  const isBroadcast = row.kind === ConversationKind.BROADCAST;
  const isNamedList = isGroup || isBroadcast;
  const peer = isNamedList
    ? groupPeerFallback(
        row.id,
        row.title,
        isBroadcast ? "broadcast" : "group",
      )
    : isOfficial
      ? (row.members.find((entry) => entry.userId !== userId)?.user ??
        officialPeerFallback(
          row.members.find((entry) => entry.userId !== userId)?.userId,
        ))
      : isDirect
        ? (row.members.find((entry) => entry.userId !== userId)?.user ?? null)
        : row.match
          ? row.match.userAId === userId
            ? row.match.userB
            : row.match.userA
          : null;
  if (!peer) throw new Error("Conversation peer projection is missing");
  return {
    id: row.id,
    kind: row.kind,
    matchId: row.matchId,
    title: isNamedList ? row.title : null,
    memberCount: isBroadcast
      ? row._count.broadcastRecipients
      : isGroup
        ? row.members.length
        : row.members.length || 2,
    myRole: isNamedList ? member.role : null,
    isOfficial,
    isReadOnly: isOfficial,
    peer,
    unreadCount: member.unreadCount,
    isMuted: member.isMuted,
    isPinned: member.isPinned,
    isArchived: member.isArchived,
    updatedAt: row.updatedAt,
    lastMessage: row.messages[0] ?? null,
  };
}

function groupPeerFallback(
  conversationId: string,
  title: string | null,
  username: "group" | "broadcast" = "group",
): PostAuthorViewRecord {
  return {
    id: conversationId,
    username,
    displayName: title,
    bio: null,
    ageRange: AgeRange.AGE_25_28,
    gender: Gender.OTHER,
    country: "Global",
    relationshipGoal: null,
    websiteUrl: null,
    instagramHandle: null,
    isVerifiedBadge: false,
    premiumTier: "FREE",
    isPrivateAccount: false,
    hideAge: true,
    hideCountry: true,
    hideOnline: true,
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    createdAt: new Date(0),
    profilePhoto: null,
    coverPhoto: null,
    interests: [],
  };
}

function officialPeerFallback(userId?: string): PostAuthorViewRecord {
  return {
    id: userId ?? "milox-official",
    username: MILOX_OFFICIAL_USERNAME,
    displayName: MILOX_OFFICIAL_DISPLAY_NAME,
    bio: null,
    ageRange: AgeRange.AGE_25_28,
    gender: Gender.OTHER,
    country: "Global",
    relationshipGoal: null,
    websiteUrl: null,
    instagramHandle: null,
    isVerifiedBadge: true,
    premiumTier: "FREE",
    isPrivateAccount: false,
    hideAge: true,
    hideCountry: true,
    hideOnline: true,
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    createdAt: new Date(0),
    profilePhoto: { id: MILOX_OFFICIAL_AVATAR_MEDIA_ID },
    coverPhoto: null,
    interests: [],
  };
}

type TransactionClient = Prisma.TransactionClient;

async function findActiveMatch(
  database: PrismaClient | TransactionClient,
  userA: string,
  userB: string,
): Promise<boolean> {
  const match = await findActiveMatchRecord(database, userA, userB);
  return Boolean(match);
}

async function findActiveMatchRecord(
  database: PrismaClient | TransactionClient,
  userA: string,
  userB: string,
): Promise<{ id: string } | null> {
  return database.match.findFirst({
    where: {
      status: MatchStatus.ACTIVE,
      OR: [
        { userAId: userA, userBId: userB },
        { userAId: userB, userBId: userA },
      ],
    },
    select: { id: true },
  });
}

async function fanOutBroadcastMessage(
  database: PrismaClient | TransactionClient,
  input: {
    broadcastConversationId: string;
    senderId: string;
    body: string;
  },
): Promise<void> {
  const recipients = await database.broadcastRecipient.findMany({
    where: { conversationId: input.broadcastConversationId },
    select: { userId: true },
  });
  for (const recipient of recipients) {
    try {
      const match = await findActiveMatchRecord(
        database,
        input.senderId,
        recipient.userId,
      );
      if (!match) continue;
      const dm = await database.conversation.findFirst({
        where: {
          kind: ConversationKind.MATCH,
          matchId: match.id,
          status: ConversationStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (!dm) continue;

      const created = await database.message.create({
        data: {
          conversationId: dm.id,
          senderId: input.senderId,
          type: MessageType.TEXT,
          body: input.body,
        },
        select: { id: true, createdAt: true },
      });
      await database.conversation.update({
        where: { id: dm.id },
        data: { updatedAt: created.createdAt },
      });
      await database.conversationMember.updateMany({
        where: {
          conversationId: dm.id,
          userId: { not: input.senderId },
          leftAt: null,
        },
        data: {
          unreadCount: { increment: 1 },
          isArchived: false,
        },
      });
      const eventPayload = {
        messageId: created.id,
        conversationId: dm.id,
        senderId: input.senderId,
      };
      await database.outboxEvent.createMany({
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
    } catch {
      // Skip one failed recipient so the rest of the list still receives the message.
    }
  }
}

async function ensureGroupHasAdmin(
  transaction: TransactionClient,
  conversationId: string,
): Promise<void> {
  const adminCount = await transaction.conversationMember.count({
    where: {
      conversationId,
      leftAt: null,
      role: ConversationMemberRole.ADMIN,
    },
  });
  if (adminCount > 0) return;

  const oldest = await transaction.conversationMember.findFirst({
    where: { conversationId, leftAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!oldest) return;

  await transaction.conversationMember.update({
    where: { id: oldest.id },
    data: { role: ConversationMemberRole.ADMIN },
  });
}

async function createSystemMessage(
  transaction: TransactionClient,
  conversationId: string,
  senderId: string,
  body: string,
): Promise<void> {
  const created = await transaction.message.create({
    data: {
      conversationId,
      senderId,
      type: MessageType.SYSTEM,
      body,
    },
    select: { id: true, createdAt: true },
  });
  await transaction.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: created.createdAt },
  });
  const eventPayload = {
    messageId: created.id,
    conversationId,
    senderId,
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
}
