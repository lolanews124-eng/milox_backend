import {
  PaymentGateway,
  PaypalCheckoutKind,
  PaypalCheckoutStatus,
  PremiumBillingCycle,
  type PrismaClient,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import type { AppConfig } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { RazorpayClient } from "../infrastructure/razorpay-client.js";
import { PaypalService } from "./paypal-service.js";

type CheckoutInput =
  | { kind: "POINT_PACK"; packId: string }
  | { kind: "PREMIUM"; planId: string; billingCycle: PremiumBillingCycle }
  | { kind: "VERIFIED_BADGE" };

export class RazorpayService {
  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
    private readonly client: RazorpayClient,
    private readonly ledger: PaypalService,
  ) {}

  async isConfigured(): Promise<boolean> {
    return this.client.isConfigured();
  }

  async createCheckout(
    userId: string,
    input: CheckoutInput,
    options?: {
      country?: string | null;
      email?: string | null;
      username?: string | null;
      chargeCurrency?: "INR" | "USD";
      usdInrRate?: number;
    },
  ) {
    const runtime = await this.client.requireConfigured();
    const prepared = await this.ledger.prepareCheckout(userId, input, {
      chargeCurrency: options?.chargeCurrency,
      usdInrRate: options?.usdInrRate,
    });
    const checkoutId = randomUUID();
    const order = await this.client.createOrder({
      amountMinor: prepared.amountMinor,
      currency: prepared.currency,
      receipt: checkoutId.replace(/-/g, "").slice(0, 40),
      notes: {
        checkoutId,
        userId,
        kind: prepared.kind,
      },
    });

    await this.database.paypalCheckout.create({
      data: {
        id: checkoutId,
        userId,
        kind: prepared.kind,
        status: PaypalCheckoutStatus.CREATED,
        gateway: PaymentGateway.RAZORPAY,
        paypalOrderId: order.id,
        amountMinor: prepared.amountMinor,
        currency: prepared.currency,
        description: prepared.description,
        country: options?.country ?? null,
        packId: prepared.packId,
        planId: prepared.planId,
        planPriceId: prepared.planPriceId,
        billingCycle: prepared.billingCycle,
      },
    });

    return {
      checkoutId,
      gateway: "RAZORPAY" as const,
      providerOrderId: order.id,
      razorpayOrderId: order.id,
      keyId: runtime.keyId,
      amount: order.amount,
      amountMinor: prepared.amountMinor,
      currency: prepared.currency,
      kind: prepared.kind,
      description: prepared.description,
      name: "Milox",
      prefill: {
        email: options?.email ?? undefined,
        name: options?.username ?? undefined,
      },
      // Clients use Razorpay Checkout SDK — no hosted redirect URL.
      approvalUrl: null as string | null,
    };
  }

  async verifyAndFulfill(input: {
    orderId: string;
    paymentId: string;
    signature: string;
    userId?: string;
  }) {
    const runtime = await this.client.requireConfigured();
    const checkout = await this.database.paypalCheckout.findUnique({
      where: { paypalOrderId: input.orderId },
    });
    if (!checkout) {
      throw new AppError("NOT_FOUND", "Checkout not found", 404);
    }
    if (input.userId && checkout.userId !== input.userId) {
      throw new AppError("FORBIDDEN", "Not your checkout", 403);
    }
    if (checkout.gateway !== PaymentGateway.RAZORPAY) {
      throw new AppError("VALIDATION_ERROR", "Not a Razorpay checkout", 400);
    }
    if (checkout.status === PaypalCheckoutStatus.COMPLETED) {
      return {
        checkoutId: checkout.id,
        kind: checkout.kind,
        status: checkout.status,
        providerOrderId: checkout.paypalOrderId,
      };
    }

    const ok = this.client.verifyPaymentSignature({
      orderId: input.orderId,
      paymentId: input.paymentId,
      signature: input.signature,
      keySecret: runtime.keySecret,
    });
    if (!ok) {
      await this.database.paypalCheckout.update({
        where: { id: checkout.id },
        data: {
          status: PaypalCheckoutStatus.FAILED,
          failureReason: "Invalid Razorpay signature",
        },
      });
      throw new AppError(
        "RAZORPAY_SIGNATURE_INVALID",
        "Payment signature verification failed",
        400,
      );
    }

    const payment = await this.client.fetchPayment(input.paymentId);
    if (payment.order_id !== input.orderId) {
      throw new AppError(
        "RAZORPAY_ORDER_MISMATCH",
        "Payment does not belong to this order",
        409,
      );
    }
    const status = (payment.status || "").toLowerCase();
    if (status !== "captured" && status !== "authorized") {
      throw new AppError(
        "RAZORPAY_NOT_PAID",
        "Razorpay payment is not completed yet",
        409,
      );
    }
    if (
      payment.amount !== checkout.amountMinor ||
      payment.currency.toUpperCase() !== checkout.currency.toUpperCase()
    ) {
      await this.database.paypalCheckout.update({
        where: { id: checkout.id },
        data: {
          status: PaypalCheckoutStatus.FAILED,
          failureReason: "Amount/currency mismatch",
        },
      });
      throw new AppError(
        "RAZORPAY_AMOUNT_MISMATCH",
        "Payment does not match this order",
        409,
      );
    }

    return this.ledger.fulfillExternalCapture(checkout.id, input.paymentId);
  }

  async handleWebhook(rawBody: string, signature: string): Promise<{ ok: boolean }> {
    const runtime = await this.client.runtime();
    if (!runtime.webhookSecret) {
      // Client verify still works; without secret we cannot trust inbound webhooks.
      console.warn(
        "[razorpay] webhook received but webhook secret is not configured — ignored",
      );
      return { ok: true };
    }
    const valid = this.client.verifyWebhookSignature(
      rawBody,
      signature,
      runtime.webhookSecret,
    );
    if (!valid) {
      throw new AppError(
        "RAZORPAY_WEBHOOK_INVALID",
        "Invalid Razorpay webhook signature",
        400,
      );
    }

    let event: {
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            status?: string;
          };
        };
        order?: { entity?: { id?: string } };
      };
    };
    try {
      event = JSON.parse(rawBody) as typeof event;
    } catch {
      throw new AppError("RAZORPAY_WEBHOOK_INVALID", "Invalid webhook body", 400);
    }

    const payment = event.payload?.payment?.entity;
    const orderId = payment?.order_id || event.payload?.order?.entity?.id;
    const paymentId = payment?.id;
    const status = (payment?.status || "").toLowerCase();
    if (
      orderId &&
      paymentId &&
      (status === "captured" || event.event === "payment.captured")
    ) {
      // Webhook path: signature already verified; mint a payment-signature style fulfill
      // by fetching payment and fulfilling when paid.
      const checkout = await this.database.paypalCheckout.findUnique({
        where: { paypalOrderId: orderId },
      });
      if (checkout && checkout.status !== PaypalCheckoutStatus.COMPLETED) {
        const paid = await this.client.fetchPayment(paymentId);
        if (
          (paid.status === "captured" || paid.status === "authorized") &&
          paid.amount === checkout.amountMinor &&
          paid.currency.toUpperCase() === checkout.currency.toUpperCase()
        ) {
          await this.ledger
            .fulfillExternalCapture(checkout.id, paymentId)
            .catch((error) => {
              if (error instanceof AppError && error.code === "NOT_FOUND") return;
              throw error;
            });
        }
      }
    }
    return { ok: true };
  }
}
