import {
  PaymentGateway,
  PaypalCheckoutKind,
  PaypalCheckoutStatus,
  PremiumBillingCycle,
  SubscriptionStatus,
  VerifiedBadgeOrderStatus,
  VerifiedBadgePaymentMethod,
  WalletTransactionType,
  type PrismaClient,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import type { AppConfig } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { syncUserPremiumState } from "../../premium/application/entitlements.js";
import { VerifiedBadgeService } from "../../premium/application/verified-badge-service.js";
import { creditWallet } from "../../rewards/infrastructure/prisma-rewards-repository.js";
import {
  paypalPaymentMatchesCheckout,
} from "./paypal-capture.js";
import { PaypalClient } from "../infrastructure/paypal-client.js";

export const createPaypalOrderSchemaKind = [
  "POINT_PACK",
  "PREMIUM",
  "VERIFIED_BADGE",
] as const;

export class PaypalService {
  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
    private readonly paypal: PaypalClient,
    private readonly verifiedBadge: VerifiedBadgeService,
  ) {}

  async createCheckout(
    userId: string,
    input:
      | { kind: "POINT_PACK"; packId: string }
      | { kind: "PREMIUM"; planId: string; billingCycle: PremiumBillingCycle }
      | { kind: "VERIFIED_BADGE" },
    options?: { country?: string | null },
  ) {
    await this.paypal.requireConfigured();
    const prepared = await this.prepare(userId, input);
    const checkoutId = randomUUID();
    const returnUrl = `${this.config.PUBLIC_WEB_ORIGIN.replace(/\/+$/, "")}/checkout/paypal`;
    const created = await this.paypal.createOrder({
      amountMinor: prepared.amountMinor,
      currency: prepared.currency,
      description: prepared.description,
      customId: checkoutId,
      returnUrl: `${returnUrl}?kind=${prepared.kind.toLowerCase()}`,
      cancelUrl: `${returnUrl}?cancelled=1&kind=${prepared.kind.toLowerCase()}`,
    });

    await this.database.paypalCheckout.create({
      data: {
        id: checkoutId,
        userId,
        kind: prepared.kind,
        status: PaypalCheckoutStatus.CREATED,
        gateway: PaymentGateway.PAYPAL,
        paypalOrderId: created.id,
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
      gateway: "PAYPAL" as const,
      paypalOrderId: created.id,
      providerOrderId: created.id,
      approvalUrl: created.approvalUrl,
      kind: prepared.kind,
      currency: prepared.currency,
      amountMinor: prepared.amountMinor,
    };
  }

  async captureByPaypalOrderId(paypalOrderId: string) {
    const checkout = await this.database.paypalCheckout.findUnique({
      where: { paypalOrderId },
    });
    if (!checkout) {
      throw new AppError("NOT_FOUND", "PayPal checkout not found", 404);
    }
    if (checkout.status === PaypalCheckoutStatus.COMPLETED) {
      return this.present(checkout);
    }

    try {
      const paid = await this.paypal.capturePaidOrder(paypalOrderId);
      if (!paid.paid || !paid.captureId) {
        await this.database.paypalCheckout.update({
          where: { id: checkout.id },
          data: {
            status: PaypalCheckoutStatus.FAILED,
            failureReason: "PayPal payment not completed",
          },
        });
        throw new AppError(
          "PAYPAL_NOT_COMPLETED",
          "PayPal payment is not completed yet",
          409,
        );
      }
      if (!paypalPaymentMatchesCheckout(paid, checkout)) {
        await this.database.paypalCheckout.update({
          where: { id: checkout.id },
          data: {
            status: PaypalCheckoutStatus.FAILED,
            failureReason: "Amount/currency mismatch",
          },
        });
        throw new AppError(
          "PAYPAL_AMOUNT_MISMATCH",
          "PayPal payment does not match this order",
          409,
        );
      }
      const updated = await this.fulfill(checkout.id, paid.captureId);
      return this.present(updated);
    } catch (error) {
      if (error instanceof AppError) throw error;
      await this.database.paypalCheckout.update({
        where: { id: checkout.id },
        data: {
          status: PaypalCheckoutStatus.FAILED,
          failureReason: error instanceof Error ? error.message.slice(0, 480) : "Capture failed",
        },
      });
      throw error;
    }
  }

  /** Shared fulfill path for Cashfree (and other gateways). */
  async fulfillExternalCapture(checkoutId: string, captureId: string) {
    const updated = await this.fulfill(checkoutId, captureId);
    return this.present(updated);
  }

  async handleWebhook(rawBody: string, headers: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
  }): Promise<{ ok: boolean }> {
    const verified = await this.paypal.verifyWebhook(headers, rawBody);
    if (!verified) {
      throw new AppError("PAYPAL_WEBHOOK_INVALID", "Invalid PayPal webhook", 400);
    }
    const event = JSON.parse(rawBody) as {
      event_type?: string;
      resource?: {
        id?: string;
        supplementary_data?: { related_ids?: { order_id?: string } };
      };
    };
    const orderId =
      event.event_type === "PAYMENT.CAPTURE.COMPLETED"
        ? event.resource?.supplementary_data?.related_ids?.order_id
        : event.resource?.id;
    if (
      orderId &&
      (event.event_type === "CHECKOUT.ORDER.APPROVED" ||
        event.event_type === "PAYMENT.CAPTURE.COMPLETED")
    ) {
      await this.captureByPaypalOrderId(orderId).catch((error) => {
        if (error instanceof AppError && error.code === "NOT_FOUND") return;
        if (error instanceof AppError && error.code === "PAYPAL_NOT_COMPLETED") return;
        throw error;
      });
    }
    return { ok: true };
  }

  private async prepare(
    userId: string,
    input:
      | { kind: "POINT_PACK"; packId: string }
      | { kind: "PREMIUM"; planId: string; billingCycle: PremiumBillingCycle }
      | { kind: "VERIFIED_BADGE" },
  ) {
    if (input.kind === "POINT_PACK") {
      const pack = await this.database.pointPurchaseRate.findFirst({
        where: { id: input.packId, isActive: true },
      });
      if (!pack || pack.amountMinor <= 0) {
        throw new AppError("NOT_FOUND", "Point pack not found", 404);
      }
      return {
        kind: PaypalCheckoutKind.POINT_PACK,
        amountMinor: pack.amountMinor,
        currency: pack.currency,
        description: pack.label?.trim() || `${pack.points} Milox Points`,
        packId: pack.id,
        planId: null as string | null,
        planPriceId: null as string | null,
        billingCycle: null as PremiumBillingCycle | null,
      };
    }

    if (input.kind === "PREMIUM") {
      const plan = await this.database.premiumPlan.findFirst({
        where: { id: input.planId, isActive: true },
        include: {
          prices: {
            where: { billingCycle: input.billingCycle, isActive: true },
            take: 1,
          },
        },
      });
      const price = plan?.prices[0];
      if (!plan || !price || price.priceCents <= 0) {
        throw new AppError("NOT_FOUND", "Premium plan not available", 404);
      }
      return {
        kind: PaypalCheckoutKind.PREMIUM,
        amountMinor: price.priceCents,
        currency: plan.currency,
        description: `${plan.name} (${input.billingCycle.toLowerCase()})`,
        packId: null,
        planId: plan.id,
        planPriceId: price.id,
        billingCycle: input.billingCycle,
      };
    }

    const product = await this.verifiedBadge.getOrCreateProduct();
    if (!product.isActive || product.priceCents <= 0) {
      throw new AppError(
        "VERIFIED_BADGE_UNAVAILABLE",
        "Verified badge PayPal checkout is not available",
        409,
      );
    }
    const pending = await this.database.verifiedBadgeOrder.findFirst({
      where: { userId, status: VerifiedBadgeOrderStatus.PENDING },
      select: { id: true },
    });
    if (pending) {
      throw new AppError(
        "VERIFIED_BADGE_PENDING",
        "You already have a pending verified badge request",
        409,
      );
    }
    return {
      kind: PaypalCheckoutKind.VERIFIED_BADGE,
      amountMinor: product.priceCents,
      currency: product.currency,
      description: product.title,
      packId: null,
      planId: null,
      planPriceId: null,
      billingCycle: null,
    };
  }

  private async fulfill(checkoutId: string, captureId: string) {
    const updated = await this.database.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM paypal_checkouts WHERE id = ${checkoutId}::uuid FOR UPDATE
      `;
      const checkout = await tx.paypalCheckout.findUnique({
        where: { id: checkoutId },
      });
      if (!checkout) {
        throw new AppError("NOT_FOUND", "PayPal checkout not found", 404);
      }
      if (checkout.status === PaypalCheckoutStatus.COMPLETED) {
        return checkout;
      }

      if (checkout.kind === PaypalCheckoutKind.POINT_PACK && checkout.packId) {
        const pack = await tx.pointPurchaseRate.findUnique({
          where: { id: checkout.packId },
        });
        if (!pack) {
          throw new AppError("NOT_FOUND", "Point pack not found", 404);
        }
        try {
          await creditWallet(tx, {
            userId: checkout.userId,
            amount: pack.points,
            type: WalletTransactionType.POINT_PURCHASE,
            idempotencyKey: `checkout:${checkout.id}`,
            referenceType: "payment_checkout",
            referenceId: checkout.id,
            description: pack.label ?? `${pack.points} Milox Points`,
          });
        } catch (error) {
          const duplicate =
            error instanceof Error &&
            "code" in error &&
            (error as { code?: string }).code === "P2002";
          if (!duplicate) throw error;
        }
      } else if (
        checkout.kind === PaypalCheckoutKind.PREMIUM &&
        checkout.planId &&
        checkout.planPriceId &&
        checkout.billingCycle
      ) {
        const plan = await tx.premiumPlan.findUnique({
          where: { id: checkout.planId },
          include: {
            prices: { where: { id: checkout.planPriceId }, take: 1 },
          },
        });
        const planPrice = plan?.prices[0];
        if (!plan || !planPrice) {
          throw new AppError("NOT_FOUND", "Premium plan not found", 404);
        }
        const now = new Date();
        const endsAt = new Date(now);
        endsAt.setUTCDate(endsAt.getUTCDate() + planPrice.durationDays);
        await tx.userSubscription.updateMany({
          where: { userId: checkout.userId, status: SubscriptionStatus.ACTIVE },
          data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now },
        });
        await tx.userSubscription.create({
          data: {
            userId: checkout.userId,
            planId: plan.id,
            planPriceId: planPrice.id,
            billingCycle: checkout.billingCycle ?? PremiumBillingCycle.MONTHLY,
            status: SubscriptionStatus.ACTIVE,
            startsAt: now,
            endsAt,
          },
        });
        if (plan.grantVerifiedBadge) {
          await tx.user.update({
            where: { id: checkout.userId },
            data: {
              isVerifiedBadge: true,
              verifiedBadgeExpiresAt: plan.durationDays > 0 ? endsAt : null,
            },
          });
        }
      } else if (checkout.kind === PaypalCheckoutKind.VERIFIED_BADGE) {
        const product = await this.verifiedBadge.getOrCreateProduct();
        await this.verifiedBadge.completePaypalPurchase(
          {
            userId: checkout.userId,
            amountCents: checkout.amountMinor,
            currency: checkout.currency,
            durationDays: product.durationDays,
            checkoutId: checkout.id,
          },
          tx,
        );
      } else {
        throw new AppError("PAYPAL_ERROR", "Checkout is missing product details", 500);
      }

      return tx.paypalCheckout.update({
        where: { id: checkout.id },
        data: {
          status: PaypalCheckoutStatus.COMPLETED,
          paypalCaptureId: captureId,
          fulfilledAt: new Date(),
        },
      });
    });

    if (updated.kind === PaypalCheckoutKind.PREMIUM) {
      await syncUserPremiumState(this.database, updated.userId);
    }
    return updated;
  }

  private present(checkout: {
    id: string;
    kind: PaypalCheckoutKind;
    status: PaypalCheckoutStatus;
    paypalOrderId: string;
  }) {
    return {
      checkoutId: checkout.id,
      kind: checkout.kind,
      status: checkout.status,
      paypalOrderId: checkout.paypalOrderId,
    };
  }
}
