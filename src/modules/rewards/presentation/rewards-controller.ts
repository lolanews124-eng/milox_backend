import type { Request, Response } from "express";

import { AppError } from "../../../shared/errors/app-error.js";
import type { RewardsService } from "../application/services/rewards-service.js";
import {
  claimRewardedAdSchema,
  walletTransactionsQuerySchema,
} from "./rewards-schemas.js";

export class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  getWallet = async (request: Request, response: Response): Promise<void> => {
    const userId = requireUserId(request);
    response.status(200).json({
      success: true,
      data: await this.rewards.getWallet(userId),
      meta: { requestId: request.requestId },
    });
  };

  listTransactions = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const userId = requireUserId(request);
    const query = walletTransactionsQuerySchema.parse(request.query);
    response.status(200).json({
      success: true,
      data: {
        items: await this.rewards.listTransactions(userId, query.limit),
      },
      meta: { requestId: request.requestId },
    });
  };

  claimRewardedAd = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const userId = requireUserId(request);
    const input = claimRewardedAdSchema.parse(request.body);
    const result = await this.rewards.claimRewardedAd(userId, input.claimId);
    response.status(200).json({
      success: true,
      data: result,
      meta: { requestId: request.requestId },
    });
  };

  listPointPacks = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    requireUserId(request);
    response.status(200).json({
      success: true,
      data: await this.rewards.listPointPacks(),
      meta: { requestId: request.requestId },
    });
  };
}

function requireUserId(request: Request): string {
  if (!request.auth) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }
  return request.auth.userId;
}
