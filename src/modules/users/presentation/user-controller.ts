import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { UserService } from "../application/services/user-service.js";
import {
  changePasswordSchema,
  privacySettingsSchema,
  searchUsersQuerySchema,
  updateProfileSchema,
  usernameParamSchema,
} from "./user-schemas.js";

export class UserController {
  constructor(private readonly users: UserService) {}

  getMe = async (request: Request, response: Response): Promise<void> => {
    const userId = requireUserId(request);
    response.status(200).json(
      successEnvelope(
        request,
        await this.users.getMe(userId),
      ),
    );
  };

  getPublicProfile = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const { username } = usernameParamSchema.parse(request.params);
    const profile = await this.users.getPublicProfile(
      username,
      request.auth?.userId,
    );
    response.status(200).json(successEnvelope(request, profile));
  };

  search = async (request: Request, response: Response): Promise<void> => {
    const query = searchUsersQuerySchema.parse(request.query);
    const page = await this.users.search(query.q, {
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(request.auth ? { viewerId: request.auth.userId } : {}),
    });
    response.status(200).json({
      ...successEnvelope(request, { items: page.items }),
      meta: {
        requestId: request.requestId,
        pagination: {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        },
      },
    });
  };

  updateProfile = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = updateProfileSchema.parse(request.body);
    const profile = await this.users.updateProfile(requireUserId(request), input);
    response.status(200).json(successEnvelope(request, profile));
  };

  updatePrivacy = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = privacySettingsSchema.parse(request.body);
    const profile = await this.users.updatePrivacy(requireUserId(request), input);
    response.status(200).json(successEnvelope(request, profile));
  };

  changePassword = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const input = changePasswordSchema.parse(request.body);
    await this.users.changePassword(
      requireUserId(request),
      input.currentPassword,
      input.newPassword,
    );
    response.status(200).json({
      success: true,
      data: { message: "Password changed; please log in again" },
      meta: { requestId: request.requestId },
    });
  };

  deleteAccount = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    await this.users.deleteAccount(requireUserId(request));
    response.status(204).send();
  };
}

function requireUserId(request: Request): string {
  if (!request.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }
  return request.auth.userId;
}

function successEnvelope(request: Request, data: object): object {
  return {
    success: true,
    data,
    meta: { requestId: request.requestId },
  };
}
