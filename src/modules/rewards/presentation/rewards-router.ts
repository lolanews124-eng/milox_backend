import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { RewardsController } from "./rewards-controller.js";

export function createRewardsRouter(
  controller: RewardsController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const rewardedAdLimit = createRateLimit(30, 10 * 60 * 1000);

  router.get("/wallet", authenticate, asyncHandler(controller.getWallet));
  router.post(
    "/wallet/rewarded-ad",
    authenticate,
    rewardedAdLimit,
    asyncHandler(controller.claimRewardedAd),
  );
  router.get(
    "/wallet/transactions",
    authenticate,
    asyncHandler(controller.listTransactions),
  );
  router.get("/referrals/me", authenticate, asyncHandler(controller.getReferrals));
  router.get(
    "/referrals/validate/:code",
    asyncHandler(controller.validateReferralCode),
  );

  return router;
}
