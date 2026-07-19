import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import type { FeedController } from "./feed-controller.js";

export function createFeedRouter(
  controller: FeedController,
  authenticate: RequestHandler,
  optionalAuthenticate: RequestHandler,
): Router {
  const router = Router();
  router.get(
    "/latest",
    optionalAuthenticate,
    asyncHandler(controller.latest),
  );
  router.get(
    "/following",
    authenticate,
    asyncHandler(controller.following),
  );
  router.get(
    "/trending",
    optionalAuthenticate,
    asyncHandler(controller.trending),
  );
  router.get(
    "/suggested",
    authenticate,
    asyncHandler(controller.suggested),
  );
  router.get(
    "/discover",
    authenticate,
    asyncHandler(controller.discover),
  );
  router.get(
    "/passes",
    authenticate,
    asyncHandler(controller.passedProfiles),
  );
  router.put(
    "/passes/:userId",
    authenticate,
    asyncHandler(controller.passProfile),
  );
  return router;
}
