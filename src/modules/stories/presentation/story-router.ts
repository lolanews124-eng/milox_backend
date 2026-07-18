import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { StoryController } from "./story-controller.js";

export function createStoryRouter(
  controller: StoryController,
  authenticate: RequestHandler,
  requireVerified: RequestHandler,
): Router {
  const router = Router();
  const createLimit = createRateLimit(30, 10 * 60 * 1000);
  const actionLimit = createRateLimit(300, 10 * 60 * 1000);

  router.post(
    "/",
    authenticate,
    requireVerified,
    createLimit,
    asyncHandler(controller.create),
  );
  router.get("/feed", authenticate, asyncHandler(controller.feed));
  router.post(
    "/:storyId/view",
    authenticate,
    actionLimit,
    asyncHandler(controller.markViewed),
  );
  router.delete(
    "/:storyId",
    authenticate,
    actionLimit,
    asyncHandler(controller.remove),
  );
  return router;
}
