import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { RequestHandler } from "express";

import { PremiumController } from "./presentation/premium-controller.js";
import { createPremiumRouter } from "./presentation/premium-router.js";
import { VerifiedBadgeService } from "./application/verified-badge-service.js";

export interface PremiumModule {
  router: Router;
  controller: PremiumController;
}

export function createPremiumModule(
  database: PrismaClient,
  optionalAuthenticate: RequestHandler | undefined,
  authenticate: RequestHandler,
): PremiumModule {
  const verifiedBadge = new VerifiedBadgeService(database);
  const controller = new PremiumController(database, verifiedBadge);
  return {
    router: createPremiumRouter(controller, {
      optionalAuthenticate,
      authenticate,
    }),
    controller,
  };
}

export {
  resolveUserEntitlements,
  syncUserPremiumState,
  expireStandaloneVerifiedBadges,
  presentEntitlements,
  premiumBadgeForTier,
  type UserEntitlements,
  type PremiumFeatures,
} from "./application/entitlements.js";
export { VerifiedBadgeService } from "./application/verified-badge-service.js";
