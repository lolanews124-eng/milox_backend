import type { Request, Response } from "express";
import { PremiumBillingCycle } from "@prisma/client";

import { AppError } from "../../../shared/errors/app-error.js";
import type { CheckoutService } from "../application/checkout-service.js";
import {
  createPaypalCheckoutSchema,
  markCheckoutSchema,
  verifyRazorpaySchema,
} from "./paypal-schemas.js";

export class PaypalController {
  constructor(private readonly checkout: CheckoutService) {}

  getOptions = async (request: Request, response: Response): Promise<void> => {
    const userId = request.auth?.userId;
    if (!userId) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    const data = await this.checkout.getOptions(userId);
    response.status(200).json({
      success: true,
      data,
      meta: { requestId: request.requestId },
    });
  };

  createCheckout = async (request: Request, response: Response): Promise<void> => {
    const userId = request.auth?.userId;
    if (!userId) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    const input = createPaypalCheckoutSchema.parse(request.body as unknown);
    const data =
      input.kind === "POINT_PACK"
        ? await this.checkout.createCheckout(userId, {
            kind: "POINT_PACK",
            packId: input.packId,
          })
        : input.kind === "PREMIUM"
          ? await this.checkout.createCheckout(userId, {
              kind: "PREMIUM",
              planId: input.planId,
              billingCycle: input.billingCycle as PremiumBillingCycle,
            })
          : await this.checkout.createCheckout(userId, { kind: "VERIFIED_BADGE" });
    response.status(200).json({
      success: true,
      data,
      meta: { requestId: request.requestId },
    });
  };

  verifyRazorpay = async (request: Request, response: Response): Promise<void> => {
    const userId = request.auth?.userId;
    const input = verifyRazorpaySchema.parse(request.body as unknown);
    const data = await this.checkout.verifyRazorpayPayment({
      orderId: input.orderId,
      paymentId: input.paymentId,
      signature: input.signature,
      ...(userId ? { userId } : {}),
    });
    response.status(200).json({
      success: true,
      data,
      meta: { requestId: request.requestId },
    });
  };

  markCancelled = async (request: Request, response: Response): Promise<void> => {
    const userId = request.auth?.userId;
    const input = markCheckoutSchema.parse(request.body as unknown);
    const orderId =
      input.paypalOrderId || input.providerOrderId || input.razorpay_order_id;
    if (!orderId) {
      throw new AppError("VALIDATION_ERROR", "Order id required", 400);
    }
    const data = await this.checkout.markCancelled(orderId, userId);
    response.status(200).json({
      success: true,
      data,
      meta: { requestId: request.requestId },
    });
  };

  razorpayWebhook = async (request: Request, response: Response): Promise<void> => {
    const raw =
      (request as Request & { rawBody?: string }).rawBody ??
      (typeof request.body === "string"
        ? request.body
        : Buffer.isBuffer(request.body)
          ? request.body.toString("utf8")
          : JSON.stringify(request.body ?? {}));
    const signature = String(request.header("x-razorpay-signature") ?? "");
    await this.checkout.handleRazorpayWebhook(raw, signature);
    response.status(200).json({ success: true });
  };
}
