import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { VerifiedBadgeService } from "../premium/application/verified-badge-service.js";
import { resolvePaypalCredentials } from "./application/paypal-settings.js";
import { PaypalService } from "./application/paypal-service.js";
import { PaypalClient } from "./infrastructure/paypal-client.js";
import { PaypalController } from "./presentation/paypal-controller.js";
import { createPaypalRouter } from "./presentation/paypal-router.js";

export interface PaymentsModule {
  router: Router;
  paypalClient: PaypalClient;
}

export function createPaymentsModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
  paypalClient?: PaypalClient,
): PaymentsModule {
  const client =
    paypalClient ??
    new PaypalClient(() => resolvePaypalCredentials(database, config));
  const service = new PaypalService(
    database,
    config,
    client,
    new VerifiedBadgeService(database),
  );
  const controller = new PaypalController(service);
  return {
    router: createPaypalRouter(controller, authenticate),
    paypalClient: client,
  };
}
