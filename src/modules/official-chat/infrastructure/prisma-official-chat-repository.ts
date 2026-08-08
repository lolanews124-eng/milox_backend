import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ConversationKind,
  ConversationStatus,
  MessageType,
} from "@prisma/client";

import type { MiloxOfficialUserRecord } from "../../../infrastructure/milox-official-user.js";
import { activeBroadcastRecipientWhere } from "../../../shared/user-visibility.js";
import {
  buildOfficialWelcomeBody,
  OFFICIAL_WELCOME_BUTTONS,
} from "../official-chat-config.js";
import type {
  BroadcastOfficialMessageInput,
  OfficialMessageMetadata,
} from "../official-chat-types.js";

const RECIPIENT_PAGE_SIZE = 500;
const DELIVERY_CONCURRENCY = 12;

export interface SignupOfficialChatWriter {
  bootstrapWelcomeInTransaction(
    transaction: Prisma.TransactionClient,
    input: { userId: string; displayName: string },
  ): Promise<void>;
}

export interface OfficialBroadcastStats {
  sent: number;
  failed: number;
  total: number;
}

export class PrismaOfficialChatRepository implements SignupOfficialChatWriter {
  constructor(
    private readonly database: PrismaClient,
    private readonly officialUser: MiloxOfficialUserRecord,
    private readonly wakeOutbox?: () => void,
  ) {}

  async bootstrapWelcomeInTransaction(
    transaction: Prisma.TransactionClient,
    input: { userId: string; displayName: string },
  ): Promise<void> {
    await this.ensureOfficialConversationInTransaction(
      transaction,
      input.userId,
      this.officialUser.id,
      { sendWelcome: true, displayName: input.displayName },
    );
  }

  async countBroadcastRecipients(): Promise<number> {
    return this.database.user.count({
      where: activeBroadcastRecipientWhere(),
    });
  }

  async broadcastToAllUsers(
    input: BroadcastOfficialMessageInput,
  ): Promise<OfficialBroadcastStats> {
    const recipientWhere = activeBroadcastRecipientWhere();
    const total = await this.database.user.count({ where: recipientWhere });
    if (total === 0) {
      return { sent: 0, failed: 0, total: 0 };
    }

    const metadata = buildMetadata(input.buttons);
    const messageType = input.mediaId ? MessageType.IMAGE : MessageType.TEXT;
    let sent = 0;
    let failed = 0;
    let cursor: string | undefined;
    let processedSinceWake = 0;

    for (;;) {
      const users = await this.database.user.findMany({
        where: {
          ...recipientWhere,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: RECIPIENT_PAGE_SIZE,
        select: { id: true },
      });
      if (users.length === 0) break;

      const pageResults = await mapWithConcurrency(
        users,
        DELIVERY_CONCURRENCY,
        async (user) => {
          try {
            await this.deliverOfficialMessageToUser(
              user.id,
              input.body,
              messageType,
              metadata,
              input.mediaId,
            );
            return true;
          } catch (error: unknown) {
            console.error("Official message broadcast failed for user", {
              userId: user.id,
              error,
            });
            return false;
          }
        },
      );

      sent += pageResults.filter(Boolean).length;
      failed += pageResults.filter((delivered) => !delivered).length;
      processedSinceWake += users.length;
      if (processedSinceWake >= 50) {
        this.wakeOutbox?.();
        processedSinceWake = 0;
      }

      cursor = users[users.length - 1]?.id;
      if (users.length < RECIPIENT_PAGE_SIZE) break;
    }

    this.wakeOutbox?.();
    return { sent, failed, total };
  }

  private async deliverOfficialMessageToUser(
    userId: string,
    body: string,
    messageType: MessageType,
    metadata: OfficialMessageMetadata | null,
    mediaId?: string,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const conversation = await this.ensureOfficialConversationInTransaction(
        transaction,
        userId,
        this.officialUser.id,
      );
      const createdAt = new Date();
      const message = await transaction.message.create({
        data: {
          conversationId: conversation.id,
          senderId: this.officialUser.id,
          type: messageType,
          body,
          ...(mediaId ? { mediaAssetId: mediaId } : {}),
          ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
        },
        select: { id: true },
      });
      await transaction.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: createdAt },
      });
      await transaction.conversationMember.upsert({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId,
          },
        },
        create: {
          conversationId: conversation.id,
          userId,
          unreadCount: 1,
          isPinned: true,
        },
        update: {
          unreadCount: { increment: 1 },
          isArchived: false,
          leftAt: null,
        },
      });
      const eventPayload = buildMessageEventPayload({
        messageId: message.id,
        conversationId: conversation.id,
        senderId: this.officialUser.id,
        body,
      });
      await transaction.outboxEvent.createMany({
        data: [
          {
            eventType: "chat.message.created",
            aggregateType: "message",
            aggregateId: message.id,
            payload: eventPayload,
          },
          {
            eventType: "message.created",
            aggregateType: "message",
            aggregateId: message.id,
            payload: eventPayload,
          },
        ],
      });
    });
  }

  private async ensureOfficialConversationInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    officialUserId: string,
    options?: { sendWelcome?: boolean; displayName?: string },
  ): Promise<{ id: string; createdWelcome: boolean }> {
    const existing = await transaction.conversation.findUnique({
      where: { recipientUserId: userId },
      select: { id: true },
    });
    if (existing) {
      await transaction.conversation.update({
        where: { id: existing.id },
        data: {
          kind: ConversationKind.OFFICIAL,
          status: ConversationStatus.ACTIVE,
        },
      });
      await this.ensureOfficialMembersInTransaction(
        transaction,
        existing.id,
        userId,
        officialUserId,
      );
      if (options?.sendWelcome) {
        const welcomeExists = await transaction.message.findFirst({
          where: {
            conversationId: existing.id,
            type: MessageType.SYSTEM,
            senderId: officialUserId,
          },
          select: { id: true },
        });
        if (!welcomeExists && options.displayName) {
          await this.createWelcomeMessage(
            transaction,
            existing.id,
            officialUserId,
            userId,
            options.displayName,
          );
          return { id: existing.id, createdWelcome: true };
        }
      }
      return { id: existing.id, createdWelcome: false };
    }

    const createdAt = new Date();
    const conversation = await transaction.conversation.create({
      data: {
        kind: ConversationKind.OFFICIAL,
        recipientUserId: userId,
        status: ConversationStatus.ACTIVE,
        members: {
          create: [
            {
              userId,
              isPinned: true,
              unreadCount: options?.sendWelcome ? 1 : 0,
            },
            { userId: officialUserId },
          ],
        },
      },
      select: { id: true },
    });

    if (options?.sendWelcome && options.displayName) {
      await this.createWelcomeMessage(
        transaction,
        conversation.id,
        officialUserId,
        userId,
        options.displayName,
      );
      await transaction.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: createdAt },
      });
      return { id: conversation.id, createdWelcome: true };
    }

    return { id: conversation.id, createdWelcome: false };
  }

  private async ensureOfficialMembersInTransaction(
    transaction: Prisma.TransactionClient,
    conversationId: string,
    recipientUserId: string,
    officialUserId: string,
  ): Promise<void> {
    await transaction.conversationMember.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId: recipientUserId,
        },
      },
      create: {
        conversationId,
        userId: recipientUserId,
        isPinned: true,
      },
      update: {
        leftAt: null,
        isArchived: false,
      },
    });
    await transaction.conversationMember.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId: officialUserId,
        },
      },
      create: {
        conversationId,
        userId: officialUserId,
      },
      update: {
        leftAt: null,
      },
    });
  }

  private async createWelcomeMessage(
    transaction: Prisma.TransactionClient,
    conversationId: string,
    officialUserId: string,
    recipientUserId: string,
    displayName: string,
  ): Promise<void> {
    const metadata: OfficialMessageMetadata = {
      buttons: OFFICIAL_WELCOME_BUTTONS,
    };
    const welcomeBody = buildOfficialWelcomeBody(displayName);
    const message = await transaction.message.create({
      data: {
        conversationId,
        senderId: officialUserId,
        type: MessageType.SYSTEM,
        body: welcomeBody,
        metadata: metadata as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    const eventPayload = buildMessageEventPayload({
      messageId: message.id,
      conversationId,
      senderId: officialUserId,
      body: welcomeBody,
    });
    await transaction.outboxEvent.createMany({
      data: [
        {
          eventType: "chat.message.created",
          aggregateType: "message",
          aggregateId: message.id,
          payload: eventPayload,
        },
        {
          eventType: "message.created",
          aggregateType: "message",
          aggregateId: message.id,
          payload: eventPayload,
        },
      ],
    });
    await transaction.conversationMember.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId: recipientUserId,
        },
      },
      create: {
        conversationId,
        userId: recipientUserId,
        unreadCount: 1,
        isPinned: true,
      },
      update: { unreadCount: 1 },
    });
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current]!);
    }
  }

  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function buildMetadata(
  buttons: BroadcastOfficialMessageInput["buttons"],
): OfficialMessageMetadata | null {
  if (!buttons?.length) return null;
  return { buttons };
}

function buildMessageEventPayload(input: {
  messageId: string;
  conversationId: string;
  senderId: string;
  body: string;
}): {
  messageId: string;
  conversationId: string;
  senderId: string;
  previewText: string;
} {
  return {
    messageId: input.messageId,
    conversationId: input.conversationId,
    senderId: input.senderId,
    previewText: truncateMessagePreview(input.body),
  };
}

function truncateMessagePreview(body: string, maxLength = 140): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
