import type { Prisma, PrismaClient, RazorpaySettings } from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "../infrastructure/secret-box.js";

export const RAZORPAY_SETTINGS_ID = "default";

export type RazorpayRuntimeConfig = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  mode: "test" | "live";
  nodeEnv: AppConfig["NODE_ENV"];
};

export async function ensureRazorpaySettings(
  database: PrismaClient | Prisma.TransactionClient,
): Promise<RazorpaySettings> {
  return database.razorpaySettings.upsert({
    where: { id: RAZORPAY_SETTINGS_ID },
    create: { id: RAZORPAY_SETTINGS_ID },
    update: {},
  });
}

function normalizeMode(value: string | undefined): "test" | "live" {
  return value === "live" ? "live" : "test";
}

export async function resolveRazorpayCredentials(
  database: PrismaClient,
  config: AppConfig,
): Promise<RazorpayRuntimeConfig> {
  const row = await ensureRazorpaySettings(database);
  const keySecret = decryptSecret(row.keySecret, config.JWT_ACCESS_SECRET);
  const webhookSecret = decryptSecret(
    row.webhookSecret,
    config.JWT_ACCESS_SECRET,
  );
  return {
    keyId: row.keyId.trim(),
    keySecret,
    webhookSecret,
    mode: normalizeMode(row.mode),
    nodeEnv: config.NODE_ENV,
  };
}

export function razorpayWebhookUrl(config: AppConfig): string {
  return `${config.API_PUBLIC_URL.replace(/\/+$/, "")}/api/v1/payments/razorpay/webhook`;
}

export function presentRazorpaySettings(
  row: RazorpaySettings,
  config: AppConfig,
  runtime: RazorpayRuntimeConfig,
): object {
  const keySecret = decryptSecret(row.keySecret, config.JWT_ACCESS_SECRET);
  const webhookSecret = decryptSecret(
    row.webhookSecret,
    config.JWT_ACCESS_SECRET,
  );
  return {
    configured: Boolean(runtime.keyId && runtime.keySecret),
    source: runtime.keyId && runtime.keySecret ? "admin" : "none",
    mode: runtime.mode,
    keyId: row.keyId,
    hasSecret: Boolean(keySecret),
    secretMasked: maskSecret(keySecret),
    hasWebhookSecret: Boolean(webhookSecret),
    webhookSecretMasked: maskSecret(webhookSecret),
    webhookUrl: razorpayWebhookUrl(config),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveRazorpaySettings(
  database: PrismaClient | Prisma.TransactionClient,
  encryptionSecret: string,
  input: {
    keyId?: string | undefined;
    keySecret?: string | undefined;
    webhookSecret?: string | undefined;
    mode?: "test" | "live" | undefined;
    clearSecret?: boolean | undefined;
    clearWebhookSecret?: boolean | undefined;
  },
): Promise<RazorpaySettings> {
  await ensureRazorpaySettings(database);
  const secretUpdate =
    input.clearSecret === true
      ? { keySecret: "" }
      : input.keySecret !== undefined && input.keySecret.trim()
        ? { keySecret: encryptSecret(input.keySecret, encryptionSecret) }
        : {};
  const webhookUpdate =
    input.clearWebhookSecret === true
      ? { webhookSecret: "" }
      : input.webhookSecret !== undefined && input.webhookSecret.trim()
        ? {
            webhookSecret: encryptSecret(input.webhookSecret, encryptionSecret),
          }
        : {};
  return database.razorpaySettings.update({
    where: { id: RAZORPAY_SETTINGS_ID },
    data: {
      ...(input.keyId !== undefined ? { keyId: input.keyId.trim() } : {}),
      ...secretUpdate,
      ...webhookUpdate,
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
    },
  });
}
