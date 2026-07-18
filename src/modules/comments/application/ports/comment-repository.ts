import type { CommentViewRecord } from "../comment-view.js";

export interface CommentPageQuery {
  viewerId?: string;
  limit: number;
  before?: { id: string; createdAt: Date };
}

export interface CreateCommentData {
  postId: string;
  authorId: string;
  body: string;
  parentId?: string;
}

export interface CommentRepository {
  create(data: CreateCommentData): Promise<CommentViewRecord | null>;
  listTopLevel(
    postId: string,
    query: CommentPageQuery,
  ): Promise<CommentViewRecord[] | null>;
  listReplies(
    parentId: string,
    query: CommentPageQuery,
  ): Promise<CommentViewRecord[] | null>;
  softDelete(commentId: string, actorId: string): Promise<boolean>;
  like(commentId: string, userId: string): Promise<CommentViewRecord | null>;
  unlike(commentId: string, userId: string): Promise<CommentViewRecord | null>;
}

export class CommentDepthError extends Error {}
export class ParentCommentNotFoundError extends Error {}
export class CommentActionConflictError extends Error {}
