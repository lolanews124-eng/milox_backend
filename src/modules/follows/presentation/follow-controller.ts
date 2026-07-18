import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { FollowService } from "../application/services/follow-service.js";
import {
  followIdParamSchema,
  followPageQuerySchema,
  respondFollowSchema,
  usernameParamSchema,
} from "./follow-schemas.js";

export class FollowController {
  constructor(private readonly follows: FollowService) {}

  follow = (request: Request, response: Response): Promise<void> =>
    this.change("follow", request, response);

  unfollow = (request: Request, response: Response): Promise<void> =>
    this.change("unfollow", request, response);

  listFollowers = (request: Request, response: Response): Promise<void> =>
    this.listUsers("followers", request, response);

  listFollowing = (request: Request, response: Response): Promise<void> =>
    this.listUsers("following", request, response);

  listIncoming = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = followPageQuerySchema.parse(request.query);
    const page = await this.follows.listIncoming(requireUser(request), {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    response.status(200).json(pageSuccess(request, page));
  };

  respond = async (request: Request, response: Response): Promise<void> => {
    const { followId } = followIdParamSchema.parse(request.params);
    const { action } = respondFollowSchema.parse(request.body as unknown);
    const result = await this.follows.respond(
      followId,
      requireUser(request),
      action,
    );
    response.status(200).json(success(request, result));
  };

  private async change(
    action: "follow" | "unfollow",
    request: Request,
    response: Response,
  ): Promise<void> {
    const { username } = usernameParamSchema.parse(request.params);
    const state = await this.follows[action](username, requireUser(request));
    response.status(200).json(success(request, state));
  }

  private async listUsers(
    direction: "followers" | "following",
    request: Request,
    response: Response,
  ): Promise<void> {
    const { username } = usernameParamSchema.parse(request.params);
    const query = followPageQuerySchema.parse(request.query);
    const page = await this.follows[
      direction === "followers" ? "listFollowers" : "listFollowing"
    ](username, {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(request.auth ? { viewerId: request.auth.userId } : {}),
    });
    response.status(200).json(pageSuccess(request, page));
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
