import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import type { RewardsController } from "./rewards-controller.js";

export function createRewardsRouter(
  controller: RewardsController,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.get("/wallet", authenticate, asyncHandler(controller.getWallet));
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
