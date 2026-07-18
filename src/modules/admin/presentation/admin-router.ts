import {
  UserRole,
  type PrismaClient,
} from "@prisma/client";
import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import { requireCurrentRole } from "./admin-authorization.js";
import type { AdminController } from "./admin-controller.js";

export function createAdminRouter(
  controller: AdminController,
  database: PrismaClient,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const adminOnly = requireCurrentRole(database, [
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ]);
  const moderationStaff = requireCurrentRole(database, [
    UserRole.MODERATOR,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ]);
  const readLimit = createRateLimit(300, 10 * 60 * 1_000);
  const mutationLimit = createRateLimit(60, 10 * 60 * 1_000);

  router.use(authenticate);
  router.get(
    "/dashboard",
    readLimit,
    adminOnly,
    asyncHandler(controller.dashboard),
  );
  router.get(
    "/users",
    readLimit,
    adminOnly,
    asyncHandler(controller.listUsers),
  );
  router.patch(
    "/users/:userId/status",
    mutationLimit,
    adminOnly,
    asyncHandler(controller.changeUserStatus),
  );
  router.get(
    "/reports",
    readLimit,
    moderationStaff,
    asyncHandler(controller.listReports),
  );
  router.post(
    "/reports/:reportId/resolve",
    mutationLimit,
    moderationStaff,
    asyncHandler(controller.resolveReport),
  );
  return router;
}
