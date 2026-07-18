import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { CommentService } from "../application/services/comment-service.js";
import {
  commentIdParamSchema,
  commentPageQuerySchema,
  createCommentSchema,
  postIdParamSchema,
} from "./comment-schemas.js";

export class CommentController {
  constructor(private readonly comments: CommentService) {}

  create = async (request: Request, response: Response): Promise<void> => {
    const { postId } = postIdParamSchema.parse(request.params);
    const input = createCommentSchema.parse(request.body as unknown);
    const comment = await this.comments.create(
      postId,
      requireUser(request),
      input,
    );
    response.status(201).json(success(request, comment));
  };

  listTopLevel = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { postId } = postIdParamSchema.parse(request.params);
    const page = await this.comments.listTopLevel(
      postId,
      pageOptions(request),
    );
    response.status(200).json(pageSuccess(request, page));
  };

  listReplies = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { commentId } = commentIdParamSchema.parse(request.params);
    const page = await this.comments.listReplies(
      commentId,
      pageOptions(request),
    );
    response.status(200).json(pageSuccess(request, page));
  };

  delete = async (request: Request, response: Response): Promise<void> => {
    const { commentId } = commentIdParamSchema.parse(request.params);
    await this.comments.delete(commentId, requireUser(request));
    response.status(204).send();
  };

  like = (request: Request, response: Response): Promise<void> =>
    this.likeAction("like", request, response);

  unlike = (request: Request, response: Response): Promise<void> =>
    this.likeAction("unlike", request, response);

  private async likeAction(
    action: "like" | "unlike",
    request: Request,
    response: Response,
  ): Promise<void> {
    const { commentId } = commentIdParamSchema.parse(request.params);
    const comment = await this.comments[action](
      commentId,
      requireUser(request),
    );
    response.status(200).json(success(request, comment));
  }
}

function pageOptions(request: Request) {
  const query = commentPageQuerySchema.parse(request.query);
  return {
    limit: query.limit,
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(request.auth ? { viewerId: request.auth.userId } : {}),
  };
}

function pageSuccess(
  request: Request,
  page: { items: object[]; nextCursor: string | null; hasMore: boolean },
) {
  return {
    success: true,
    data: { items: page.items },
    meta: {
      requestId: request.requestId,
      pagination: {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
    },
  };
}

function requireUser(request: Request): string {
  if (!request.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }
  return request.auth.userId;
}

function success(request: Request, data: object) {
  return {
    success: true,
    data,
    meta: { requestId: request.requestId },
  };
}
