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
  sentToday = 0,
  freeDailyGrants = 0,
): number {
  return resolveInterestSendCost(
    entitlements,
    baseCost,
    sentToday,
    freeDailyGrants,
  );
}

export function resolveInterestSendCost(
  entitlements: UserEntitlements,
  baseCost: number,
  sentToday: number,
  freeDailyGrants: number,
): number {
  if (hasUnlimitedInterests(entitlements.features.dailyInterestLimit)) {
    return 0;
  }
  if (entitlements.isPremium) {
    return 0;
  }
  if (sentToday < freeDailyGrants) {
    return 0;
  }
  return baseCost;
}

export function freeInterestsRemaining(
  entitlements: UserEntitlements,
  sentToday: number,
  freeDailyGrants: number,
): number {
  if (hasUnlimitedInterests(entitlements.features.dailyInterestLimit)) {
    return 9999;
  }
  if (entitlements.isPremium) {
    return Math.max(
      0,
      entitlements.features.dailyInterestLimit - sentToday,
    );
  }
  return Math.max(0, freeDailyGrants - sentToday);
}

function activeSubscriptionWhere(now: Date) {
  return {
    status: SubscriptionStatus.ACTIVE,
    startsAt: { lte: now },
    endsAt: { gt: now },
  } as const;
}

export async function userHasStandaloneVerifiedBadge(
  database: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { isVerifiedBadge: true, verifiedBadgeExpiresAt: true },
  });
  if (!user?.isVerifiedBadge) return false;
  if (user.verifiedBadgeExpiresAt && user.verifiedBadgeExpiresAt > now) {
    return true;
  }

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
  if (adminSetVerified && !user.verifiedBadgeExpiresAt) {
    return true;
  }

  const paid = await database.verifiedBadgeOrder.findFirst({
    where: {
      userId,
      status: "COMPLETED",
      OR: [{ badgeExpiresAt: null }, { badgeExpiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  return Boolean(paid);
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
  const keep = await userHasStandaloneVerifiedBadge(database, userId);
  if (keep) return;

  await database.user.update({
    where: { id: userId },
    data: { isVerifiedBadge: false, verifiedBadgeExpiresAt: null },
  });
}

export async function expireStandaloneVerifiedBadges(
  database: PrismaClient,
): Promise<void> {
  const now = new Date();
  const expired = await database.user.findMany({
    where: {
      isVerifiedBadge: true,
      verifiedBadgeExpiresAt: { lte: now },
    },
    select: { id: true },
    take: 200,
  });
  for (const row of expired) {
    const entitlements = await resolveUserEntitlements(database, row.id);
    if (entitlements.features.grantVerifiedBadge) {
      await database.user.update({
        where: { id: row.id },
        data: {
          isVerifiedBadge: true,
          verifiedBadgeExpiresAt: entitlements.expiresAt
            ? new Date(entitlements.expiresAt)
            : null,
        },
      });
      continue;
    }
    await maybeRevokePremiumVerifiedBadge(database, row.id);
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
    dailyInterestLimit: 30,
    interstitialAdsFree: false,
    directMessageEnabled: false,
  },
};

export function normalizeInterestLimit(limit: number, fallback = 30): number {
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
  freeDailyInterestLimit = 30,
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
