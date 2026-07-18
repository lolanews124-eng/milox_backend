import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { ModerationController } from "./moderation-controller.js";

export interface ModerationRouters {
  userBlocks: Router;
  blocks: Router;
  reports: Router;
}

export function createModerationRouters(
  controller: ModerationController,
  authenticate: RequestHandler,
): ModerationRouters {
  const userBlocks = Router();
  const blocks = Router();
  const reports = Router();
  const blockLimit = createRateLimit(60, 10 * 60 * 1_000);
  const reportLimit = createRateLimit(20, 24 * 60 * 60 * 1_000);

  userBlocks.put(
    "/:username/block",
    authenticate,
    blockLimit,
    asyncHandler(controller.block),
  );
  userBlocks.delete(
    "/:username/block",
    authenticate,
    blockLimit,
    asyncHandler(controller.unblock),
  );

  blocks.get("/", authenticate, asyncHandler(controller.listBlocks));
  reports.post(
    "/",
    authenticate,
    reportLimit,
    asyncHandler(controller.createReport),
  );

  return { userBlocks, blocks, reports };
}
