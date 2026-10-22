import { UserRole, type PrismaClient } from "@prisma/client";
import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { requireCurrentRole } from "../../admin/presentation/admin-authorization.js";
import type { BotsController } from "./bots-controller.js";

/** Bot management is restricted to ADMIN and SUPER_ADMIN (not MODERATOR). */
const botAdmins = [UserRole.ADMIN, UserRole.SUPER_ADMIN] as const;

export function createBotsRouter(
  controller: BotsController,
  database: PrismaClient,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const adminOnly = requireCurrentRole(database, botAdmins);

  router.use(authenticate);
  router.use(adminOnly);

  router.get("/metrics", asyncHandler(controller.metrics));
  router.get("/settings", asyncHandler(controller.getSettings));
  router.patch("/settings", asyncHandler(controller.updateSettings));
  router.get("/jobs", asyncHandler(controller.listJobs));
  router.post("/jobs/preview", asyncHandler(controller.previewJobs));
  router.post("/jobs/:jobId/cancel", asyncHandler(controller.cancelJob));
  router.post("/jobs/:jobId/retry", asyncHandler(controller.retryJob));
  router.get("/audit", asyncHandler(controller.listAudit));
  router.post(
    "/candidates/preview",
    asyncHandler(controller.previewCandidates),
  );
  router.get(
    "/candidates/batches/:batchId",
    asyncHandler(controller.getCandidateBatch),
  );
  router.patch(
    "/candidates/batches/:batchId/selection",
    asyncHandler(controller.lockSelection),
  );
  router.post(
    "/candidates/batches/:batchId/provision",
    asyncHandler(controller.provision),
  );
  router.get("/", asyncHandler(controller.listBots));
  router.get("/:botId", asyncHandler(controller.getBot));
  router.patch("/:botId", asyncHandler(controller.updateBotStatus));

  return router;
}
