import type { PrismaClient } from "@prisma/client";
import type { RequestHandler, Router } from "express";

import type { AppConfig } from "../../config/env.js";
import { VerifiedBadgeService } from "../premium/application/verified-badge-service.js";
import { CheckoutService } from "./application/checkout-service.js";
import { PaypalService } from "./application/paypal-service.js";
import { resolvePaypalCredentials } from "./application/paypal-settings.js";
import { resolveRazorpayCredentials } from "./application/razorpay-settings.js";
import { RazorpayService } from "./application/razorpay-service.js";
import { PaypalClient } from "./infrastructure/paypal-client.js";
import { RazorpayClient } from "./infrastructure/razorpay-client.js";
import { PaypalController } from "./presentation/paypal-controller.js";
import { createPaypalRouter } from "./presentation/paypal-router.js";

export interface PaymentsModule {
  router: Router;
  razorpayClient: RazorpayClient;
  paypalClient: PaypalClient;
  checkout: CheckoutService;
  razorpay: RazorpayService;
  paypal: PaypalService;
}

export function createPaymentsModule(
  config: AppConfig,
  database: PrismaClient,
  authenticate: RequestHandler,
  razorpayClient?: RazorpayClient,
  paypalClient?: PaypalClient,
): PaymentsModule {
  const rzp =
    razorpayClient ??
    new RazorpayClient(() => resolveRazorpayCredentials(database, config));
  const pp =
    paypalClient ??
    new PaypalClient(() => resolvePaypalCredentials(database, config));
  const paypal = new PaypalService(
    database,
    config,
    pp,
    new VerifiedBadgeService(database),
  );
  const razorpay = new RazorpayService(database, config, rzp, paypal);
  const checkout = new CheckoutService(database, config, razorpay, paypal);
  const controller = new PaypalController(checkout);
  return {
    router: createPaypalRouter(controller, authenticate),
    razorpayClient: rzp,
    paypalClient: pp,
    checkout,
    razorpay,
    paypal,
  };
}
