import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";

import { resolveUserEntitlements, presentEntitlements } from "../application/entitlements.js";

export class PremiumController {
  constructor(private readonly database: PrismaClient) {}

  listPlans = async (_request: Request, response: Response): Promise<void> => {
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

    response.status(200).json({
      success: true,
      data: {
        items: plans.map((plan) => ({
          ...plan,
          dailyInterestLimit:
            plan.dailyInterestLimit >= 9999 ? "unlimited" : plan.dailyInterestLimit,
          prices: plan.prices.map((price) => ({
            billingCycle: price.billingCycle,
            priceCents: price.priceCents,
            durationDays: price.durationDays,
          })),
        })),
      },
    });
  };
}

export async function getEntitlementsHandler(
  database: PrismaClient,
  userId: string,
  freeDailyInterestLimit: number,
): Promise<object> {
  const entitlements = await resolveUserEntitlements(
    database,
    userId,
    freeDailyInterestLimit,
  );
  return presentEntitlements(entitlements);
}
