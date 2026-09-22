import {
  Prisma,
  UserStatus,
  WalletTransactionType,
  type PrismaClient,
} from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import { INTEREST_SEND_COST_POINTS } from "../../../config/wallet-economy.js";
import {
  generateReferralCode,
  normalizeReferralCode,
  referralInviteUrl,
} from "./referral-code.js";
import type {
  ReferralInfo,
  ReferralInviteRecord,
  RewardsRepository,
  SignupRewardsInput,
  WalletSummary,
  WalletTransactionRecord,
} from "../application/ports/rewards-repository.js";
import {
  InsufficientWalletBalanceError,
  InvalidReferralCodeError,
  RewardedAdDailyLimitError,
  DailyCheckInAlreadyClaimedError,
} from "../application/ports/rewards-repository.js";

export {
  InsufficientWalletBalanceError,
  RewardedAdDailyLimitError,
  DailyCheckInAlreadyClaimedError,
};

export class PrismaRewardsRepository implements RewardsRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  async bootstrapInTransaction(
    transaction: Prisma.TransactionClient,
    input: SignupRewardsInput,
  ): Promise<void> {
    await transaction.wallet.create({
      data: {
        userId: input.userId,
        balance: this.config.WALLET_WELCOME_BONUS,
        lifetimeEarned: this.config.WALLET_WELCOME_BONUS,
      },
    });
    await transaction.walletTransaction.create({
      data: {
        walletUserId: input.userId,
        type: WalletTransactionType.WELCOME_BONUS,
        amount: this.config.WALLET_WELCOME_BONUS,
        balanceAfter: this.config.WALLET_WELCOME_BONUS,
        referenceType: "signup",
        idempotencyKey: `welcome:${input.userId}`,
        description: "Welcome Milox Points",
      },
    });
  }

  async getWalletSummary(userId: string): Promise<WalletSummary | null> {
    const wallet = await this.database.wallet.findUnique({
      where: { userId },
      select: {
        balance: true,
        lifetimeEarned: true,
        lifetimeSpent: true,
      },
    });
    if (!wallet) return null;
    return {
      balance: wallet.balance,
      lifetimeEarned: wallet.lifetimeEarned,
      lifetimeSpent: wallet.lifetimeSpent,
      interestSendCost: INTEREST_SEND_COST_POINTS,
      postRewardPoints: this.config.POST_REWARD_POINTS,
      welcomeBonus: this.config.WALLET_WELCOME_BONUS,
      rewardedAdPoints: this.config.REWARDED_AD_POINTS,
      rewardedAdDailyLimit: this.config.REWARDED_AD_DAILY_LIMIT,
    };
  }

  listTransactions(
    userId: string,
    limit: number,
  ): Promise<WalletTransactionRecord[]> {
    return this.database.walletTransaction.findMany({
      where: { walletUserId: userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        description: true,
        createdAt: true,
      },
    });
  }

  async getReferralInfo(userId: string): Promise<ReferralInfo | null> {
    const codeRow = await this.database.referralCode.findUnique({
      where: { userId },
      select: { code: true },
    });
    if (!codeRow) return null;

    const [totalInvited, earnedRows] = await Promise.all([
      this.database.referral.count({
        where: { referrerUserId: userId, status: "QUALIFIED" },
      }),
      this.database.walletTransaction.findMany({
        where: {
          walletUserId: userId,
          type: WalletTransactionType.REFERRAL_REWARD,
        },
        select: { amount: true },
      }),
    ]);

    return {
      code: codeRow.code,
      inviteUrl: referralInviteUrl(this.config.PUBLIC_WEB_ORIGIN, codeRow.code),
      totalInvited,
      totalEarned: earnedRows.reduce((sum, row) => sum + row.amount, 0),
      rewardPerReferral: this.config.REFERRAL_REWARD_POINTS,
    };
  }

  listReferrals(userId: string, limit: number): Promise<ReferralInviteRecord[]> {
    return this.database.referral.findMany({
      where: { referrerUserId: userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        rewardPoints: true,
        status: true,
        createdAt: true,
        referred: {
          select: {
            username: true,
            displayName: true,
          },
        },
      },
    }).then((rows) =>
      rows.map((row) => ({
        id: row.id,
        referredUsername: row.referred.username,
        referredDisplayName: row.referred.displayName,
        rewardPoints: row.rewardPoints,
        status: row.status,
        createdAt: row.createdAt,
      })),
    );
  }

  async resolveReferrerId(referralCode: string): Promise<string | null> {
    const normalized = normalizeReferralCode(referralCode);
    const row = await this.database.referralCode.findUnique({
      where: { code: normalized },
      select: {
        userId: true,
        user: { select: { status: true } },
      },
    });
    if (!row || row.user.status !== UserStatus.ACTIVE) return null;
    return row.userId;
  }

  async debitForInterest(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      interestId: string;
      cost: number;
      idempotencyKey: string;
    },
  ): Promise<void> {
    if (input.cost <= 0) return;

    await debitWallet(transaction, {
      userId: input.userId,
      amount: input.cost,
      type: WalletTransactionType.INTEREST_SEND,
      idempotencyKey: input.idempotencyKey,
      referenceType: "interest",
      referenceId: input.interestId,
      description: "Interest sent",
    });
  }

  async creditForPost(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      postId: string;
    },
  ): Promise<void> {
    const amount = this.config.POST_REWARD_POINTS;
    if (amount <= 0) return;

    const wallet = await transaction.wallet.findUnique({
      where: { userId: input.userId },
      select: { userId: true },
    });
    if (!wallet) return;

    await creditWallet(transaction, {
      userId: input.userId,
      amount,
      type: WalletTransactionType.POST_REWARD,
      idempotencyKey: `post-reward:${input.postId}`,
      referenceType: "post",
      referenceId: input.postId,
      description: "Post Milox Points",
    });
  }

  private async resolveReferrerInTransaction(
    transaction: Prisma.TransactionClient,
    referralCode: string,
  ): Promise<string | null> {
    const normalized = normalizeReferralCode(referralCode);
    const row = await transaction.referralCode.findUnique({
      where: { code: normalized },
      select: {
        userId: true,
        user: { select: { status: true } },
      },
    });
    if (!row || row.user.status !== UserStatus.ACTIVE) return null;
    return row.userId;
  }

  private async createReferralCode(
    transaction: Prisma.TransactionClient,
    userId: string,
    username: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateReferralCode(username);
      try {
        await transaction.referralCode.create({
          data: { userId, code },
        });
        return;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unable to allocate referral code");
  }

  async creditRewardedAd(
    userId: string,
    claimId: string,
  ): Promise<{ amount: number; balance: number }> {
    const todayStart = startOfUtcDay();
    const existing = await this.database.walletTransaction.findUnique({
      where: { idempotencyKey: `rewarded-ad:${claimId}` },
      select: {
        amount: true,
        balanceAfter: true,
      },
    });
    if (existing) {
      return {
        amount: existing.amount,
        balance: existing.balanceAfter,
      };
    }

    const rewardedToday = await this.database.walletTransaction.count({
      where: {
        walletUserId: userId,
        type: WalletTransactionType.REWARDED_AD,
        createdAt: { gte: todayStart },
      },
    });
    if (rewardedToday >= this.config.REWARDED_AD_DAILY_LIMIT) {
      throw new RewardedAdDailyLimitError();
    }

    return this.database.$transaction(async (transaction) => {
      await creditWallet(transaction, {
        userId,
        amount: this.config.REWARDED_AD_POINTS,
        type: WalletTransactionType.REWARDED_AD,
        idempotencyKey: `rewarded-ad:${claimId}`,
        referenceType: "rewarded_ad",
        description: "Watched reward ad",
      });

      const wallet = await transaction.wallet.findUnique({
        where: { userId },
        select: { balance: true },
      });
      if (!wallet) {
        throw new Error("Wallet missing after rewarded ad credit");
      }

      return {
        amount: this.config.REWARDED_AD_POINTS,
        balance: wallet.balance,
      };
    });
  }

  async getDailyCheckInStatus(userId: string): Promise<{
    claimedToday: boolean;
    streakDays: number;
    points: number;
  }> {
    const points = this.config.DAILY_CHECK_IN_POINTS;
    const todayKey = checkInDayKey(new Date(), this.config.DAILY_CHECK_IN_TIMEZONE);
    const claimedToday = Boolean(
      await this.database.walletTransaction.findUnique({
        where: { idempotencyKey: dailyCheckInKey(userId, todayKey) },
        select: { id: true },
      }),
    );
    const streakDays = await this.computeStreakDays(userId, claimedToday);
    return { claimedToday, streakDays, points };
  }

  async claimDailyCheckIn(userId: string): Promise<{
    amount: number;
    balance: number;
    streakDays: number;
  }> {
    const todayKey = checkInDayKey(new Date(), this.config.DAILY_CHECK_IN_TIMEZONE);
    const idempotencyKey = dailyCheckInKey(userId, todayKey);
    const amount = this.config.DAILY_CHECK_IN_POINTS;

    const existing = await this.database.walletTransaction.findUnique({
      where: { idempotencyKey },
      select: { amount: true, balanceAfter: true },
    });
    if (existing) {
      throw new DailyCheckInAlreadyClaimedError();
    }

    try {
      const result = await this.database.$transaction(async (transaction) => {
        await creditWallet(transaction, {
          userId,
          amount,
          type: WalletTransactionType.DAILY_CHECK_IN,
          idempotencyKey,
          referenceType: "daily_check_in",
          // referenceId is @db.Uuid — do not store day keys here.
          // Streak uses createdAt / idempotencyKey instead.
          description: `Daily check-in (${todayKey})`,
        });

        const wallet = await transaction.wallet.findUnique({
          where: { userId },
          select: { balance: true },
        });
        if (!wallet) {
          throw new Error("Wallet missing after daily check-in credit");
        }

        return {
          amount,
          balance: wallet.balance,
        };
      });

      const streakDays = await this.computeStreakDays(userId, true);
      return { ...result, streakDays };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new DailyCheckInAlreadyClaimedError();
      }
      throw error;
    }
  }

  private async computeStreakDays(
    userId: string,
    claimedToday: boolean,
  ): Promise<number> {
    const timeZone = this.config.DAILY_CHECK_IN_TIMEZONE;
    const rows = await this.database.walletTransaction.findMany({
      where: {
        walletUserId: userId,
        type: WalletTransactionType.DAILY_CHECK_IN,
      },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { createdAt: true, referenceId: true },
    });
    if (rows.length === 0) return claimedToday ? 1 : 0;

    const days = new Set(
      rows.map((row) =>
        row.referenceId && /^\d{4}-\d{2}-\d{2}$/.test(row.referenceId)
          ? row.referenceId
          : checkInDayKey(row.createdAt, timeZone),
      ),
    );
    let cursor = new Date();
    if (!claimedToday) {
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    let streak = 0;
    while (days.has(checkInDayKey(cursor, timeZone))) {
      streak += 1;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    return streak;
  }

  listActivePointPacks() {
    return this.database.pointPurchaseRate.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { amountMinor: "asc" }],
      select: {
        id: true,
        currency: true,
        amountMinor: true,
        points: true,
        label: true,
        sortOrder: true,
      },
    });
  }
}

function dailyCheckInKey(userId: string, dayKey: string): string {
  return `daily-checkin:${userId}:${dayKey}`;
}

/** Calendar day key in the given IANA timezone (YYYY-MM-DD). */
function checkInDayKey(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

async function creditWallet(
  transaction: Prisma.TransactionClient,
  input: {
    userId: string;
    amount: number;
    type: WalletTransactionType;
    idempotencyKey: string;
    referenceType?: string;
    referenceId?: string;
    description?: string;
  },
): Promise<void> {
  const wallet = await transaction.wallet.update({
    where: { userId: input.userId },
    data: {
      balance: { increment: input.amount },
      lifetimeEarned: { increment: input.amount },
    },
    select: { balance: true },
  });

  await transaction.walletTransaction.create({
    data: {
      walletUserId: input.userId,
      type: input.type,
      amount: input.amount,
      balanceAfter: wallet.balance,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      idempotencyKey: input.idempotencyKey,
      description: input.description ?? null,
    },
  });
}

async function debitWallet(
  transaction: Prisma.TransactionClient,
  input: {
    userId: string;
    amount: number;
    type: WalletTransactionType;
    idempotencyKey: string;
    referenceType?: string;
    referenceId?: string;
    description?: string;
  },
): Promise<void> {
  const current = await transaction.wallet.findUnique({
    where: { userId: input.userId },
    select: { balance: true },
  });
  if (!current || current.balance < input.amount) {
    throw new InsufficientWalletBalanceError();
  }

  const wallet = await transaction.wallet.update({
    where: { userId: input.userId },
    data: {
      balance: { decrement: input.amount },
      lifetimeSpent: { increment: input.amount },
    },
    select: { balance: true },
  });

  await transaction.walletTransaction.create({
    data: {
      walletUserId: input.userId,
      type: input.type,
      amount: -input.amount,
      balanceAfter: wallet.balance,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      idempotencyKey: input.idempotencyKey,
      description: input.description ?? null,
    },
  });
}

export { creditWallet, debitWallet };

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
