import type { CashfreeSettings, Prisma, PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "../infrastructure/secret-box.js";

export const CASHFREE_SETTINGS_ID = "default";

export type CashfreeRuntimeConfig = {
  appId: string;
  secretKey: string;
  mode: "sandbox" | "production";
};

export async function ensureCashfreeSettings(
  database: PrismaClient | Prisma.TransactionClient,
): Promise<CashfreeSettings> {
  return database.cashfreeSettings.upsert({
    where: { id: CASHFREE_SETTINGS_ID },
    create: { id: CASHFREE_SETTINGS_ID },
    update: {},
  });
}

function normalizeMode(value: string | undefined): "sandbox" | "production" {
  return value === "production" || value === "live" ? "production" : "sandbox";
}

export async function resolveCashfreeCredentials(
  database: PrismaClient,
  _config: AppConfig,
): Promise<CashfreeRuntimeConfig> {
  const row = await ensureCashfreeSettings(database);
  const secret = decryptSecret(row.secretKey, _config.JWT_ACCESS_SECRET);
  return {
    appId: row.appId.trim(),
    secretKey: secret,
    mode: normalizeMode(row.mode),
  };
}

export function cashfreeWebhookUrl(config: AppConfig): string {
  return `${config.API_PUBLIC_URL.replace(/\/+$/, "")}/api/v1/payments/cashfree/webhook`;
}

export function presentCashfreeSettings(
  row: CashfreeSettings,
  config: AppConfig,
  runtime: CashfreeRuntimeConfig,
): object {
  const secret = decryptSecret(row.secretKey, config.JWT_ACCESS_SECRET);
  return {
    configured: Boolean(runtime.appId && runtime.secretKey),
    mode: runtime.mode,
    appId: row.appId,
    hasSecret: Boolean(secret),
    secretMasked: maskSecret(secret),
    webhookUrl: cashfreeWebhookUrl(config),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveCashfreeSettings(
  database: PrismaClient | Prisma.TransactionClient,
  encryptionSecret: string,
  input: {
    appId?: string | undefined;
    secretKey?: string | undefined;
    mode?: "sandbox" | "production" | undefined;
    clearSecret?: boolean | undefined;
  },
): Promise<CashfreeSettings> {
  await ensureCashfreeSettings(database);
  const secretUpdate =
    input.clearSecret === true
      ? { secretKey: "" }
      : input.secretKey !== undefined && input.secretKey.trim()
        ? { secretKey: encryptSecret(input.secretKey, encryptionSecret) }
        : {};
  return database.cashfreeSettings.update({
    where: { id: CASHFREE_SETTINGS_ID },
    data: {
      ...(input.appId !== undefined ? { appId: input.appId.trim() } : {}),
      ...secretUpdate,
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
    },
  });
}
