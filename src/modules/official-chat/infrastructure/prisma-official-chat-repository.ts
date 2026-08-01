import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ConversationKind,
  ConversationStatus,
  MessageType,
} from "@prisma/client";

import type { MiloxOfficialUserRecord } from "../../../infrastructure/milox-official-user.js";
import {
  buildOfficialWelcomeBody,
  OFFICIAL_WELCOME_BUTTONS,
} from "../official-chat-config.js";
import type {
  BroadcastOfficialMessageInput,
  OfficialMessageMetadata,
} from "../official-chat-types.js";

export interface SignupOfficialChatWriter {
  bootstrapWelcomeInTransaction(
    transaction: Prisma.TransactionClient,
    input: { userId: string; displayName: string },
  ): Promise<void>;
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

  async broadcastToAllUsers(
    input: BroadcastOfficialMessageInput,
  ): Promise<{ sent: number; failed: number }> {
    const metadata = buildMetadata(input.buttons);
    const messageType = input.mediaId ? MessageType.IMAGE : MessageType.SYSTEM;
    let sent = 0;
    let failed = 0;
    const batchSize = 200;
    let cursor: string | undefined;

    for (;;) {
      const users = await this.database.user.findMany({
        where: {
          isSystemAccount: false,
          status: "ACTIVE",
          deletedAt: null,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: batchSize,
        select: { id: true },
      });
      if (users.length === 0) break;

      for (const user of users) {
        try {
          await this.database.$transaction(async (transaction) => {
            const conversation = await this.ensureOfficialConversationInTransaction(
              transaction,
              user.id,
              this.officialUser.id,
            );
            const createdAt = new Date();
            const message = await transaction.message.create({
              data: {
                conversationId: conversation.id,
                senderId: this.officialUser.id,
                type: messageType,
                body: input.body,
                ...(input.mediaId ? { mediaAssetId: input.mediaId } : {}),
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
                  userId: user.id,
                },
              },
              create: {
                conversationId: conversation.id,
                userId: user.id,
                unreadCount: 1,
                isPinned: true,
              },
              update: {
                unreadCount: { increment: 1 },
                isArchived: false,
              },
            });
            const eventPayload = {
              messageId: message.id,
              conversationId: conversation.id,
              senderId: this.officialUser.id,
            };
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
          this.wakeOutbox?.();
          sent += 1;
        } catch (error: unknown) {
          failed += 1;
          console.error("Official message broadcast failed for user", {
            userId: user.id,
            error,
          });
        }
      }

      cursor = users[users.length - 1]?.id;
      if (users.length < batchSize) break;
    }

    return { sent, failed };
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
      update: {},
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
      update: {},
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
    const message = await transaction.message.create({
      data: {
        conversationId,
        senderId: officialUserId,
        type: MessageType.SYSTEM,
        body: buildOfficialWelcomeBody(displayName),
        metadata: metadata as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    const eventPayload = {
      messageId: message.id,
      conversationId,
      senderId: officialUserId,
    };
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

function buildMetadata(
  buttons: BroadcastOfficialMessageInput["buttons"],
): OfficialMessageMetadata | null {
  if (!buttons?.length) return null;
  return { buttons };
}
