import type {
  Prisma,
  ReferralStatus,
  WalletTransactionType,
} from "@prisma/client";

export class InsufficientWalletBalanceError extends Error {}

export class RewardedAdDailyLimitError extends Error {}

export interface WalletSummary {
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  interestSendCost: number;
  referralRewardPoints: number;
  postRewardPoints: number;
  welcomeBonus: number;
  rewardedAdPoints: number;
  rewardedAdDailyLimit: number;
}

export interface WalletTransactionRecord {
  id: string;
  type: WalletTransactionType;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: Date;
}

export interface ReferralInfo {
  code: string;
  inviteUrl: string;
  totalInvited: number;
  totalEarned: number;
  rewardPerReferral: number;
}

export interface ReferralInviteRecord {
  id: string;
  referredUsername: string;
  referredDisplayName: string | null;
  rewardPoints: number;
  status: ReferralStatus;
  createdAt: Date;
}

export interface SignupRewardsInput {
  userId: string;
  username: string;
  referralCode?: string | undefined;
}

export interface SignupRewardsWriter {
  bootstrapInTransaction(
    transaction: Prisma.TransactionClient,
    input: SignupRewardsInput,
  ): Promise<void>;
}

export interface RewardsRepository extends SignupRewardsWriter {
  getWalletSummary(userId: string): Promise<WalletSummary | null>;
  listTransactions(
    userId: string,
    limit: number,
  ): Promise<WalletTransactionRecord[]>;
  getReferralInfo(userId: string): Promise<ReferralInfo | null>;
  listReferrals(userId: string, limit: number): Promise<ReferralInviteRecord[]>;
  resolveReferrerId(referralCode: string): Promise<string | null>;
  debitForInterest(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      interestId: string;
      cost: number;
      idempotencyKey: string;
    },
  ): Promise<void>;
  creditForPost(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      postId: string;
    },
  ): Promise<void>;
  creditRewardedAd(
    userId: string,
    claimId: string,
  ): Promise<{ amount: number; balance: number }>;
}
