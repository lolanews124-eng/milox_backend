import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../../../shared/errors/app-error.js";
import { discoverQuerySchema } from "./discover-query.js";
import { feedQuerySchema } from "./feed-query.js";
import type {
  FeedKind,
  FeedService,
} from "../application/services/feed-service.js";

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

  discover = async (request: Request, response: Response): Promise<void> => {
    if (!request.auth) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    const query = discoverQuerySchema.parse(request.query);
    const page = await this.feeds.getDiscoverPeople({
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      viewerId: request.auth.userId,
      ...(query.ageRange ? { ageRanges: query.ageRange } : {}),
      ...(query.gender ? { genders: query.gender } : {}),
      ...(query.country ? { countries: query.country } : {}),
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
  };

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
