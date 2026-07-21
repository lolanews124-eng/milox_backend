import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type { RewardsRepository } from "../ports/rewards-repository.js";
import { RewardedAdDailyLimitError } from "../ports/rewards-repository.js";

export class RewardsService {
  constructor(
    private readonly repository: RewardsRepository,
    private readonly config: AppConfig,
  ) {}

  getWallet(userId: string) {
    return this.repository.getWalletSummary(userId).then((wallet) => {
      if (!wallet) {
        throw new AppError("WALLET_NOT_FOUND", "Milox Points not found", 404);
      }
      return presentWallet(wallet);
    });
  }

  async listTransactions(userId: string, limit: number) {
    const rows = await this.repository.listTransactions(userId, limit);
    return rows.map(presentTransaction);
  }

  async getReferrals(userId: string) {
    const [info, invites] = await Promise.all([
      this.repository.getReferralInfo(userId),
      this.repository.listReferrals(userId, 50),
    ]);
    if (!info) {
      throw new AppError("REFERRAL_NOT_FOUND", "Referral profile not found", 404);
    }
    return {
      ...info,
      invites: invites.map(presentInvite),
    };
  }

  validateReferralCode(code: string) {
    return this.repository.resolveReferrerId(code).then((referrerId) => ({
      valid: Boolean(referrerId),
      code: code.trim().toUpperCase(),
    }));
  }

  claimRewardedAd(userId: string, claimId: string) {
    return this.repository.creditRewardedAd(userId, claimId).catch((error) => {
      if (error instanceof RewardedAdDailyLimitError) {
        throw new AppError(
          "REWARDED_AD_DAILY_LIMIT",
          "Daily rewarded ad limit reached. Try again tomorrow.",
          429,
        );
      }
      throw error;
    });
  }
}

function presentWallet(wallet: {
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  interestSendCost: number;
  referralRewardPoints: number;
  postRewardPoints: number;
  welcomeBonus: number;
  rewardedAdPoints: number;
  rewardedAdDailyLimit: number;
}) {
  return {
    balance: wallet.balance,
    lifetimeEarned: wallet.lifetimeEarned,
    lifetimeSpent: wallet.lifetimeSpent,
    interestSendCost: wallet.interestSendCost,
    referralRewardPoints: wallet.referralRewardPoints,
    postRewardPoints: wallet.postRewardPoints,
    welcomeBonus: wallet.welcomeBonus,
    rewardedAdPoints: wallet.rewardedAdPoints,
    rewardedAdDailyLimit: wallet.rewardedAdDailyLimit,
  };
}

function presentTransaction(row: {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

function presentInvite(row: {
  id: string;
  referredUsername: string;
  referredDisplayName: string | null;
  rewardPoints: number;
  status: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    referredUsername: row.referredUsername,
    referredDisplayName: row.referredDisplayName,
    rewardPoints: row.rewardPoints,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
