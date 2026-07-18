import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { FollowController } from "./follow-controller.js";

export interface FollowRouters {
  users: Router;
  requests: Router;
}

export function createFollowRouters(
  controller: FollowController,
  authenticate: RequestHandler,
  optionalAuthenticate: RequestHandler,
  requireVerified: RequestHandler,
): FollowRouters {
  const users = Router();
  const requests = Router();
  const followLimit = createRateLimit(60, 10 * 60 * 1000);
  const actionLimit = createRateLimit(120, 10 * 60 * 1000);

  users.put(
    "/:username/follow",
    authenticate,
    requireVerified,
    followLimit,
    asyncHandler(controller.follow),
  );
  users.delete(
    "/:username/follow",
    authenticate,
    actionLimit,
    asyncHandler(controller.unfollow),
  );
  users.get(
    "/:username/followers",
    optionalAuthenticate,
    asyncHandler(controller.listFollowers),
  );
  users.get(
    "/:username/following",
    optionalAuthenticate,
    asyncHandler(controller.listFollowing),
  );

  requests.get(
    "/",
    authenticate,
    asyncHandler(controller.listIncoming),
  );
  requests.post(
    "/:followId",
    authenticate,
    actionLimit,
    asyncHandler(controller.respond),
  );
  return { users, requests };
}
