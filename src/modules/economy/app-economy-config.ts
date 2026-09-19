import type { AppEconomyConfig, Prisma, PrismaClient } from "@prisma/client";

import { DEFAULT_USD_INR_RATE } from "../payments/application/payment-money.js";

export const APP_ECONOMY_CONFIG_ID = "default";

/** Fallback when DB row is missing / not migrated yet. */
export const DEFAULT_FREE_DAILY_INTEREST_GRANTS = 10;

export type EconomyConfigView = {
  videoCallEnabled: boolean;
  videoCallPointsPerMinute: number;
  videoCallRingTimeoutSec: number;
  /** INR per 1 USD — converts one admin price for India (INR) vs international (USD). */
  usdInrRate: number;
  /**
   * Free-tier users: how many interests they can send per UTC day at 0 points.
   * 0 = no free interests (everyone pays points after premium waiver rules).
   */
  freeDailyInterestGrants: number;
  updatedAt: string;
};

export function presentEconomyConfig(config: AppEconomyConfig): EconomyConfigView {
  const grants =
    typeof config.freeDailyInterestGrants === "number" &&
    Number.isFinite(config.freeDailyInterestGrants)
      ? Math.max(0, Math.min(100, Math.trunc(config.freeDailyInterestGrants)))
      : DEFAULT_FREE_DAILY_INTEREST_GRANTS;
  return {
    videoCallEnabled: config.videoCallEnabled,
    videoCallPointsPerMinute: config.videoCallPointsPerMinute,
    videoCallRingTimeoutSec: config.videoCallRingTimeoutSec,
    usdInrRate:
      typeof config.usdInrRate === "number" && config.usdInrRate > 0
        ? config.usdInrRate
        : DEFAULT_USD_INR_RATE,
    freeDailyInterestGrants: grants,
    updatedAt: config.updatedAt.toISOString(),
  };
}

export async function ensureAppEconomyConfig(
  database: PrismaClient | Prisma.TransactionClient,
): Promise<AppEconomyConfig> {
  return database.appEconomyConfig.upsert({
    where: { id: APP_ECONOMY_CONFIG_ID },
    create: { id: APP_ECONOMY_CONFIG_ID },
    update: {},
  });
}

export async function getUsdInrRate(
  database: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const row = await ensureAppEconomyConfig(database);
  return presentEconomyConfig(row).usdInrRate;
}

export async function getFreeDailyInterestGrants(
  database: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const row = await ensureAppEconomyConfig(database);
  return presentEconomyConfig(row).freeDailyInterestGrants;
}

export async function updateAppEconomyConfig(
  database: PrismaClient,
  data: {
    videoCallEnabled?: boolean;
    videoCallPointsPerMinute?: number;
    videoCallRingTimeoutSec?: number;
    usdInrRate?: number;
    freeDailyInterestGrants?: number;
  },
): Promise<AppEconomyConfig> {
  await ensureAppEconomyConfig(database);
  return database.appEconomyConfig.update({
    where: { id: APP_ECONOMY_CONFIG_ID },
    data: {
      ...(data.videoCallEnabled !== undefined
        ? { videoCallEnabled: data.videoCallEnabled }
        : {}),
      ...(data.videoCallPointsPerMinute !== undefined
        ? { videoCallPointsPerMinute: data.videoCallPointsPerMinute }
        : {}),
      ...(data.videoCallRingTimeoutSec !== undefined
        ? { videoCallRingTimeoutSec: data.videoCallRingTimeoutSec }
        : {}),
      ...(data.usdInrRate !== undefined ? { usdInrRate: data.usdInrRate } : {}),
      ...(data.freeDailyInterestGrants !== undefined
        ? {
            freeDailyInterestGrants: Math.max(
              0,
              Math.min(100, Math.trunc(data.freeDailyInterestGrants)),
            ),
          }
        : {}),
    },
  });
}
