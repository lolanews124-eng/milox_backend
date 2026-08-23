import type { AppEconomyConfig, Prisma, PrismaClient } from "@prisma/client";

export const APP_ECONOMY_CONFIG_ID = "default";

export type EconomyConfigView = {
  videoCallEnabled: boolean;
  videoCallPointsPerMinute: number;
  videoCallRingTimeoutSec: number;
  updatedAt: string;
};

export function presentEconomyConfig(config: AppEconomyConfig): EconomyConfigView {
  return {
    videoCallEnabled: config.videoCallEnabled,
    videoCallPointsPerMinute: config.videoCallPointsPerMinute,
    videoCallRingTimeoutSec: config.videoCallRingTimeoutSec,
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

export async function updateAppEconomyConfig(
  database: PrismaClient,
  data: {
    videoCallEnabled?: boolean;
    videoCallPointsPerMinute?: number;
    videoCallRingTimeoutSec?: number;
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
    },
  });
}
