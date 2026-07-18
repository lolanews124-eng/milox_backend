import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { InterestController } from "./interest-controller.js";

export interface InterestRouters {
  interests: Router;
  matches: Router;
}

export function createInterestRouters(
  controller: InterestController,
  authenticate: RequestHandler,
  requireVerified: RequestHandler,
): InterestRouters {
  const interests = Router();
  const matches = Router();
  const sendLimit = createRateLimit(30, 60 * 60 * 1000);
  const actionLimit = createRateLimit(60, 10 * 60 * 1000);

  interests.post(
    "/",
    authenticate,
    requireVerified,
    sendLimit,
    asyncHandler(controller.create),
  );
  interests.get(
    "/incoming",
    authenticate,
    asyncHandler(controller.listIncoming),
  );
  interests.get(
    "/outgoing",
    authenticate,
    asyncHandler(controller.listOutgoing),
  );
  interests.post(
    "/:interestId/accept",
    authenticate,
    requireVerified,
    actionLimit,
    asyncHandler(controller.accept),
  );
  interests.post(
    "/:interestId/reject",
    authenticate,
    requireVerified,
    actionLimit,
    asyncHandler(controller.reject),
  );
  interests.post(
    "/:interestId/cancel",
    authenticate,
    requireVerified,
    actionLimit,
    asyncHandler(controller.cancel),
  );

  matches.get("/", authenticate, asyncHandler(controller.listMatches));
  matches.delete(
    "/:matchId",
    authenticate,
    actionLimit,
    asyncHandler(controller.unmatch),
  );
  return { interests, matches };
}
