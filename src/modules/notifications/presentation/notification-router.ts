import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { NotificationController } from "./notification-controller.js";

export function createNotificationRouter(
  controller: NotificationController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const readLimit = createRateLimit(120, 10 * 60 * 1000);
  router.use(authenticate);
  router.get("/", asyncHandler(controller.list));
  router.get("/unread-count", asyncHandler(controller.unreadCount));
  router.post("/read", readLimit, asyncHandler(controller.markRead));
  return router;
}
