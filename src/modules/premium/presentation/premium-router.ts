import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { PremiumController } from "./premium-controller.js";

export function createPremiumRouter(
  controller: PremiumController,
  options: {
    optionalAuthenticate?: RequestHandler | undefined;
    authenticate: RequestHandler;
  },
): Router {
  const router = Router();
  if (options.optionalAuthenticate) {
    router.use(options.optionalAuthenticate);
  }
  const buyLimit = createRateLimit(20, 10 * 60 * 1000);

  router.get("/plans", asyncHandler(controller.listPlans));
  router.get(
    "/verified-badge",
    options.authenticate,
    asyncHandler(controller.getVerifiedBadge),
  );
  router.post(
    "/verified-badge/purchase",
    options.authenticate,
    buyLimit,
    asyncHandler(controller.purchaseVerifiedBadge),
  );
  return router;
}
