import {
  PaypalCheckoutStatus,
  PremiumBillingCycle,
  type PrismaClient,
} from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { getUsdInrRate } from "../../economy/app-economy-config.js";
import {
  INDIA_GATEWAY_UNAVAILABLE_MESSAGE,
  PAYPAL_GATEWAY_UNAVAILABLE_MESSAGE,
  resolveCheckoutCurrency,
} from "./checkout-gateway.js";
import {
  convertAmountMinor,
  presentMoneyForCountry,
} from "./payment-money.js";
import { PaypalService } from "./paypal-service.js";
import { RazorpayService } from "./razorpay-service.js";

type CheckoutInput =
  | { kind: "POINT_PACK"; packId: string }
  | { kind: "PREMIUM"; planId: string; billingCycle: PremiumBillingCycle }
  | { kind: "VERIFIED_BADGE" };

/**
 * India → Razorpay (INR). International → PayPal (USD).
 * Admin enters one base price; currency converts via economy usdInrRate.
 */
export class CheckoutService {
  constructor(
    private readonly database: PrismaClient,
    private readonly _config: AppConfig,
    private readonly razorpay: RazorpayService,
    private readonly paypal: PaypalService,
  ) {}

  async getOptions(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { country: true },
    });
    const resolved = resolveCheckoutCurrency(user?.country);
    const usdInrRate = await getUsdInrRate(this.database);
    const rows = await this.database.pointPurchaseRate.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { amountMinor: "asc" }],
      select: {
        id: true,
        currency: true,
        amountMinor: true,
        points: true,
        label: true,
      },
    });

    const chargeCurrency = resolved.currency;
    const ranked = [...rows].sort((a, b) => {
      const aMatch = a.currency.toUpperCase() === chargeCurrency ? 0 : 1;
      const bMatch = b.currency.toUpperCase() === chargeCurrency ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      const aInr = a.currency.toUpperCase() === "INR" ? 0 : 1;
      const bInr = b.currency.toUpperCase() === "INR" ? 0 : 1;
      return aInr - bInr;
    });
    const seenPoints = new Set<number>();
    const uniqueRows = ranked.filter((pack) => {
      if (seenPoints.has(pack.points)) return false;
      seenPoints.add(pack.points);
      return true;
    });

    const packs = uniqueRows.map((pack) => {
      const money = presentMoneyForCountry({
        amountMinor: pack.amountMinor,
        currency: pack.currency,
        country: user?.country,
        usdInrRate,
      });
      return {
        id: pack.id,
        currency: money.currency,
        amountMinor: money.amountMinor,
        points: pack.points,
        label: pack.label,
        baseCurrency: pack.currency,
        baseAmountMinor: pack.amountMinor,
      };
    });

    const [razorpayConfigured, paypalConfigured] = await Promise.all([
      this.razorpay.isConfigured(),
      this.paypal.isConfigured(),
    ]);
    const gatewayReady =
      resolved.gateway === "RAZORPAY" ? razorpayConfigured : paypalConfigured;
    const unavailableReason = gatewayReady
      ? null
      : resolved.gateway === "RAZORPAY"
        ? INDIA_GATEWAY_UNAVAILABLE_MESSAGE
        : PAYPAL_GATEWAY_UNAVAILABLE_MESSAGE;

    return {
      gateway: resolved.gateway,
      country: resolved.country,
      profileCountry: user?.country ?? null,
      currency: resolved.currency,
      usdInrRate,
      gatewayLabel: resolved.label,
      payingAsMessage: `Paying as ${resolved.country} · prices in ${resolved.currency} · ${resolved.label}`,
      changeCountryHint: unavailableReason
        ? unavailableReason
        : packs.length === 0
          ? "No point packs published yet. Add a pack price in admin (one price is enough)."
          : "Wrong country? Update it in Profile — India pays with Razorpay (₹), others with PayPal ($).",
      checkoutAvailable: gatewayReady,
      unavailableReason,
      packs: gatewayReady ? packs : [],
      razorpayConfigured,
      paypalConfigured,
      cashfreeConfigured: false,
    };
  }

  async createCheckout(userId: string, input: CheckoutInput) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { country: true, email: true, username: true },
    });
    const resolved = resolveCheckoutCurrency(user?.country);
    const usdInrRate = await getUsdInrRate(this.database);

    if (resolved.gateway === "PAYPAL") {
      const ready = await this.paypal.isConfigured();
      if (!ready) {
        throw new AppError(
          "PAYMENT_GATEWAY_UNAVAILABLE",
          PAYPAL_GATEWAY_UNAVAILABLE_MESSAGE,
          503,
        );
      }
      return this.paypal.createCheckout(userId, input, {
        country: resolved.country,
        chargeCurrency: resolved.currency,
        usdInrRate,
      });
    }

    const ready = await this.razorpay.isConfigured();
    if (!ready) {
      throw new AppError(
        "PAYMENT_GATEWAY_UNAVAILABLE",
        INDIA_GATEWAY_UNAVAILABLE_MESSAGE,
        503,
      );
    }
    return this.razorpay.createCheckout(userId, input, {
      country: resolved.country,
      email: user?.email ?? null,
      username: user?.username ?? "milox",
      chargeCurrency: resolved.currency,
      usdInrRate,
    });
  }

  async verifyRazorpayPayment(input: {
    orderId: string;
    paymentId: string;
    signature: string;
    userId?: string;
  }) {
    return this.razorpay.verifyAndFulfill(input);
  }

  async captureProviderOrder(providerOrderId: string, userId?: string) {
    const checkout = await this.database.paypalCheckout.findUnique({
      where: { paypalOrderId: providerOrderId },
    });
    if (!checkout) {
      throw new AppError("NOT_FOUND", "Checkout not found", 404);
    }
    if (userId && checkout.userId !== userId) {
      throw new AppError("FORBIDDEN", "Not your checkout", 403);
    }
    if (checkout.gateway === "RAZORPAY") {
      throw new AppError(
        "VALIDATION_ERROR",
        "Use Razorpay verify with paymentId and signature",
        400,
      );
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
    if (checkout.paypalCaptureId) {
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

  async handleRazorpayWebhook(rawBody: string, signature: string) {
    return this.razorpay.handleWebhook(rawBody, signature);
  }

  async handlePaypalWebhook(
    rawBody: string,
    headers: {
      authAlgo: string;
      certUrl: string;
      transmissionId: string;
      transmissionSig: string;
      transmissionTime: string;
    },
  ) {
    return this.paypal.handleWebhook(rawBody, headers);
  }
}

export { convertAmountMinor };
