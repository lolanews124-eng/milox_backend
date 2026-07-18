import {
  FollowStatus,
  InterestStatus,
  Prisma,
  ReportStatus,
  ReportTargetType,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";

import { publicAuthorSelect } from "../../posts/infrastructure/post-query-policy.js";
import type {
  BlockListEntry,
  BlockPageQuery,
  CreateReportData,
  CreatedReport,
  ModerationRepository,
} from "../application/ports/moderation-repository.js";
import {
  BlockConflictError,
  CannotBlockSelfError,
  ReportConflictError,
  ReportTargetInvalidError,
} from "../application/ports/moderation-repository.js";

export class PrismaModerationRepository implements ModerationRepository {
  constructor(private readonly database: PrismaClient) {}

  async block(
    username: string,
    blockerId: string,
  ): Promise<boolean | null> {
    const target = await this.database.user.findFirst({
      where: {
        usernameNormalized: username,
        status: { not: UserStatus.DELETED },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!target) return null;
    if (target.id === blockerId) throw new CannotBlockSelfError();

    try {
      await this.database.$transaction(async (transaction) => {
        await transaction.block.create({
          data: {
            blockerId,
            blockedId: target.id,
          },
        });
        await severSocialLinks(transaction, blockerId, target.id);
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new BlockConflictError("already_blocked");
      }
      throw error;
    }
  }

  async unblock(
    username: string,
    blockerId: string,
  ): Promise<boolean | null> {
    const target = await this.database.user.findFirst({
      where: {
        usernameNormalized: username,
        status: { not: UserStatus.DELETED },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!target) return null;
    if (target.id === blockerId) throw new CannotBlockSelfError();

    const removed = await this.database.block.deleteMany({
      where: { blockerId, blockedId: target.id },
    });
    if (removed.count === 0) throw new BlockConflictError("not_blocked");
    return true;
  }

  listBlocks(query: BlockPageQuery): Promise<BlockListEntry[]> {
    return this.database.block
      .findMany({
        where: {
          blockerId: query.blockerId,
          ...cursorWhere(query.before),
          blocked: {
            status: { not: UserStatus.DELETED },
            deletedAt: null,
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: {
          id: true,
          createdAt: true,
          blocked: { select: publicAuthorSelect() },
        },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          user: row.blocked,
        })),
      );
  }

  async createReport(
    data: CreateReportData,
  ): Promise<CreatedReport | null> {
    if (data.targetType === ReportTargetType.CONVERSATION) {
      throw new ReportTargetInvalidError();
    }
    if (data.targetType === ReportTargetType.POST && !data.postId) {
      throw new ReportTargetInvalidError();
    }

    try {
      return await this.database.$transaction(async (transaction) => {
        const resolved = await resolveReportTarget(transaction, data);
        if (!resolved) return null;
        if (resolved.reportedUserId === data.reporterId) {
          throw new ReportConflictError("self_report");
        }

        const existing = await transaction.report.findFirst({
          where: {
            reporterId: data.reporterId,
            status: {
              in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW],
            },
            ...(data.targetType === ReportTargetType.USER
              ? { targetType: ReportTargetType.USER, reportedUserId: resolved.reportedUserId }
              : {}),
            ...(data.targetType === ReportTargetType.POST
              ? { targetType: ReportTargetType.POST, postId: resolved.postId }
              : {}),
            ...(data.targetType === ReportTargetType.COMMENT
              ? {
                  targetType: ReportTargetType.COMMENT,
                  commentId: resolved.commentId,
                }
              : {}),
            ...(data.targetType === ReportTargetType.MESSAGE
              ? {
                  targetType: ReportTargetType.MESSAGE,
                  messageId: resolved.messageId,
                }
              : {}),
          },
          select: { id: true },
        });
        if (existing) throw new ReportConflictError("already_reported");

        return transaction.report.create({
          data: {
            reporterId: data.reporterId,
            targetType: data.targetType,
            reportedUserId: resolved.reportedUserId,
            postId: resolved.postId,
            commentId: resolved.commentId,
            messageId: resolved.messageId,
            reasonCode: data.reasonCode,
            details: data.details,
          },
          select: {
            id: true,
            status: true,
            createdAt: true,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ReportConflictError("already_reported");
      }
      throw error;
    }
  }
}

type Transaction = Prisma.TransactionClient;

async function resolveReportTarget(
  transaction: Transaction,
  data: CreateReportData,
): Promise<{
  reportedUserId: string | null;
  postId: string | null;
  commentId: string | null;
  messageId: string | null;
} | null> {
  if (data.targetType === ReportTargetType.USER) {
    if (!data.reportedUserId) throw new ReportTargetInvalidError();
    const user = await transaction.user.findFirst({
      where: {
        id: data.reportedUserId,
        status: { not: UserStatus.DELETED },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!user) return null;
    return {
      reportedUserId: user.id,
      postId: null,
      commentId: null,
      messageId: null,
    };
  }

  if (data.targetType === ReportTargetType.POST) {
    if (!data.postId) throw new ReportTargetInvalidError();
    const post = await transaction.post.findFirst({
      where: { id: data.postId, deletedAt: null, isHidden: false },
      select: { id: true, authorId: true },
    });
    if (!post) return null;
    return {
      reportedUserId: post.authorId,
      postId: post.id,
      commentId: null,
      messageId: null,
    };
  }

  if (data.targetType === ReportTargetType.COMMENT) {
    if (!data.commentId) throw new ReportTargetInvalidError();
    const comment = await transaction.comment.findFirst({
      where: { id: data.commentId, deletedAt: null, isHidden: false },
      select: { id: true, authorId: true },
    });
    if (!comment) return null;
    return {
      reportedUserId: comment.authorId,
      postId: null,
      commentId: comment.id,
      messageId: null,
    };
  }

  if (data.targetType === ReportTargetType.MESSAGE) {
    if (!data.messageId) throw new ReportTargetInvalidError();
    const message = await transaction.message.findFirst({
      where: {
        id: data.messageId,
        deletedForEveryoneAt: null,
        conversation: {
          members: {
            some: { userId: data.reporterId, leftAt: null },
          },
        },
      },
      select: { id: true, senderId: true },
    });
    if (!message) return null;
    return {
      reportedUserId: message.senderId,
      postId: null,
      commentId: null,
      messageId: message.id,
    };
  }

  throw new ReportTargetInvalidError();
}

async function severSocialLinks(
  transaction: Transaction,
  blockerId: string,
  blockedId: string,
): Promise<void> {
  const follows = await transaction.follow.findMany({
    where: {
      OR: [
        { followerId: blockerId, followeeId: blockedId },
        { followerId: blockedId, followeeId: blockerId },
      ],
      status: { in: [FollowStatus.ACTIVE, FollowStatus.PENDING] },
    },
    select: { id: true, followerId: true, followeeId: true, status: true },
  });

  for (const follow of follows) {
    await transaction.follow.delete({ where: { id: follow.id } });
    if (follow.status === FollowStatus.ACTIVE) {
      await transaction.user.updateMany({
        where: { id: follow.followeeId, followerCount: { gt: 0 } },
        data: { followerCount: { decrement: 1 } },
      });
      await transaction.user.updateMany({
        where: { id: follow.followerId, followingCount: { gt: 0 } },
        data: { followingCount: { decrement: 1 } },
      });
    }
  }

  await transaction.interest.updateMany({
    where: {
      status: InterestStatus.PENDING,
      OR: [
        { senderId: blockerId, recipientId: blockedId },
        { senderId: blockedId, recipientId: blockerId },
      ],
    },
    data: { status: InterestStatus.CANCELLED },
  });
}

function cursorWhere(
  before: BlockPageQuery["before"],
): Prisma.BlockWhereInput {
  if (!before) return {};
  return {
    OR: [
      { createdAt: { lt: before.createdAt } },
      { createdAt: before.createdAt, id: { lt: before.id } },
    ],
  };
}
