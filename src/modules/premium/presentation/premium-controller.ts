import type { Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { VerifiedBadgePaymentMethod } from "@prisma/client";
import { z } from "zod";

import { AppError } from "../../../shared/errors/app-error.js";
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
