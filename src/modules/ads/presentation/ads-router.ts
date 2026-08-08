import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { AdsController } from "./ads-controller.js";

export function createAdsRouter(
  controller: AdsController,
  optionalAuthenticate?: RequestHandler,
): Router {
  const router = Router();
  const readLimit = createRateLimit(120, 60_000);
  const trackLimit = createRateLimit(300, 60_000);

  if (optionalAuthenticate) {
    router.use(optionalAuthenticate);
  }

  router.get("/placements", readLimit, asyncHandler(controller.listPlacements));
  router.get("/", readLimit, asyncHandler(controller.listAds));
  router.get("/pick", readLimit, asyncHandler(controller.pickAd));
  router.post(
    "/:adId/impression",
    trackLimit,
    asyncHandler(controller.recordImpression),
  );
  router.post("/:adId/click", trackLimit, asyncHandler(controller.recordClick));

  return router;
}
