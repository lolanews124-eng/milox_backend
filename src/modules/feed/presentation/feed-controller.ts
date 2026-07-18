import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../../../shared/errors/app-error.js";
import type {
  FeedKind,
  FeedService,
} from "../application/services/feed-service.js";

const feedQuerySchema = z.object({
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const profilePassParamsSchema = z.object({
  userId: z.uuid(),
});

export class FeedController {
  constructor(private readonly feeds: FeedService) {}

  latest = (request: Request, response: Response): Promise<void> =>
    this.respond("latest", request, response);

  following = (request: Request, response: Response): Promise<void> =>
    this.respond("following", request, response);

  trending = (request: Request, response: Response): Promise<void> =>
    this.respond("trending", request, response);

  suggested = (request: Request, response: Response): Promise<void> =>
    this.respond("suggested", request, response);

  passedProfiles = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    if (!request.auth) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    const userIds = await this.feeds.getPassedProfileIds(request.auth.userId);
    response.status(200).json({
      success: true,
      data: { userIds },
      meta: { requestId: request.requestId },
    });
  };

  passProfile = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    if (!request.auth) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    const { userId } = profilePassParamsSchema.parse(request.params);
    await this.feeds.passProfile(request.auth.userId, userId);
    response.status(204).send();
  };

  private async respond(
    kind: FeedKind,
    request: Request,
    response: Response,
  ): Promise<void> {
    const query = feedQuerySchema.parse(request.query);
    const page = await this.feeds.getPage(kind, {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(request.auth ? { viewerId: request.auth.userId } : {}),
    });
    response.status(200).json({
      success: true,
      data: { items: page.items },
      meta: {
        requestId: request.requestId,
        pagination: {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        },
      },
    });
  }
}
