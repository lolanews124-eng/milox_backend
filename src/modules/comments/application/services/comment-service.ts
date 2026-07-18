import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type { FeedCursorCodec } from "../../../feed/application/services/feed-cursor.js";
import type {
  CommentPageQuery,
  CommentRepository,
} from "../ports/comment-repository.js";
import {
  CommentActionConflictError,
  CommentDepthError,
  ParentCommentNotFoundError,
} from "../ports/comment-repository.js";
import { presentComment } from "../comment-view.js";

export interface CommentPage {
  items: object[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class CommentService {
  constructor(
    private readonly repository: CommentRepository,
    private readonly cursors: FeedCursorCodec,
    private readonly config: AppConfig,
  ) {}

  async create(
    postId: string,
    authorId: string,
    input: { body: string; parentId?: string | null | undefined },
  ): Promise<object> {
    const body = input.body.trim();
    if (!body) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Comment body cannot be blank",
        400,
      );
    }
    try {
      const comment = await this.repository.create({
        postId,
        authorId,
        body,
        ...(input.parentId ? { parentId: input.parentId } : {}),
      });
      if (!comment) throw postNotFound();
      return presentComment(comment, this.config);
    } catch (error) {
      if (error instanceof ParentCommentNotFoundError) {
        throw commentNotFound();
      }
      if (error instanceof CommentDepthError) {
        throw new AppError(
          "COMMENT_DEPTH_EXCEEDED",
          "Replies may only be one level deep",
          422,
        );
      }
      throw error;
    }
  }

  listTopLevel(
    postId: string,
    options: { viewerId?: string; cursor?: string; limit: number },
  ): Promise<CommentPage> {
    return this.list(
      options,
      (query) => this.repository.listTopLevel(postId, query),
      postNotFound,
    );
  }

  listReplies(
    parentId: string,
    options: { viewerId?: string; cursor?: string; limit: number },
  ): Promise<CommentPage> {
    return this.list(
      options,
      (query) => this.repository.listReplies(parentId, query),
      commentNotFound,
    );
  }

  async delete(commentId: string, actorId: string): Promise<void> {
    if (!(await this.repository.softDelete(commentId, actorId))) {
      throw commentNotFound();
    }
  }

  like(commentId: string, userId: string): Promise<object> {
    return this.mutateLike(commentId, userId, "like");
  }

  unlike(commentId: string, userId: string): Promise<object> {
    return this.mutateLike(commentId, userId, "unlike");
  }

  private async list(
    options: { viewerId?: string; cursor?: string; limit: number },
    fetch: (query: CommentPageQuery) => ReturnType<
      CommentRepository["listTopLevel"]
    >,
    notFound: () => AppError,
  ): Promise<CommentPage> {
    const cursor = options.cursor
      ? this.cursors.decode(options.cursor)
      : undefined;
    if (cursor && cursor.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "This cursor cannot be used for comments",
        400,
      );
    }
    const rows = await fetch({
      limit: options.limit,
      ...(options.viewerId ? { viewerId: options.viewerId } : {}),
      ...(cursor
        ? {
            before: {
              id: cursor.id,
              createdAt: new Date(cursor.createdAt),
            },
          }
        : {}),
    });
    if (!rows) throw notFound();

    const hasMore = rows.length > options.limit;
    const pageRows = rows.slice(0, options.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((comment) =>
        presentComment(comment, this.config),
      ),
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.id,
              createdAt: last.createdAt.toISOString(),
            })
          : null,
      hasMore,
    };
  }

  private async mutateLike(
    commentId: string,
    userId: string,
    action: "like" | "unlike",
  ): Promise<object> {
    try {
      const comment = await this.repository[action](commentId, userId);
      if (!comment) throw commentNotFound();
      return presentComment(comment, this.config);
    } catch (error) {
      if (error instanceof CommentActionConflictError) {
        throw new AppError(
          error.message === "already_liked" ? "ALREADY_LIKED" : "NOT_LIKED",
          "The comment like action conflicts with its current state",
          409,
        );
      }
      throw error;
    }
  }
}

function postNotFound(): AppError {
  return new AppError("POST_NOT_FOUND", "Post not found", 404);
}

function commentNotFound(): AppError {
  return new AppError("COMMENT_NOT_FOUND", "Comment not found", 404);
}
