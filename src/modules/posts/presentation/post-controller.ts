import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { PostService } from "../application/services/post-service.js";
import {
  createPostSchema,
  hashtagParamSchema,
  hashtagSearchQuerySchema,
  idempotencyKeySchema,
  postIdParamSchema,
  postPageQuerySchema,
  reportPostSchema,
  trendingHashtagsQuerySchema,
  updatePostSchema,
  usernameParamSchema,
} from "./post-schemas.js";

export class PostController {
  constructor(private readonly posts: PostService) {}

  create = async (request: Request, response: Response): Promise<void> => {
    const input = createPostSchema.parse(request.body as unknown);
    const idempotencyKey = idempotencyKeySchema.parse(
      request.header("Idempotency-Key"),
    );
    const result = await this.posts.create(
      requireUser(request),
      input,
      idempotencyKey,
    );
    response
      .status(201)
      .set("Idempotency-Replayed", String(result.replayed))
      .json(success(request, result.item));
  };

  get = async (request: Request, response: Response): Promise<void> => {
    const { postId } = postIdParamSchema.parse(request.params);
    const item = await this.posts.get(postId, request.auth?.userId);
    response.status(200).json(success(request, item));
  };

  listByUsername = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { username } = usernameParamSchema.parse(request.params);
    const query = postPageQuerySchema.parse(request.query);
    const page = await this.posts.listByUsername(username, {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(request.auth ? { viewerId: request.auth.userId } : {}),
    });
    response.status(200).json({
      ...success(request, { items: page.items }),
      meta: {
        requestId: request.requestId,
        pagination: {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        },
      },
    });
  };

  listSaved = async (request: Request, response: Response): Promise<void> => {
    const query = postPageQuerySchema.parse(request.query);
    const page = await this.posts.listSaved(requireUser(request), {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    response.status(200).json({
      ...success(request, { items: page.items }),
      meta: {
        requestId: request.requestId,
        pagination: {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        },
      },
    });
  };

  listTrendingHashtags = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { limit } = trendingHashtagsQuerySchema.parse(request.query);
    const items = await this.posts.listTrendingHashtags(limit);
    response.status(200).json(success(request, { items }));
  };

  searchHashtags = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { q, limit } = hashtagSearchQuerySchema.parse(request.query);
    const items = await this.posts.searchHashtags(q, limit);
    response.status(200).json(success(request, { items }));
  };

  listByHashtag = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { tag } = hashtagParamSchema.parse(request.params);
    const query = postPageQuerySchema.parse(request.query);
    const [hashtag, page] = await Promise.all([
      this.posts.getHashtag(tag),
      this.posts.listByHashtag(tag, {
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(request.auth ? { viewerId: request.auth.userId } : {}),
      }),
    ]);
    response.status(200).json({
      ...success(request, {
        tag,
        postCount: hashtag.postCount,
        items: page.items,
      }),
      meta: {
        requestId: request.requestId,
        pagination: {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        },
      },
    });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const { postId } = postIdParamSchema.parse(request.params);
    const input = updatePostSchema.parse(request.body as unknown);
    const item = await this.posts.update(postId, requireUser(request), input);
    response.status(200).json(success(request, item));
  };

  delete = async (request: Request, response: Response): Promise<void> => {
    const { postId } = postIdParamSchema.parse(request.params);
    await this.posts.delete(postId, requireUser(request));
    response.status(204).send();
  };

  like = (request: Request, response: Response): Promise<void> =>
    this.action("like", request, response);

  unlike = (request: Request, response: Response): Promise<void> =>
    this.action("unlike", request, response);

  save = (request: Request, response: Response): Promise<void> =>
    this.action("save", request, response);

  unsave = (request: Request, response: Response): Promise<void> =>
    this.action("unsave", request, response);

  share = (request: Request, response: Response): Promise<void> =>
    this.action("share", request, response);

  report = async (request: Request, response: Response): Promise<void> => {
    const { postId } = postIdParamSchema.parse(request.params);
    const input = reportPostSchema.parse(request.body as unknown);
    const report = await this.posts.report(
      postId,
      requireUser(request),
      input,
    );
    response.status(201).json(success(request, report));
  };

  private async action(
    action: "like" | "unlike" | "save" | "unsave" | "share",
    request: Request,
    response: Response,
  ): Promise<void> {
    const { postId } = postIdParamSchema.parse(request.params);
    const item = await this.posts[action](postId, requireUser(request));
    if (action === "save" || action === "unsave") {
      response.status(204).send();
      return;
    }
    response
      .status(action === "share" ? 201 : 200)
      .json(success(request, item));
  }
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
