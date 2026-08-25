import { Router, type RequestHandler } from "express";

import { asyncHandler } from "../../../shared/http/async-handler.js";
import { createRateLimit } from "../../../shared/http/rate-limit.js";
import type { PaypalController } from "./paypal-controller.js";

export function createPaypalRouter(
  controller: PaypalController,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const buyLimit = createRateLimit(20, 10 * 60 * 1000);
  const webhookLimit = createRateLimit(120, 10 * 60 * 1000);

  router.get(
    "/checkout-options",
    authenticate,
    asyncHandler(controller.getOptions),
  );

  // Gateway-agnostic create (routes India→Cashfree, else→PayPal).
  router.post(
    "/checkout",
    authenticate,
    buyLimit,
    asyncHandler(controller.createCheckout),
  );
  // Keep legacy PayPal path for older app builds.
  router.post(
    "/paypal/orders",
    authenticate,
    buyLimit,
    asyncHandler(controller.createCheckout),
  );
  router.post(
    "/paypal/capture",
    buyLimit,
    asyncHandler(controller.captureCheckout),
  );
  router.post(
    "/checkout/capture",
    buyLimit,
    asyncHandler(controller.captureCheckout),
  );
  router.post(
    "/checkout/cancel",
    authenticate,
    buyLimit,
    asyncHandler(controller.markCancelled),
  );
  router.post(
    "/paypal/webhook",
    webhookLimit,
    asyncHandler(controller.webhook),
  );
  router.post(
    "/cashfree/webhook",
    webhookLimit,
    asyncHandler(controller.cashfreeWebhook),
  );
  return router;
}
