import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { NotificationService } from "../application/services/notification-service.js";
import {
  markNotificationsReadSchema,
  notificationPageQuerySchema,
} from "./notification-schemas.js";

export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const query = notificationPageQuerySchema.parse(request.query);
    const page = await this.notifications.list(requireUser(request), {
      unreadOnly: query.unreadOnly,
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

  unreadCount = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const data = await this.notifications.unreadCount(requireUser(request));
    response.status(200).json(success(request, data));
  };

  markRead = async (request: Request, response: Response): Promise<void> => {
    const input = markNotificationsReadSchema.parse(
      request.body as unknown,
    );
    await this.notifications.markRead(requireUser(request), {
      all: input.all ?? false,
      ids: input.ids ?? [],
    });
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
