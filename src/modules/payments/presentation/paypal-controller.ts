import type { Request, Response } from "express";
import { PremiumBillingCycle } from "@prisma/client";

import { AppError } from "../../../shared/errors/app-error.js";
import type { CheckoutService } from "../application/checkout-service.js";
import type { PaypalService } from "../application/paypal-service.js";
import {
  capturePaypalCheckoutSchema,
  createPaypalCheckoutSchema,
  markCheckoutSchema,
} from "./paypal-schemas.js";

export class PaypalController {
  constructor(
    private readonly paypal: PaypalService,
    private readonly checkout: CheckoutService,
  ) {}

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

  captureCheckout = async (request: Request, response: Response): Promise<void> => {
    const input = capturePaypalCheckoutSchema.parse(request.body as unknown);
    const orderId = input.paypalOrderId || input.providerOrderId;
    if (!orderId) {
      throw new AppError("VALIDATION_ERROR", "Order id required", 400);
    }
    const data = await this.checkout.captureProviderOrder(orderId);
    response.status(200).json({
      success: true,
      data,
      meta: { requestId: request.requestId },
    });
  };

  markCancelled = async (request: Request, response: Response): Promise<void> => {
    const userId = request.auth?.userId;
    const input = markCheckoutSchema.parse(request.body as unknown);
    const orderId = input.paypalOrderId || input.providerOrderId;
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

  webhook = async (request: Request, response: Response): Promise<void> => {
    const raw =
      (request as Request & { rawBody?: string }).rawBody ??
      (typeof request.body === "string"
        ? request.body
        : Buffer.isBuffer(request.body)
          ? request.body.toString("utf8")
          : JSON.stringify(request.body ?? {}));
    await this.paypal.handleWebhook(raw, {
      authAlgo: String(request.header("paypal-auth-algo") ?? ""),
      certUrl: String(request.header("paypal-cert-url") ?? ""),
      transmissionId: String(request.header("paypal-transmission-id") ?? ""),
      transmissionSig: String(request.header("paypal-transmission-sig") ?? ""),
      transmissionTime: String(request.header("paypal-transmission-time") ?? ""),
    });
    response.status(200).json({ success: true });
  };

  cashfreeWebhook = async (request: Request, response: Response): Promise<void> => {
    await this.checkout.handleCashfreeWebhook(request.body);
    response.status(200).json({ success: true });
  };
}
