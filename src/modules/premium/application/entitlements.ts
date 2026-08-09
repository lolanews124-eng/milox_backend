import type { PremiumTier, PrismaClient } from "@prisma/client";
import { SubscriptionStatus } from "@prisma/client";

export interface PremiumFeatures {
  adsFree: boolean;
  houseAdsFree: boolean;
  profileViews: boolean;
  discoverBoost: number;
  premiumBadge: boolean;
  badgeLabel: string | null;
  grantVerifiedBadge: boolean;
  dailyInterestLimit: number;
  interstitialAdsFree: boolean;
  directMessageEnabled: boolean;
}

export interface UserEntitlements {
  tier: PremiumTier;
  planCode: string | null;
  planName: string | null;
  expiresAt: string | null;
  isPremium: boolean;
  features: PremiumFeatures;
}

const UNLIMITED_INTERESTS = 9999;

export function hasUnlimitedInterests(dailyInterestLimit: number): boolean {
  return dailyInterestLimit >= UNLIMITED_INTERESTS;
}

export function interestSendCostForEntitlements(
  entitlements: UserEntitlements,
  baseCost: number,
): number {
  return hasUnlimitedInterests(entitlements.features.dailyInterestLimit)
    ? 0
    : baseCost;
}

function activeSubscriptionWhere(now: Date) {
  return {
    status: SubscriptionStatus.ACTIVE,
    startsAt: { lte: now },
    endsAt: { gt: now },
  } as const;
}

async function maybeRevokePremiumVerifiedBadge(
  database: PrismaClient,
  userId: string,
): Promise<void> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { isVerifiedBadge: true },
  });
  if (!user?.isVerifiedBadge) return;

  const adminGrant = await database.auditLog.findFirst({
    where: {
      resourceType: "user",
      resourceId: userId,
      action: "admin.user.verified_badge_changed",
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });

  const metadata = adminGrant?.metadata;
  const adminSetVerified =
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as { isVerifiedBadge?: boolean }).isVerifiedBadge === true;

  if (!adminSetVerified) {
    await database.user.update({
      where: { id: userId },
      data: { isVerifiedBadge: false },
    });
  }
}

export const FREE_ENTITLEMENTS: UserEntitlements = {
  tier: "FREE",
  planCode: null,
  planName: null,
  expiresAt: null,
  isPremium: false,
  features: {
    adsFree: false,
    houseAdsFree: false,
    profileViews: false,
    discoverBoost: 0,
    premiumBadge: false,
    badgeLabel: null,
    grantVerifiedBadge: false,
    dailyInterestLimit: 20,
    interstitialAdsFree: false,
    directMessageEnabled: false,
  },
};

export function normalizeInterestLimit(limit: number, fallback = 20): number {
  if (limit >= UNLIMITED_INTERESTS) return UNLIMITED_INTERESTS;
  if (limit <= 0) return fallback;
  return limit;
}

export function entitlementsFromPlan(plan: {
  tier: PremiumTier;
  code: string;
  name: string;
  badgeLabel: string;
  adsFree: boolean;
  houseAdsFree: boolean;
  profileViews: boolean;
  discoverBoost: number;
  grantVerifiedBadge: boolean;
  dailyInterestLimit: number;
  interstitialAdsFree: boolean;
  directMessageEnabled: boolean;
}, expiresAt: Date): UserEntitlements {
  return {
    tier: plan.tier,
    planCode: plan.code,
    planName: plan.name,
    expiresAt: expiresAt.toISOString(),
    isPremium: plan.tier !== "FREE",
    features: {
      adsFree: plan.adsFree,
      houseAdsFree: plan.houseAdsFree,
      profileViews: plan.profileViews,
      discoverBoost: plan.discoverBoost,
      premiumBadge: plan.tier !== "FREE",
      badgeLabel: plan.badgeLabel,
      grantVerifiedBadge: plan.grantVerifiedBadge,
      dailyInterestLimit: normalizeInterestLimit(plan.dailyInterestLimit),
      interstitialAdsFree: plan.interstitialAdsFree,
      directMessageEnabled: plan.directMessageEnabled,
    },
  };
}

export async function resolveUserEntitlements(
  database: PrismaClient,
  userId: string,
  freeDailyInterestLimit = 20,
): Promise<UserEntitlements> {
  const now = new Date();
  const subscription = await database.userSubscription.findFirst({
    where: {
      userId,
      ...activeSubscriptionWhere(now),
    },
    orderBy: [{ endsAt: "desc" }],
    select: {
      endsAt: true,
      plan: {
        select: {
          tier: true,
          code: true,
          name: true,
          badgeLabel: true,
          adsFree: true,
          houseAdsFree: true,
          profileViews: true,
          discoverBoost: true,
          grantVerifiedBadge: true,
          dailyInterestLimit: true,
          interstitialAdsFree: true,
          directMessageEnabled: true,
        },
      },
    },
  });

  if (!subscription) {
    return {
      ...FREE_ENTITLEMENTS,
      features: {
        ...FREE_ENTITLEMENTS.features,
        dailyInterestLimit: freeDailyInterestLimit,
      },
    };
  }

  return entitlementsFromPlan(subscription.plan, subscription.endsAt);
}

export async function syncUserPremiumState(
  database: PrismaClient,
  userId: string,
): Promise<void> {
  const now = new Date();
  const subscription = await database.userSubscription.findFirst({
    where: {
      userId,
      ...activeSubscriptionWhere(now),
    },
    orderBy: [{ endsAt: "desc" }],
    select: {
      endsAt: true,
      plan: {
        select: {
          tier: true,
          discoverBoost: true,
          grantVerifiedBadge: true,
        },
      },
    },
  });

  if (!subscription) {
    await database.user.update({
      where: { id: userId },
      data: {
        premiumTier: "FREE",
        premiumExpiresAt: null,
        discoverBoost: 0,
      },
    });
    await maybeRevokePremiumVerifiedBadge(database, userId);
    return;
  }

  await database.user.update({
    where: { id: userId },
    data: {
      premiumTier: subscription.plan.tier,
      premiumExpiresAt: subscription.endsAt,
      discoverBoost: subscription.plan.discoverBoost,
    },
  });
}

export function presentEntitlements(entitlements: UserEntitlements): object {
  return entitlements;
}

export function premiumBadgeForTier(tier: PremiumTier): {
  show: boolean;
  label: string;
  tier: PremiumTier;
} | null {
  if (tier === "FREE") return null;
  const labels: Record<Exclude<PremiumTier, "FREE">, string> = {
    PLUS: "Plus",
    GOLD: "Gold",
    ELITE: "Elite",
  };
  return {
    show: true,
    label: labels[tier],
    tier,
  };
}
