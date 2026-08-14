import type { MobileAppConfig, Prisma, PrismaClient } from "@prisma/client";

export const MOBILE_APP_CONFIG_ID = "default";

export function presentMobileAppConfig(config: MobileAppConfig): object {
  return {
    latestVersion: config.latestVersion,
    androidMinBuild: config.androidMinBuild,
    iosMinBuild: config.iosMinBuild,
    forceUpdate: config.forceUpdate,
    androidStoreUrl: config.androidStoreUrl,
    iosStoreUrl: config.iosStoreUrl,
    title: config.title,
    message: config.message,
    updatedAt: config.updatedAt.toISOString(),
  };
}

export async function ensureMobileAppConfig(
  database: PrismaClient | Prisma.TransactionClient,
): Promise<MobileAppConfig> {
  return database.mobileAppConfig.upsert({
    where: { id: MOBILE_APP_CONFIG_ID },
    create: { id: MOBILE_APP_CONFIG_ID },
    update: {},
  });
}