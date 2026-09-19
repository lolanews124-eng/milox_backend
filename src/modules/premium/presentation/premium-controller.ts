import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { VerifiedBadgePaymentMethod } from "@prisma/client";
import { z } from "zod";

import { AppError } from "../../../shared/errors/app-error.js";
import { getUsdInrRate } from "../../economy/app-economy-config.js";
import { resolveCheckoutCurrency } from "../../payments/application/checkout-gateway.js";
import { convertAmountMinor } from "../../payments/application/payment-money.js";
import { resolveUserEntitlements, presentEntitlements } from "../application/entitlements.js";
import type { VerifiedBadgeService } from "../application/verified-badge-service.js";

const purchaseVerifiedBadgeSchema = z
  .object({
    method: z.enum(["POINTS", "MANUAL"]),
  })
  .strict();

export class PremiumController {
  constructor(
    private readonly database: PrismaClient,
    private readonly verifiedBadge: VerifiedBadgeService,
  ) {}

  listPlans = async (request: Request, response: Response): Promise<void> => {
    const plans = await this.database.premiumPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        tier: true,
        sortOrder: true,
        badgeLabel: true,
        priceCents: true,
        currency: true,
        durationDays: true,
        adsFree: true,
        houseAdsFree: true,
        profileViews: true,
        discoverBoost: true,
        grantVerifiedBadge: true,
        dailyInterestLimit: true,
        interstitialAdsFree: true,
        directMessageEnabled: true,
        unlimitedMessaging: true,
        prices: {
          where: { isActive: true },
          orderBy: { billingCycle: "asc" },
          select: {
            billingCycle: true,
            priceCents: true,
            durationDays: true,
          },
        },
      },
    });

    let chargeCurrency: "INR" | "USD" | null = null;
    let usdInrRate = 85;
    const userId = request.auth?.userId;
    if (userId) {
      const user = await this.database.user.findUnique({
        where: { id: userId },
        select: { country: true },
      });
      chargeCurrency = resolveCheckoutCurrency(user?.country).currency;
      usdInrRate = await getUsdInrRate(this.database);
    }

    // If old INR+USD plan duplicates exist, keep one plan per code for the user.
    const ranked = [...plans].sort((a, b) => {
      if (!chargeCurrency) return 0;
      const aMatch = a.currency.toUpperCase() === chargeCurrency ? 0 : 1;
      const bMatch = b.currency.toUpperCase() === chargeCurrency ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      const aInr = a.currency.toUpperCase() === "INR" ? 0 : 1;
      const bInr = b.currency.toUpperCase() === "INR" ? 0 : 1;
      return aInr - bInr;
    });
    const seenCodes = new Set<string>();
    const uniquePlans = ranked.filter((plan) => {
      if (seenCodes.has(plan.code)) return false;
      seenCodes.add(plan.code);
      return true;
    });

    response.status(200).json({
      success: true,
      data: {
        items: uniquePlans.map((plan) => {
          const currency = chargeCurrency ?? plan.currency;
          const convert = (cents: number) =>
            chargeCurrency
              ? convertAmountMinor(
                  cents,
                  plan.currency,
                  chargeCurrency,
                  usdInrRate,
                )
              : cents;
          return {
            ...plan,
            currency,
            priceCents: convert(plan.priceCents),
            baseCurrency: plan.currency,
            basePriceCents: plan.priceCents,
            dailyInterestLimit:
              plan.dailyInterestLimit >= 9999
                ? "unlimited"
                : plan.dailyInterestLimit,
            prices: plan.prices.map((price) => ({
              billingCycle: price.billingCycle,
              priceCents: convert(price.priceCents),
              durationDays: price.durationDays,
            })),
          };
        }),
      },
    });
  };

  getVerifiedBadge = async (request: Request, response: Response): Promise<void> => {
    const userId = request.auth?.userId;
    if (!userId) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    const data = await this.verifiedBadge.getPublicOffer(userId);
    response.status(200).json({
      success: true,
      data,
      meta: { requestId: request.requestId },
    });
  };

  purchaseVerifiedBadge = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const userId = request.auth?.userId;
    if (!userId) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    const input = purchaseVerifiedBadgeSchema.parse(request.body as unknown);
    const data = await this.verifiedBadge.purchase(
      userId,
      input.method as VerifiedBadgePaymentMethod,
    );
    response.status(200).json({
      success: true,
      data,
      meta: { requestId: request.requestId },
    });
  };

  getEntitlements = async (request: Request, response: Response): Promise<void> => {
    const userId = request.auth?.userId;
    if (!userId) {
      throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
    }
    const entitlements = await resolveUserEntitlements(this.database, userId);
    response.status(200).json({
      success: true,
      data: presentEntitlements(entitlements),
      meta: { requestId: request.requestId },
    });
  };
}
