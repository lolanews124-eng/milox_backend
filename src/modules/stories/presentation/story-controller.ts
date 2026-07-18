import type { Request, Response } from "express";
import { z } from "zod";

import { AppError } from "../../../shared/errors/app-error.js";
import type { StoryService } from "../application/services/story-service.js";

const createStorySchema = z.object({
  mediaId: z.uuid(),
  caption: z.string().trim().max(200).optional(),
});

const storyIdParamSchema = z.object({
  storyId: z.uuid(),
});

export class StoryController {
  constructor(private readonly stories: StoryService) {}

  create = async (request: Request, response: Response): Promise<void> => {
    const input = createStorySchema.parse(request.body as unknown);
    const story = await this.stories.create(requireUser(request), input);
    response.status(201).json(success(request, story));
  };

  feed = async (request: Request, response: Response): Promise<void> => {
    const result = await this.stories.feed(requireUser(request));
    response.status(200).json(success(request, result));
  };

  markViewed = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { storyId } = storyIdParamSchema.parse(request.params);
    await this.stories.markViewed(storyId, requireUser(request));
    response.status(204).send();
  };

  remove = async (request: Request, response: Response): Promise<void> => {
    const { storyId } = storyIdParamSchema.parse(request.params);
    await this.stories.remove(storyId, requireUser(request));
    response.status(204).send();
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
