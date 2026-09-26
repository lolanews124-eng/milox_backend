import { unlink } from "node:fs/promises";

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../../../shared/errors/app-error.js";
import type { ReelService } from "../application/services/reel-service.js";

const createSchema = z.object({
  caption: z.string().trim().max(300).optional(),
  durationMs: z.coerce.number().int().min(0).max(180_000).optional(),
  posterMediaId: z.string().uuid().optional(),
});

const pageSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(24).default(8),
  scope: z.enum(["reels", "friends"]).default("reels"),
});

const reelIdSchema = z.object({ reelId: z.string().uuid() });
const usernameSchema = z.object({
  username: z.string().trim().min(1).max(32),
});

const commentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  parentId: z.string().uuid().optional(),
});

const commentPageSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});

const tagSchema = z.object({
  tag: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[\p{L}\p{N}_]+$/u),
});

export class ReelController {
  constructor(private readonly reels: ReelService) {}

  quota = async (request: Request, response: Response): Promise<void> => {
    const quota = await this.reels.quota(requireUser(request));
    response.status(200).json(success(request, quota));
  };

  ensureQuota = async (
    request: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.reels.assertEnabled();
    await this.reels.assertQuota(requireUser(request));
    next();
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const file = request.file;
    if (!file?.path) {
      throw new AppError("VALIDATION_ERROR", "Video file is required", 400, [
        { field: "file", issue: "required" },
      ]);
    }
    const body = createSchema.parse(request.body as unknown);
    try {
      const reel = await this.reels.create(requireUser(request), {
        tempPath: file.path,
        ...(body.caption !== undefined ? { caption: body.caption } : {}),
        ...(body.durationMs !== undefined ? { durationMs: body.durationMs } : {}),
        ...(body.posterMediaId !== undefined
          ? { posterMediaId: body.posterMediaId }
          : {}),
      });
      response.status(201).json(success(request, reel));
    } catch (error: unknown) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  };

  list = async (request: Request, response: Response): Promise<void> => {
    const query = pageSchema.parse(request.query);
    const page = await this.reels.list(requireUser(request), {
      limit: query.limit,
      friendsOnly: query.scope === "friends",
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

  save = async (request: Request, response: Response): Promise<void> => {
    const { reelId } = reelIdSchema.parse(request.params);
    const result = await this.reels.toggleSave(reelId, requireUser(request));
    response.status(200).json(success(request, result));
  };

  byUsername = async (request: Request, response: Response): Promise<void> => {
    const { username } = usernameSchema.parse(request.params);
    const query = pageSchema.parse(request.query);
    const page = await this.reels.listByUsername(username, requireUser(request), {
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

  view = async (request: Request, response: Response): Promise<void> => {
    const { reelId } = reelIdSchema.parse(request.params);
    const result = await this.reels.recordView(reelId, requireUser(request));
    response.status(200).json(success(request, result));
  };

  one = async (request: Request, response: Response): Promise<void> => {
    const { reelId } = reelIdSchema.parse(request.params);
    const reel = await this.reels.get(reelId, requireUser(request));
    response.status(200).json(success(request, reel));
  };

  byHashtag = async (request: Request, response: Response): Promise<void> => {
    const { tag } = tagSchema.parse(request.params);
    const query = pageSchema.parse(request.query);
    const page = await this.reels.listByHashtag(tag, requireUser(request), {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    response.status(200).json(pageResponse(request, page));
  };

  share = async (request: Request, response: Response): Promise<void> => {
    const { reelId } = reelIdSchema.parse(request.params);
    const result = await this.reels.share(reelId, requireUser(request));
    response.status(200).json(success(request, result));
  };

  like = async (request: Request, response: Response): Promise<void> => {
    const { reelId } = reelIdSchema.parse(request.params);
    const result = await this.reels.toggleLike(reelId, requireUser(request));
    response.status(200).json(success(request, result));
  };

  comments = async (request: Request, response: Response): Promise<void> => {
    const { reelId } = reelIdSchema.parse(request.params);
    const query = commentPageSchema.parse(request.query);
    const page = await this.reels.comments(reelId, requireUser(request), {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    response.status(200).json(pageResponse(request, page));
  };

  replies = async (request: Request, response: Response): Promise<void> => {
    const { commentId } = z.object({ commentId: z.string().uuid() }).parse(request.params);
    const query = commentPageSchema.parse(request.query);
    const page = await this.reels.replies(commentId, requireUser(request), {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    response.status(200).json(pageResponse(request, page));
  };

  addComment = async (request: Request, response: Response): Promise<void> => {
    const { reelId } = reelIdSchema.parse(request.params);
    const body = commentSchema.parse(request.body as unknown);
    const comment = await this.reels.addComment(
      reelId,
      requireUser(request),
      body.body,
      body.parentId,
    );
    response.status(201).json(success(request, comment));
  };

  removeComment = async (request: Request, response: Response): Promise<void> => {
    const params = z
      .object({ reelId: z.string().uuid(), commentId: z.string().uuid() })
      .parse(request.params);
    await this.reels.deleteComment(params.reelId, params.commentId, requireUser(request));
    response.status(204).send();
  };

  likeComment = async (request: Request, response: Response): Promise<void> => {
    const params = z
      .object({ reelId: z.string().uuid(), commentId: z.string().uuid() })
      .parse(request.params);
    const result = await this.reels.toggleCommentLike(
      params.reelId,
      params.commentId,
      requireUser(request),
    );
    response.status(200).json(success(request, result));
  };

  remove = async (request: Request, response: Response): Promise<void> => {
    const { reelId } = reelIdSchema.parse(request.params);
    await this.reels.remove(reelId, requireUser(request));
    response.status(204).send();
  };
}

function requireUser(request: Request): string {
  if (!request.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }
  return request.auth.userId;
}

function pageResponse(
  request: Request,
  page: { items: object[]; nextCursor: string | null; hasMore: boolean },
) {
  return {
    ...success(request, { items: page.items }),
    meta: {
      requestId: request.requestId,
      pagination: {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
    },
  };
}

function success(request: Request, data: object) {
  return {
    success: true,
    data,
    meta: { requestId: request.requestId },
  };
}
