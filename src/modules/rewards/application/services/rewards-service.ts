import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type { PrismaClient } from "@prisma/client";
import {
  freeInterestsRemaining,
  resolveInterestSendCost,
  resolveUserEntitlements,
} from "../../../premium/application/entitlements.js";
import type { RewardsRepository } from "../ports/rewards-repository.js";
import { RewardedAdDailyLimitError } from "../ports/rewards-repository.js";
import { DailyCheckInAlreadyClaimedError } from "../ports/rewards-repository.js";
import { ensureAppEconomyConfig } from "../../../economy/app-economy-config.js";
import {
  awardStreakMilestoneIfNeeded,
  getDailyEngagement,
  recordDailyMission,
  type DailyMissionId,
} from "../daily-engagement.js";

export class RewardsService {
  constructor(
    private readonly repository: RewardsRepository,
    private readonly config: AppConfig,
    private readonly database: PrismaClient,
  ) {}

  async getWallet(userId: string, options: { syncEngagement?: boolean } = {}) {
    const syncEngagement = options.syncEngagement === true;
    const wallet = await this.repository.getWalletSummary(userId);
    if (!wallet) {
      throw new AppError("WALLET_NOT_FOUND", "Milox Points not found", 404);
    }
    const [entitlements, economy, sentToday, dailyCheckIn] = await Promise.all([
      resolveUserEntitlements(
        this.database,
        userId,
        this.config.INTEREST_DAILY_LIMIT,
      ),
      ensureAppEconomyConfig(this.database),
      this.database.interest.count({
        where: {
          senderId: userId,
          createdAt: { gte: startOfUtcDay() },
        },
      }),
      this.repository.getDailyCheckInStatus(userId),
    ]);

    if (syncEngagement && dailyCheckIn.streakDays >= 7) {
      try {
        await awardStreakMilestoneIfNeeded(
          this.database,
          this.config,
          userId,
          dailyCheckIn.streakDays,
        );
      } catch {
        /* optional */
      }
    }

    const dailyEngagement = await getDailyEngagement(
      this.database,
      this.config,
      userId,
      dailyCheckIn.streakDays,
      { sync: syncEngagement },
    );

    // Only re-read balance after sync path (may have credited missions/badge).
    const balanced =
      syncEngagement
        ? ((await this.repository.getWalletSummary(userId)) ?? wallet)
        : wallet;

    const freeDailyInterestGrants =
      typeof economy.freeDailyInterestGrants === "number"
        ? Math.max(0, Math.min(100, Math.trunc(economy.freeDailyInterestGrants)))
        : this.config.FREE_DAILY_INTEREST_GRANTS;
    const baseInterestCost = balanced.interestSendCost;
    const nextInterestCost = resolveInterestSendCost(
      entitlements,
      baseInterestCost,
      sentToday,
      freeDailyInterestGrants,
    );
    return presentWallet({
      ...balanced,
      videoCallEnabled: economy.videoCallEnabled,
      videoCallPointsPerMinute: economy.videoCallPointsPerMinute,
      interestSendCost: nextInterestCost,
      paidInterestCost: baseInterestCost,
      interestsSentToday: sentToday,
      freeDailyInterestGrants,
      freeInterestsRemaining: freeInterestsRemaining(
        entitlements,
        sentToday,
        freeDailyInterestGrants,
      ),
      dailyInterestLimit: null,
      dailyCheckInAvailable: !dailyCheckIn.claimedToday,
      dailyCheckInStreak: dailyCheckIn.streakDays,
      dailyCheckInPoints: dailyCheckIn.points,
      dailyEngagement,
    });
  }

  async getDailyEngagement(userId: string) {
    const status = await this.repository.getDailyCheckInStatus(userId);
    if (status.streakDays >= 7) {
      try {
        await awardStreakMilestoneIfNeeded(
          this.database,
          this.config,
          userId,
          status.streakDays,
        );
      } catch {
        /* optional */
      }
    }
    return getDailyEngagement(
      this.database,
      this.config,
      userId,
      status.streakDays,
      { sync: true },
    );
  }

  recordMission(userId: string, mission: DailyMissionId) {
    return recordDailyMission(this.database, this.config, userId, mission);
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
      throw new AppError(
        "REFERRAL_NOT_FOUND",
        "Referral profile not found",
        404,
      );
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

  async claimDailyCheckIn(userId: string) {
    try {
      const result = await this.repository.claimDailyCheckIn(userId);
      let milestone: { awarded: number; badge: string | null } = {
        awarded: 0,
        badge: null,
      };
      try {
        milestone = await awardStreakMilestoneIfNeeded(
          this.database,
          this.config,
          userId,
          result.streakDays,
        );
      } catch (milestoneError) {
        // Check-in already credited — never fail the claim because the
        // optional streak badge credit hit a transient/enum issue.
        const message =
          milestoneError instanceof Error
            ? milestoneError.message
            : String(milestoneError);
        if (
          !(
            message.includes("STREAK_MILESTONE") ||
            message.includes("invalid input value for enum") ||
            message.includes("DAILY_MISSION")
          )
        ) {
          // Unexpected — still return check-in success; badge can sync later.
        }
      }
      return {
        amount: result.amount,
        checkInAmount: result.amount,
        balance: result.balance + milestone.awarded,
        streakDays: result.streakDays,
        streakBadgeAwarded: milestone.badge,
        streakBadgePoints: milestone.awarded,
      };
    } catch (error) {
      if (error instanceof DailyCheckInAlreadyClaimedError) {
        throw new AppError(
          "DAILY_CHECK_IN_CLAIMED",
          "You already claimed today's check-in. Come back tomorrow!",
          409,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("DAILY_CHECK_IN") ||
        message.includes("invalid input value for enum")
      ) {
        throw new AppError(
          "DAILY_CHECK_IN_UNAVAILABLE",
          "Daily check-in is temporarily unavailable. Please try again later.",
          503,
        );
      }
      throw error;
    }
  }

  async listPointPacks() {
    const packs = await this.repository.listActivePointPacks();
    return {
      items: packs.map((pack) => ({
        id: pack.id,
        currency: pack.currency,
        amountMinor: pack.amountMinor,
        points: pack.points,
        label: pack.label,
        sortOrder: pack.sortOrder,
      })),
    };
  }
}

function presentWallet(wallet: {
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  interestSendCost: number;
  postRewardPoints: number;
  welcomeBonus: number;
  rewardedAdPoints: number;
  rewardedAdDailyLimit: number;
  videoCallEnabled: boolean;
  videoCallPointsPerMinute: number;
  interestsSentToday: number;
  freeDailyInterestGrants: number;
  freeInterestsRemaining: number;
  dailyInterestLimit: number | null;
  paidInterestCost: number;
  dailyCheckInAvailable: boolean;
  dailyCheckInStreak: number;
  dailyCheckInPoints: number;
  dailyEngagement: Awaited<ReturnType<typeof getDailyEngagement>>;
}) {
  return {
    balance: wallet.balance,
    lifetimeEarned: wallet.lifetimeEarned,
    lifetimeSpent: wallet.lifetimeSpent,
    interestSendCost: wallet.interestSendCost,
    interestsSentToday: wallet.interestsSentToday,
    freeDailyInterestGrants: wallet.freeDailyInterestGrants,
    freeInterestsRemaining: wallet.freeInterestsRemaining,
    dailyInterestLimit: wallet.dailyInterestLimit,
    paidInterestCost: wallet.paidInterestCost,
    postRewardPoints: wallet.postRewardPoints,
    welcomeBonus: wallet.welcomeBonus,
    rewardedAdPoints: wallet.rewardedAdPoints,
    rewardedAdDailyLimit: wallet.rewardedAdDailyLimit,
    videoCallEnabled: wallet.videoCallEnabled,
    videoCallPointsPerMinute: wallet.videoCallPointsPerMinute,
    dailyCheckInAvailable: wallet.dailyCheckInAvailable,
    dailyCheckInStreak: wallet.dailyCheckInStreak,
    dailyCheckInPoints: wallet.dailyCheckInPoints,
    dailyEngagement: wallet.dailyEngagement,
  };
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
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
