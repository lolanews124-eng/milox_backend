import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { PushDeviceController } from "./push-device-controller.js";

export function createPushDeviceRouter(
  controller: PushDeviceController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const writeLimit = createRateLimit(60, 10 * 60 * 1000);

  router.use(authenticate);
  router.put("/", writeLimit, asyncHandler(controller.upsert));
  router.delete("/", writeLimit, asyncHandler(controller.remove));
  return router;
}
