import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import type { PremiumController } from "./premium-controller.js";

export function createPremiumRouter(
  controller: PremiumController,
  optionalAuthenticate?: RequestHandler,
): Router {
  const router = Router();
  if (optionalAuthenticate) {
    router.use(optionalAuthenticate);
  }
  router.get("/plans", asyncHandler(controller.listPlans));
  return router;
}
