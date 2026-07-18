import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { ModerationService } from "../application/services/moderation-service.js";
import {
  blockPageQuerySchema,
  createReportSchema,
  usernameParamSchema,
} from "./moderation-schemas.js";

export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  block = async (request: Request, response: Response): Promise<void> => {
    const { username } = usernameParamSchema.parse(request.params);
    await this.moderation.block(username, requireUser(request));
    response.status(204).send();
  };

  unblock = async (request: Request, response: Response): Promise<void> => {
    const { username } = usernameParamSchema.parse(request.params);
    await this.moderation.unblock(username, requireUser(request));
    response.status(204).send();
  };

  listBlocks = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const query = blockPageQuerySchema.parse(request.query);
    const page = await this.moderation.listBlocks(requireUser(request), {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
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

  createReport = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = createReportSchema.parse(request.body as unknown);
    const data = await this.moderation.createReport(requireUser(request), {
      targetType: input.targetType,
      reportedUserId: input.reportedUserId ?? null,
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
      messageId: input.messageId ?? null,
      reasonCode: input.reasonCode,
      details: input.details ?? null,
    });
    response.status(201).json({
      success: true,
      data,
      meta: { requestId: request.requestId },
    });
  };
}

function requireUser(request: Request): string {
  if (!request.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }
  return request.auth.userId;
}
