import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { RequestHandler } from "express";

import { PremiumController } from "./presentation/premium-controller.js";
import { createPremiumRouter } from "./presentation/premium-router.js";

export interface PremiumModule {
  router: Router;
  controller: PremiumController;
}

export function createPremiumModule(
  database: PrismaClient,
  optionalAuthenticate?: RequestHandler,
): PremiumModule {
  const controller = new PremiumController(database);
  return {
    router: createPremiumRouter(controller, optionalAuthenticate),
    controller,
  };
}

export {
  resolveUserEntitlements,
  syncUserPremiumState,
  presentEntitlements,
  premiumBadgeForTier,
  type UserEntitlements,
  type PremiumFeatures,
} from "./application/entitlements.js";
