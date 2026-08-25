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
import { cashfreeWebhookUrl } from "./cashfree-settings.js";
import { resolveCheckoutGateway } from "./checkout-gateway.js";
import { PaypalService } from "./paypal-service.js";
import type { CashfreeClient } from "../infrastructure/cashfree-client.js";

type CheckoutInput =
  | { kind: "POINT_PACK"; packId: string }
  | { kind: "PREMIUM"; planId: string; billingCycle: PremiumBillingCycle }
  | { kind: "VERIFIED_BADGE" };

/**
 * Routes India → Cashfree and everyone else → PayPal, sharing PaypalService fulfill.
 */
export class CheckoutService {
  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
    private readonly paypal: PaypalService,
    private readonly cashfree: CashfreeClient,
  ) {}

  async getOptions(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { country: true },
    });
    const resolved = resolveCheckoutGateway(user?.country);
    const packs = await this.database.pointPurchaseRate.findMany({
      where: {
        isActive: true,
        currency: resolved.currency,
      },
      orderBy: [{ sortOrder: "asc" }, { amountMinor: "asc" }],
      select: {
        id: true,
        currency: true,
        amountMinor: true,
        points: true,
        label: true,
      },
    });
    return {
      gateway: resolved.gateway,
      country: resolved.country,
      profileCountry: user?.country ?? null,
      currency: resolved.currency,
      gatewayLabel: resolved.label,
      payingAsMessage: `Paying as ${resolved.country} · ${resolved.label}`,
      changeCountryHint:
        "Wrong country? Update it in Profile so the correct payment method appears.",
      packs,
      cashfreeConfigured:
        resolved.gateway === "CASHFREE"
          ? await this.cashfree
              .requireConfigured()
              .then(() => true)
              .catch(() => false)
          : false,
    };
  }

  async createCheckout(userId: string, input: CheckoutInput) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { country: true, email: true, username: true },
    });
    const resolved = resolveCheckoutGateway(user?.country);

    if (resolved.gateway === "CASHFREE") {
      return this.createCashfreeCheckout(userId, input, {
        country: resolved.country,
        email: user?.email ?? null,
        username: user?.username ?? "milox",
      });
    }
    return this.paypal.createCheckout(userId, input, {
      country: resolved.country,
    });
  }

  async captureProviderOrder(providerOrderId: string) {
    const checkout = await this.database.paypalCheckout.findUnique({
      where: { paypalOrderId: providerOrderId },
    });
    if (!checkout) {
      throw new AppError("NOT_FOUND", "Checkout not found", 404);
    }
    if (checkout.gateway === PaymentGateway.CASHFREE) {
      return this.captureCashfreeOrder(providerOrderId);
    }
    return this.paypal.captureByPaypalOrderId(providerOrderId);
  }

  async markCancelled(providerOrderId: string, userId?: string) {
    const checkout = await this.database.paypalCheckout.findUnique({
      where: { paypalOrderId: providerOrderId },
    });
    if (!checkout) {
      throw new AppError("NOT_FOUND", "Checkout not found", 404);
    }
    if (userId && checkout.userId !== userId) {
      throw new AppError("FORBIDDEN", "Not your checkout", 403);
    }
    if (checkout.status === PaypalCheckoutStatus.COMPLETED) {
      return { ok: true, status: checkout.status };
    }
    await this.database.paypalCheckout.update({
      where: { id: checkout.id },
      data: {
        status: PaypalCheckoutStatus.CANCELLED,
        failureReason: "User cancelled checkout",
      },
    });
    return { ok: true, status: PaypalCheckoutStatus.CANCELLED };
  }

  async handleCashfreeWebhook(body: unknown): Promise<{ ok: boolean }> {
    const payload = body as {
      type?: string;
      data?: {
        order?: { order_id?: string; order_status?: string };
        payment?: { cf_payment_id?: string };
      };
      order_id?: string;
    };
    const orderId =
      payload.data?.order?.order_id ||
      payload.order_id ||
      null;
    if (!orderId) return { ok: true };
    const status = (
      payload.data?.order?.order_status || ""
    ).toUpperCase();
    if (status === "PAID" || status === "SUCCESS" || payload.type?.includes("SUCCESS")) {
      await this.captureCashfreeOrder(orderId).catch((error) => {
        if (error instanceof AppError && error.code === "NOT_FOUND") return;
        if (error instanceof AppError && error.code === "CASHFREE_NOT_PAID") return;
        throw error;
      });
    } else if (
      status === "EXPIRED" ||
      status === "CANCELLED" ||
      status === "FAILED"
    ) {
      await this.database.paypalCheckout.updateMany({
        where: {
          paypalOrderId: orderId,
          status: PaypalCheckoutStatus.CREATED,
        },
        data: {
          status:
            status === "CANCELLED"
              ? PaypalCheckoutStatus.CANCELLED
              : PaypalCheckoutStatus.FAILED,
          failureReason: `Cashfree ${status}`,
        },
      });
    }
    return { ok: true };
  }

  private async createCashfreeCheckout(
    userId: string,
    input: CheckoutInput,
    meta: { country: string; email: string | null; username: string },
  ) {
    await this.cashfree.requireConfigured();
    // Reuse PaypalService prepare via creating through shared logic —
    // call paypal prepare by opening a temporary path: duplicate prepare here lightly.
    const prepared = await this.prepareForGateway(userId, input, "INR");
    const checkoutId = randomUUID();
    // Cashfree order_id max constraints — use compact id.
    const orderId = `mx${checkoutId.replace(/-/g, "").slice(0, 20)}`;
    const returnBase = `${this.config.PUBLIC_WEB_ORIGIN.replace(/\/+$/, "")}/checkout/cashfree`;
    const created = await this.cashfree.createOrder({
      orderId,
      amountMajor: prepared.amountMinor / 100,
      currency: prepared.currency,
      customerId: userId,
      customerEmail: meta.email,
      returnUrl: `${returnBase}?order_id={order_id}&kind=${prepared.kind.toLowerCase()}`,
      notifyUrl: cashfreeWebhookUrl(this.config),
    });

    await this.database.paypalCheckout.create({
      data: {
        id: checkoutId,
        userId,
        kind: prepared.kind,
        status: PaypalCheckoutStatus.CREATED,
        gateway: PaymentGateway.CASHFREE,
        paypalOrderId: created.orderId,
        amountMinor: prepared.amountMinor,
        currency: prepared.currency,
        description: prepared.description,
        country: meta.country,
        packId: prepared.packId,
        planId: prepared.planId,
        planPriceId: prepared.planPriceId,
        billingCycle: prepared.billingCycle,
      },
    });

    return {
      checkoutId,
      gateway: "CASHFREE" as const,
      paypalOrderId: created.orderId,
      providerOrderId: created.orderId,
      approvalUrl: created.paymentUrl,
      paymentSessionId: created.paymentSessionId,
      kind: prepared.kind,
      currency: prepared.currency,
      amountMinor: prepared.amountMinor,
    };
  }

  private async captureCashfreeOrder(orderId: string) {
    const checkout = await this.database.paypalCheckout.findUnique({
      where: { paypalOrderId: orderId },
    });
    if (!checkout) {
      throw new AppError("NOT_FOUND", "Cashfree checkout not found", 404);
    }
    if (checkout.status === PaypalCheckoutStatus.COMPLETED) {
      return {
        checkoutId: checkout.id,
        kind: checkout.kind,
        status: checkout.status,
        paypalOrderId: checkout.paypalOrderId,
      };
    }
    const order = await this.cashfree.getOrder(orderId);
    if (order.orderStatus !== "PAID") {
      if (
        order.orderStatus === "EXPIRED" ||
        order.orderStatus === "CANCELLED" ||
        order.orderStatus === "FAILED"
      ) {
        await this.database.paypalCheckout.update({
          where: { id: checkout.id },
          data: {
            status:
              order.orderStatus === "CANCELLED"
                ? PaypalCheckoutStatus.CANCELLED
                : PaypalCheckoutStatus.FAILED,
            failureReason: `Cashfree ${order.orderStatus}`,
          },
        });
      }
      throw new AppError(
        "CASHFREE_NOT_PAID",
        "Cashfree payment is not completed yet",
        409,
      );
    }
    const expectedMajor = checkout.amountMinor / 100;
    if (
      order.orderAmount !== undefined &&
      Math.abs(order.orderAmount - expectedMajor) > 0.009
    ) {
      throw new AppError(
        "CASHFREE_AMOUNT_MISMATCH",
        "Cashfree payment does not match this order",
        409,
      );
    }
    // Reuse PayPal fulfill by capturing through paypal service internal —
    // expose fulfillCashfree on PaypalService.
    return this.paypal.fulfillExternalCapture(
      checkout.id,
      order.cfPaymentId || `cf_${orderId}`,
    );
  }

  private async prepareForGateway(
    userId: string,
    input: CheckoutInput,
    requiredCurrency: string,
  ) {
    if (input.kind === "POINT_PACK") {
      const pack = await this.database.pointPurchaseRate.findFirst({
        where: {
          id: input.packId,
          isActive: true,
          currency: requiredCurrency,
        },
      });
      if (!pack || pack.amountMinor <= 0) {
        throw new AppError(
          "NOT_FOUND",
          `No ${requiredCurrency} point pack found. Ask admin to add India (INR) packs.`,
          404,
        );
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
        where: {
          id: input.planId,
          isActive: true,
          currency: requiredCurrency,
        },
        include: {
          prices: {
            where: { billingCycle: input.billingCycle, isActive: true },
            take: 1,
          },
        },
      });
      const price = plan?.prices[0];
      if (!plan || !price || price.priceCents <= 0) {
        throw new AppError(
          "NOT_FOUND",
          `Premium plan not available in ${requiredCurrency}`,
          404,
        );
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
    const product = await this.database.verifiedBadgeProduct.findFirst({
      where: { isActive: true },
    });
    if (!product || product.priceCents <= 0) {
      throw new AppError(
        "VERIFIED_BADGE_UNAVAILABLE",
        "Verified badge checkout is not available",
        409,
      );
    }
    if (product.currency !== requiredCurrency) {
      throw new AppError(
        "CURRENCY_MISMATCH",
        `Verified badge is priced in ${product.currency}, not ${requiredCurrency}`,
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
}
