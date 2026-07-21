import {
  ConversationStatus,
  InterestStatus,
  MatchStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import type {
  CreateInterestData,
  CreatedInterest,
  InterestPageQuery,
  InterestRepository,
  MatchPageQuery,
} from "../application/ports/interest-repository.js";
import {
  CannotInterestSelfError,
  InterestConflictError,
  InterestDailyLimitError,
  InterestIdempotencyConflictError,
} from "../application/ports/interest-repository.js";
import type {
  InterestViewRecord,
  MatchViewRecord,
} from "../application/interest-view.js";
import type { RewardsRepository } from "../../rewards/application/ports/rewards-repository.js";
import { InsufficientWalletBalanceError } from "../../rewards/application/ports/rewards-repository.js";
import { visibleUserCardWhere } from "../../posts/infrastructure/post-query-policy.js";
import {
  interestViewSelect,
  matchViewSelect,
} from "./interest-query-policy.js";

const CREATE_SCOPE = "interests.create";

export class PrismaInterestRepository implements InterestRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly rewards?: RewardsRepository,
  ) {}

  async create(
    data: CreateInterestData,
  ): Promise<CreatedInterest | null> {
    const replay = await this.findReplay(data);
    if (replay) return replay;

    try {
      const interest = await this.runSerializable(async (transaction) => {
        const recipient = await transaction.user.findFirst({
          where: {
            id: data.recipientId,
            ...visibleUserCardWhere(data.senderId),
          },
          select: { id: true },
        });
        if (!recipient) return null;
        if (recipient.id === data.senderId) {
          throw new CannotInterestSelfError();
        }

        const [userAId, userBId] = canonicalPair(
          data.senderId,
          recipient.id,
        );
        const activeMatch = await transaction.match.findUnique({
          where: { userAId_userBId: { userAId, userBId } },
          select: { status: true },
        });
        if (activeMatch?.status === MatchStatus.ACTIVE) {
          throw new InterestConflictError("already_matched");
        }

        const incomingPending = await transaction.interest.findFirst({
          where: {
            senderId: recipient.id,
            recipientId: data.senderId,
            status: InterestStatus.PENDING,
          },
          select: { id: true },
        });
        if (incomingPending) {
          throw new InterestConflictError("incoming_pending");
        }

        const pending = await transaction.interest.findFirst({
          where: {
            senderId: data.senderId,
            recipientId: recipient.id,
            status: InterestStatus.PENDING,
          },
          select: { id: true },
        });
        if (pending) throw new InterestConflictError("already_pending");

        const sentToday = await transaction.interest.count({
          where: {
            senderId: data.senderId,
            createdAt: { gte: startOfUtcDay() },
          },
        });
        if (sentToday >= data.dailyLimit) {
          throw new InterestDailyLimitError();
        }

        const wallet = await transaction.wallet.findUnique({
          where: { userId: data.senderId },
          select: { balance: true },
        });
        if (
          data.interestSendCost > 0 &&
          (!wallet || wallet.balance < data.interestSendCost)
        ) {
          throw new InsufficientWalletBalanceError();
        }

        const created = await transaction.interest.create({
          data: {
            senderId: data.senderId,
            recipientId: recipient.id,
            message: data.message,
          },
          select: interestViewSelect(),
        });

        if (data.interestSendCost > 0 && this.rewards) {
          await this.rewards.debitForInterest(transaction, {
            userId: data.senderId,
            interestId: created.id,
            cost: data.interestSendCost,
            idempotencyKey: `interest:${created.id}`,
          });
        }

        await transaction.idempotencyRecord.create({
          data: {
            userId: data.senderId,
            scope: CREATE_SCOPE,
            key: data.idempotencyKey,
            requestHash: data.requestHash,
            resourceType: "interest",
            resourceId: created.id,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        await transaction.outboxEvent.create({
          data: {
            eventType: "interest.received",
            aggregateType: "interest",
            aggregateId: created.id,
            payload: {
              interestId: created.id,
              actorId: data.senderId,
              recipientId: recipient.id,
            },
          },
        });
        return created;
      });
      return interest ? { interest, replayed: false } : null;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrentReplay = await this.findReplay(data);
        if (concurrentReplay) return concurrentReplay;
        const pending = await this.database.interest.findFirst({
          where: {
            senderId: data.senderId,
            recipientId: data.recipientId,
            status: InterestStatus.PENDING,
          },
          select: { id: true },
        });
        if (pending) throw new InterestConflictError("already_pending");
      }
      throw error;
    }
  }

  listIncoming(query: InterestPageQuery): Promise<InterestViewRecord[]> {
    return this.listInterests(query, "incoming");
  }

  listOutgoing(query: InterestPageQuery): Promise<InterestViewRecord[]> {
    return this.listInterests(query, "outgoing");
  }

  accept(
    interestId: string,
    recipientId: string,
  ): Promise<MatchViewRecord | null> {
    return this.runSerializable(async (transaction) => {
      const interest = await transaction.interest.findFirst({
        where: {
          id: interestId,
          recipientId,
          sender: { is: visibleUserCardWhere(recipientId) },
        },
        select: {
          id: true,
          senderId: true,
          recipientId: true,
          status: true,
        },
      });
      if (!interest) return null;
      if (interest.status !== InterestStatus.PENDING) {
        throw new InterestConflictError("not_pending");
      }

      const [userAId, userBId] = canonicalPair(
        interest.senderId,
        interest.recipientId,
      );
      const existing = await transaction.match.findUnique({
        where: { userAId_userBId: { userAId, userBId } },
        select: {
          id: true,
          status: true,
          conversation: { select: { id: true } },
        },
      });
      if (existing?.status === MatchStatus.ACTIVE) {
        throw new InterestConflictError("already_matched");
      }

      const respondedAt = new Date();
      const accepted = await transaction.interest.updateMany({
        where: { id: interest.id, status: InterestStatus.PENDING },
        data: { status: InterestStatus.ACCEPTED, respondedAt },
      });
      if (accepted.count === 0) {
        throw new InterestConflictError("not_pending");
      }
      await transaction.interest.updateMany({
        where: {
          id: { not: interest.id },
          status: InterestStatus.PENDING,
          OR: [
            {
              senderId: interest.senderId,
              recipientId: interest.recipientId,
            },
            {
              senderId: interest.recipientId,
              recipientId: interest.senderId,
            },
          ],
        },
        data: { status: InterestStatus.CANCELLED, respondedAt },
      });

      let matchId: string;
      if (existing) {
        await transaction.match.update({
          where: { id: existing.id },
          data: {
            interestId: interest.id,
            status: MatchStatus.ACTIVE,
            matchedAt: respondedAt,
            unmatchedAt: null,
          },
        });
        matchId = existing.id;
        if (existing.conversation) {
          await transaction.conversation.update({
            where: { id: existing.conversation.id },
            data: { status: ConversationStatus.ACTIVE },
          });
          await transaction.conversationMember.updateMany({
            where: { conversationId: existing.conversation.id },
            data: { leftAt: null, isArchived: false },
          });
        } else {
          await transaction.conversation.create({
            data: {
              matchId,
              members: {
                create: [{ userId: userAId }, { userId: userBId }],
              },
            },
          });
        }
      } else {
        const created = await transaction.match.create({
          data: {
            interestId: interest.id,
            userAId,
            userBId,
            conversation: {
              create: {
                members: {
                  create: [{ userId: userAId }, { userId: userBId }],
                },
              },
            },
          },
          select: { id: true },
        });
        matchId = created.id;
      }

      await transaction.outboxEvent.createMany({
        data: [
          {
            eventType: "interest.accepted",
            aggregateType: "interest",
            aggregateId: interest.id,
            payload: {
              interestId: interest.id,
              actorId: recipientId,
              recipientId: interest.senderId,
              matchId,
            },
          },
          {
            eventType: "match.created",
            aggregateType: "match",
            aggregateId: matchId,
            payload: {
              matchId,
              userAId,
              userBId,
            },
          },
        ],
      });
      const row = await transaction.match.findUniqueOrThrow({
        where: { id: matchId },
        select: matchViewSelect(),
      });
      return mapMatch(row, recipientId);
    });
  }

  reject(
    interestId: string,
    recipientId: string,
  ): Promise<InterestViewRecord | null> {
    return this.changeInterestStatus(
      interestId,
      recipientId,
      "recipient",
      InterestStatus.REJECTED,
    );
  }

  cancel(
    interestId: string,
    senderId: string,
  ): Promise<InterestViewRecord | null> {
    return this.changeInterestStatus(
      interestId,
      senderId,
      "sender",
      InterestStatus.CANCELLED,
    );
  }

  async listMatches(query: MatchPageQuery): Promise<MatchViewRecord[]> {
    const rows = await this.database.match.findMany({
      where: {
        status: MatchStatus.ACTIVE,
        OR: [{ userAId: query.userId }, { userBId: query.userId }],
        AND: [
          {
            OR: [
              {
                userAId: query.userId,
                userB: { is: visibleUserCardWhere(query.userId) },
              },
              {
                userBId: query.userId,
                userA: { is: visibleUserCardWhere(query.userId) },
              },
            ],
          },
        ],
        ...matchCursorWhere(query.before),
      },
      orderBy: [{ matchedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: matchViewSelect(),
    });
    return rows.map((row) => mapMatch(row, query.userId));
  }

  unmatch(matchId: string, userId: string): Promise<boolean> {
    return this.runSerializable(async (transaction) => {
      const match = await transaction.match.findFirst({
        where: {
          id: matchId,
          status: MatchStatus.ACTIVE,
          OR: [{ userAId: userId }, { userBId: userId }],
        },
        select: {
          id: true,
          userAId: true,
          userBId: true,
          conversation: { select: { id: true } },
        },
      });
      if (!match) return false;
      const now = new Date();
      const updated = await transaction.match.updateMany({
        where: { id: match.id, status: MatchStatus.ACTIVE },
        data: { status: MatchStatus.UNMATCHED, unmatchedAt: now },
      });
      if (updated.count === 0) return false;
      if (match.conversation) {
        await transaction.conversation.update({
          where: { id: match.conversation.id },
          data: { status: ConversationStatus.CLOSED },
        });
        await transaction.conversationMember.updateMany({
          where: { conversationId: match.conversation.id },
          data: { leftAt: now, clearedAt: now },
        });
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: "chat.match.unmatched",
          aggregateType: "match",
          aggregateId: match.id,
          payload: {
            matchId: match.id,
            conversationId: match.conversation?.id ?? null,
            actorId: userId,
            userAId: match.userAId,
            userBId: match.userBId,
          },
        },
      });
      return true;
    });
  }

  private listInterests(
    query: InterestPageQuery,
    direction: "incoming" | "outgoing",
  ): Promise<InterestViewRecord[]> {
    return this.database.interest.findMany({
      where: {
        ...(direction === "incoming"
          ? {
              recipientId: query.userId,
              sender: { is: visibleUserCardWhere(query.userId) },
            }
          : {
              senderId: query.userId,
              recipient: { is: visibleUserCardWhere(query.userId) },
            }),
        ...(query.status ? { status: query.status } : {}),
        ...interestCursorWhere(query.before),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: interestViewSelect(),
    });
  }

  private changeInterestStatus(
    interestId: string,
    actorId: string,
    actor: "sender" | "recipient",
    status: typeof InterestStatus.REJECTED | typeof InterestStatus.CANCELLED,
  ): Promise<InterestViewRecord | null> {
    return this.runSerializable(async (transaction) => {
      const interest = await transaction.interest.findFirst({
        where: {
          id: interestId,
          ...(actor === "sender"
            ? { senderId: actorId }
            : { recipientId: actorId }),
        },
        select: {
          id: true,
          senderId: true,
          recipientId: true,
          status: true,
        },
      });
      if (!interest) return null;
      if (interest.status !== InterestStatus.PENDING) {
        throw new InterestConflictError("not_pending");
      }
      const respondedAt = new Date();
      const updated = await transaction.interest.updateMany({
        where: { id: interest.id, status: InterestStatus.PENDING },
        data: { status, respondedAt },
      });
      if (updated.count === 0) {
        throw new InterestConflictError("not_pending");
      }
      await transaction.outboxEvent.create({
        data: {
          eventType:
            status === InterestStatus.REJECTED
              ? "interest.rejected"
              : "interest.cancelled",
          aggregateType: "interest",
          aggregateId: interest.id,
          payload: {
            interestId: interest.id,
            actorId,
            senderId: interest.senderId,
            recipientId: interest.recipientId,
          },
        },
      });
      return transaction.interest.findUniqueOrThrow({
        where: { id: interest.id },
        select: interestViewSelect(),
      });
    });
  }

  private async findReplay(
    data: CreateInterestData,
  ): Promise<CreatedInterest | null> {
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
      throw new InterestIdempotencyConflictError();
    }
    const interest = await this.database.interest.findUnique({
      where: { id: record.resourceId },
      select: interestViewSelect(),
    });
    if (!interest) throw new InterestIdempotencyConflictError();
    return { interest, replayed: true };
  }

  private async runSerializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    attempts = 3,
  ): Promise<T> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.database.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          attempt < attempts &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034"
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Serializable transaction retry exhausted");
  }
}

function canonicalPair(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first];
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function interestCursorWhere(
  before: InterestPageQuery["before"],
): Prisma.InterestWhereInput {
  if (!before) return {};
  return {
    OR: [
      { createdAt: { lt: before.createdAt } },
      { createdAt: before.createdAt, id: { lt: before.id } },
    ],
  };
}

function matchCursorWhere(
  before: MatchPageQuery["before"],
): Prisma.MatchWhereInput {
  if (!before) return {};
  return {
    OR: [
      { matchedAt: { lt: before.matchedAt } },
      { matchedAt: before.matchedAt, id: { lt: before.id } },
    ],
  };
}

function mapMatch(
  row: Prisma.MatchGetPayload<{ select: ReturnType<typeof matchViewSelect> }>,
  viewerId: string,
): MatchViewRecord {
  if (!row.conversation) {
    throw new Error("Active match is missing its conversation");
  }
  return {
    id: row.id,
    conversationId: row.conversation.id,
    matchedAt: row.matchedAt,
    peer: row.userAId === viewerId ? row.userB : row.userA,
  };
}
