import {
  UserStatus,
  type PrismaClient,
  type UserRole,
} from "@prisma/client";
import type { RequestHandler } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import { asyncHandler } from "../../../shared/http/async-handler.js";

export function requireCurrentRole(
  database: PrismaClient,
  roles: readonly UserRole[],
): RequestHandler {
  return asyncHandler(async (request, _response, next) => {
    if (!request.auth) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    const staff = await database.user.findFirst({
      where: {
        id: request.auth.userId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        role: { in: [...roles] },
      },
      select: { id: true },
    });
    if (!staff) {
      throw new AppError(
        "FORBIDDEN",
        "Current staff role does not permit this action",
        403,
      );
    }
    next();
  });
}
