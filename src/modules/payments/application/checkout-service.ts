import {
  PaypalCheckoutStatus,
  PremiumBillingCycle,
  type PrismaClient,
} from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { getUsdInrRate } from "../../economy/app-economy-config.js";
import { resolveCheckoutCurrency } from "./checkout-gateway.js";
import {
  convertAmountMinor,
  presentMoneyForCountry,
} from "./payment-money.js";
import { RazorpayService } from "./razorpay-service.js";

type CheckoutInput =
  | { kind: "POINT_PACK"; packId: string }
  | { kind: "PREMIUM"; planId: string; billingCycle: PremiumBillingCycle }
  | { kind: "VERIFIED_BADGE" };

const UNAVAILABLE =
  "Razorpay is not configured yet. Ask admin to add Key ID and Secret in Payments.";

/**
 * Razorpay only. Admin enters one base price; India sees/pays INR,
 * international sees/pays USD (converted via economy usdInrRate).
 */
export class CheckoutService {
  constructor(
    private readonly database: PrismaClient,
    private readonly _config: AppConfig,
    private readonly razorpay: RazorpayService,
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

    // One admin price per pack. If old INR+USD duplicates exist, keep one row per points.
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

    const razorpayConfigured = await this.razorpay.isConfigured();
    const checkoutAvailable = razorpayConfigured;
    const unavailableReason = razorpayConfigured ? null : UNAVAILABLE;

    return {
      gateway: "RAZORPAY" as const,
      country: resolved.country,
      profileCountry: user?.country ?? null,
      currency: resolved.currency,
      usdInrRate,
      gatewayLabel: "Razorpay",
      payingAsMessage: `Paying as ${resolved.country} · prices in ${resolved.currency}`,
      changeCountryHint: unavailableReason
        ? unavailableReason
        : packs.length === 0
          ? "No point packs published yet. Add a pack price in admin (one price is enough)."
          : "Wrong country? Update it in Profile — India sees ₹, others see $.",
      checkoutAvailable,
      unavailableReason,
      packs: checkoutAvailable ? packs : [],
      razorpayConfigured,
      paypalConfigured: false,
      cashfreeConfigured: false,
    };
  }

  async createCheckout(userId: string, input: CheckoutInput) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { country: true, email: true, username: true },
    });
    const ready = await this.razorpay.isConfigured();
    if (!ready) {
      throw new AppError("PAYMENT_GATEWAY_UNAVAILABLE", UNAVAILABLE, 503);
    }
    const resolved = resolveCheckoutCurrency(user?.country);
    const usdInrRate = await getUsdInrRate(this.database);
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

  async captureProviderOrder(_providerOrderId: string) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Use Razorpay verify with paymentId and signature",
      400,
    );
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
    // Never cancel a checkout that already has a provider capture id — fulfill may still run.
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
}

export { convertAmountMinor };
