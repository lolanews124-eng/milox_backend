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

  router.post(
    "/checkout",
    authenticate,
    buyLimit,
    asyncHandler(controller.createCheckout),
  );
  router.post(
    "/paypal/orders",
    authenticate,
    buyLimit,
    asyncHandler(controller.createCheckout),
  );
  router.post(
    "/razorpay/orders",
    authenticate,
    buyLimit,
    asyncHandler(controller.createCheckout),
  );

  router.post(
    "/razorpay/verify",
    authenticate,
    buyLimit,
    asyncHandler(controller.verifyRazorpay),
  );
  router.post(
    "/checkout/verify",
    authenticate,
    buyLimit,
    asyncHandler(controller.verifyRazorpay),
  );

  router.post(
    "/paypal/capture",
    authenticate,
    buyLimit,
    asyncHandler(controller.capturePaypal),
  );
  router.post(
    "/checkout/capture",
    authenticate,
    buyLimit,
    asyncHandler(controller.capturePaypal),
  );

  router.post(
    "/checkout/cancel",
    authenticate,
    buyLimit,
    asyncHandler(controller.markCancelled),
  );

  router.post(
    "/razorpay/webhook",
    webhookLimit,
    asyncHandler(controller.razorpayWebhook),
  );
  router.post(
    "/paypal/webhook",
    webhookLimit,
    asyncHandler(controller.paypalWebhook),
  );

  return router;
}
