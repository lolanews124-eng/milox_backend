import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  CommentPageQuery,
  CommentRepository,
  CreateCommentData,
} from "../application/ports/comment-repository.js";
import {
  CommentActionConflictError,
  CommentDepthError,
  ParentCommentNotFoundError,
} from "../application/ports/comment-repository.js";
import type { CommentViewRecord } from "../application/comment-view.js";
import {
  visibleAuthorWhere,
  visiblePostContentWhere,
  visiblePostWhere,
} from "../../posts/infrastructure/post-query-policy.js";
import { commentViewSelect } from "./comment-query-policy.js";

export class PrismaCommentRepository implements CommentRepository {
  constructor(private readonly database: PrismaClient) {}

  create(data: CreateCommentData): Promise<CommentViewRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const post = await transaction.post.findFirst({
        where: visiblePostWhere(data.postId, data.authorId),
        select: { id: true, authorId: true },
      });
      if (!post) return null;

      let parent: { id: string; authorId: string; depth: number } | null = null;
      if (data.parentId) {
        parent = await transaction.comment.findFirst({
          where: {
            id: data.parentId,
            postId: data.postId,
            deletedAt: null,
            isHidden: false,
            author: { is: visibleAuthorWhere(data.authorId) },
          },
          select: { id: true, authorId: true, depth: true },
        });
        if (!parent) throw new ParentCommentNotFoundError();
        if (parent.depth !== 0) throw new CommentDepthError();
      }

      const created = await transaction.comment.create({
        data: {
          postId: data.postId,
          authorId: data.authorId,
          body: data.body,
          depth: parent ? 1 : 0,
          ...(parent ? { parentId: parent.id } : {}),
        },
        select: { id: true },
      });
      await transaction.post.update({
        where: { id: data.postId },
        data: { commentCount: { increment: 1 } },
      });
      if (parent) {
        await transaction.comment.update({
          where: { id: parent.id },
          data: { replyCount: { increment: 1 } },
        });
      }

      const replyRecipientId =
        parent && parent.authorId !== data.authorId ? parent.authorId : null;
      const postRecipientId =
        !replyRecipientId && post.authorId !== data.authorId
          ? post.authorId
          : null;
      const recipientId = replyRecipientId ?? postRecipientId;
      if (recipientId) {
        await transaction.outboxEvent.create({
          data: {
            eventType: replyRecipientId
              ? "comment.replied"
              : "post.commented",
            aggregateType: "comment",
            aggregateId: created.id,
            payload: {
              commentId: created.id,
              postId: data.postId,
              actorId: data.authorId,
              recipientId,
              ...(parent ? { parentId: parent.id } : {}),
            },
          },
        });
      }

      return transaction.comment.findUniqueOrThrow({
        where: { id: created.id },
        select: commentViewSelect(data.authorId),
      });
    });
  }

  async listTopLevel(
    postId: string,
    query: CommentPageQuery,
  ): Promise<CommentViewRecord[] | null> {
    const post = await this.database.post.findFirst({
      where: visiblePostWhere(postId, query.viewerId),
      select: { id: true },
    });
    if (!post) return null;
    return this.database.comment.findMany({
      where: {
        postId,
        depth: 0,
        parentId: null,
        deletedAt: null,
        isHidden: false,
        author: { is: visibleAuthorWhere(query.viewerId) },
        ...cursorWhere(query.before),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: commentViewSelect(query.viewerId),
    });
  }

  async listReplies(
    parentId: string,
    query: CommentPageQuery,
  ): Promise<CommentViewRecord[] | null> {
    const parent = await this.database.comment.findFirst({
      where: {
        id: parentId,
        depth: 0,
        deletedAt: null,
        isHidden: false,
        author: { is: visibleAuthorWhere(query.viewerId) },
        post: { is: visiblePostContentWhere(query.viewerId) },
      },
      select: { id: true },
    });
    if (!parent) return null;
    return this.database.comment.findMany({
      where: {
        parentId,
        depth: 1,
        deletedAt: null,
        isHidden: false,
        author: { is: visibleAuthorWhere(query.viewerId) },
        ...cursorWhere(query.before),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: commentViewSelect(query.viewerId),
    });
  }

  softDelete(commentId: string, actorId: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const comment = await transaction.comment.findFirst({
        where: {
          id: commentId,
          deletedAt: null,
          post: { is: visiblePostContentWhere(actorId) },
        },
        select: {
          id: true,
          postId: true,
          authorId: true,
          parentId: true,
          depth: true,
          post: { select: { authorId: true } },
        },
      });
      if (
        !comment ||
        (comment.authorId !== actorId && comment.post.authorId !== actorId)
      ) {
        return false;
      }

      const deletedAt = new Date();
      const deleted =
        comment.depth === 0
          ? await transaction.comment.updateMany({
              where: {
                OR: [{ id: comment.id }, { parentId: comment.id }],
                deletedAt: null,
              },
              data: { deletedAt, isHidden: true },
            })
          : await transaction.comment.updateMany({
              where: { id: comment.id, deletedAt: null },
              data: { deletedAt, isHidden: true },
            });
      await transaction.post.updateMany({
        where: { id: comment.postId, commentCount: { gte: deleted.count } },
        data: { commentCount: { decrement: deleted.count } },
      });
      if (comment.parentId) {
        await transaction.comment.updateMany({
          where: {
            id: comment.parentId,
            replyCount: { gt: 0 },
            deletedAt: null,
          },
          data: { replyCount: { decrement: 1 } },
        });
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: "comment.deleted",
          aggregateType: "comment",
          aggregateId: comment.id,
          payload: {
            commentId: comment.id,
            postId: comment.postId,
            actorId,
          },
        },
      });
      return true;
    });
  }

  like(commentId: string, userId: string): Promise<CommentViewRecord | null> {
    return this.addLike(commentId, userId);
  }

  unlike(
    commentId: string,
    userId: string,
  ): Promise<CommentViewRecord | null> {
    return this.removeLike(commentId, userId);
  }

  private async addLike(
    commentId: string,
    userId: string,
  ): Promise<CommentViewRecord | null> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const comment = await findVisibleForAction(
          transaction,
          commentId,
          userId,
        );
        if (!comment) return null;
        await transaction.commentLike.create({
          data: { commentId, userId },
        });
        await transaction.comment.update({
          where: { id: commentId },
          data: { likeCount: { increment: 1 } },
        });
        if (comment.authorId !== userId) {
          await transaction.outboxEvent.create({
            data: {
              eventType: "comment.liked",
              aggregateType: "comment",
              aggregateId: commentId,
              payload: {
                commentId,
                postId: comment.postId,
                actorId: userId,
                recipientId: comment.authorId,
              },
            },
          });
        }
        return transaction.comment.findUnique({
          where: { id: commentId },
          select: commentViewSelect(userId),
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new CommentActionConflictError("already_liked");
      }
      throw error;
    }
  }

  private removeLike(
    commentId: string,
    userId: string,
  ): Promise<CommentViewRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const comment = await findVisibleForAction(
        transaction,
        commentId,
        userId,
      );
      if (!comment) return null;
      const deleted = await transaction.commentLike.deleteMany({
        where: { commentId, userId },
      });
      if (deleted.count === 0) {
        throw new CommentActionConflictError("not_liked");
      }
      await transaction.comment.updateMany({
        where: { id: commentId, likeCount: { gt: 0 } },
        data: { likeCount: { decrement: 1 } },
      });
      return transaction.comment.findUnique({
        where: { id: commentId },
        select: commentViewSelect(userId),
      });
    });
  }
}

type Transaction = Prisma.TransactionClient;

function findVisibleForAction(
  transaction: Transaction,
  commentId: string,
  viewerId: string,
): Promise<{ authorId: string; postId: string } | null> {
  return transaction.comment.findFirst({
    where: {
      id: commentId,
      deletedAt: null,
      isHidden: false,
      author: { is: visibleAuthorWhere(viewerId) },
      post: { is: visiblePostContentWhere(viewerId) },
    },
    select: { authorId: true, postId: true },
  });
}

function cursorWhere(
  before: CommentPageQuery["before"],
): Prisma.CommentWhereInput {
  if (!before) return {};
  return {
    OR: [
      { createdAt: { lt: before.createdAt } },
      { createdAt: before.createdAt, id: { lt: before.id } },
    ],
  };
}
