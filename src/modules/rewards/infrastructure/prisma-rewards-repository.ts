import {
  Prisma,
  UserStatus,
  WalletTransactionType,
  type PrismaClient,
} from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
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
import { InsufficientWalletBalanceError } from "../application/ports/rewards-repository.js";

export { InsufficientWalletBalanceError };

export class PrismaRewardsRepository implements RewardsRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  async bootstrapInTransaction(
    transaction: Prisma.TransactionClient,
    input: SignupRewardsInput,
  ): Promise<void> {
    const referrerId = input.referralCode
      ? await this.resolveReferrerInTransaction(transaction, input.referralCode)
      : null;

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

    await this.createReferralCode(transaction, input.userId, input.username);

    if (referrerId && referrerId !== input.userId) {
      await transaction.user.update({
        where: { id: input.userId },
        data: { referredByUserId: referrerId },
      });

      const referral = await transaction.referral.create({
        data: {
          referrerUserId: referrerId,
          referredUserId: input.userId,
          rewardPoints: this.config.REFERRAL_REWARD_POINTS,
        },
      });

      await creditWallet(transaction, {
        userId: referrerId,
        amount: this.config.REFERRAL_REWARD_POINTS,
        type: WalletTransactionType.REFERRAL_REWARD,
        idempotencyKey: `referral:${referral.id}`,
        referenceType: "referral",
        referenceId: referral.id,
          description: "Referral Milox Points",
      });

      await transaction.outboxEvent.create({
        data: {
          eventType: "referral.rewarded",
          aggregateType: "referral",
          aggregateId: referral.id,
          payload: {
            referralId: referral.id,
            referrerUserId: referrerId,
            referredUserId: input.userId,
            rewardPoints: this.config.REFERRAL_REWARD_POINTS,
          },
        },
      });
    }
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
      interestSendCost: this.config.INTEREST_SEND_COST,
      referralRewardPoints: this.config.REFERRAL_REWARD_POINTS,
      postRewardPoints: this.config.POST_REWARD_POINTS,
      welcomeBonus: this.config.WALLET_WELCOME_BONUS,
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
      inviteUrl: referralInviteUrl(this.config.WEB_ORIGIN, codeRow.code),
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
