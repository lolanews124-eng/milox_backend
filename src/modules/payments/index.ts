import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { VerifiedBadgeService } from "../premium/application/verified-badge-service.js";
import { CheckoutService } from "./application/checkout-service.js";
import { PaypalService } from "./application/paypal-service.js";
import { resolveRazorpayCredentials } from "./application/razorpay-settings.js";
import { RazorpayService } from "./application/razorpay-service.js";
import { RazorpayClient } from "./infrastructure/razorpay-client.js";
import { PaypalController } from "./presentation/paypal-controller.js";
import { createPaypalRouter } from "./presentation/paypal-router.js";

export interface PaymentsModule {
  router: Router;
  razorpayClient: RazorpayClient;
  checkout: CheckoutService;
  razorpay: RazorpayService;
}

export function createPaymentsModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
  razorpayClient?: RazorpayClient,
): PaymentsModule {
  const client =
    razorpayClient ??
    new RazorpayClient(() => resolveRazorpayCredentials(database, config));
  // PaypalService is retained only as the shared prepare/fulfill ledger.
  const ledger = new PaypalService(
    database,
    config,
    // Dummy client — ledger methods used here do not call PayPal APIs.
    {
      requireConfigured: async () => {
        throw new Error("PayPal removed");
      },
      isConfigured: async () => false,
      createOrder: async () => {
        throw new Error("PayPal removed");
      },
      capturePaidOrder: async () => {
        throw new Error("PayPal removed");
      },
      verifyWebhook: async () => false,
    } as never,
    new VerifiedBadgeService(database),
  );
  const razorpay = new RazorpayService(database, config, client, ledger);
  const checkout = new CheckoutService(database, config, razorpay);
  const controller = new PaypalController(checkout);
  return {
    router: createPaypalRouter(controller, authenticate),
    razorpayClient: client,
    checkout,
    razorpay,
  };
}
