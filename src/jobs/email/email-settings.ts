import type { EmailSettings, Prisma, PrismaClient } from "@prisma/client";

import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "../../modules/payments/infrastructure/secret-box.js";

export const EMAIL_SETTINGS_ID = "default";

export const DEFAULT_ZEPTOMAIL_URL = "https://api.zeptomail.in/v1.1/email";

export type EmailRuntimeConfig = {
  apiUrl: string;
  apiToken: string;
  fromAddress: string;
  fromName: string;
  bounceAddress: string;
  agentAlias: string;
  configured: boolean;
};

export async function ensureEmailSettings(
  database: PrismaClient | Prisma.TransactionClient,
): Promise<EmailSettings> {
  return database.emailSettings.upsert({
    where: { id: EMAIL_SETTINGS_ID },
    create: { id: EMAIL_SETTINGS_ID },
    update: {},
  });
}

export async function resolveEmailRuntime(
  database: PrismaClient,
  encryptionSecret: string,
): Promise<EmailRuntimeConfig> {
  const row = await ensureEmailSettings(database);
  const apiToken = decryptSecret(row.apiToken, encryptionSecret).trim();
  const apiUrl = row.apiUrl.trim() || DEFAULT_ZEPTOMAIL_URL;
  const fromAddress = row.fromAddress.trim() || "noreply@milox.in";
  const fromName = row.fromName.trim() || "Milox";
  return {
    apiUrl,
    apiToken,
    fromAddress,
    fromName,
    bounceAddress: row.bounceAddress.trim(),
    agentAlias: row.agentAlias.trim(),
    configured: Boolean(apiToken && fromAddress),
  };
}

export function presentEmailSettings(
  row: EmailSettings,
  encryptionSecret: string,
): object {
  const token = decryptSecret(row.apiToken, encryptionSecret);
  return {
    configured: Boolean(token.trim() && row.fromAddress.trim()),
    source: token.trim() ? "admin" : "none",
    apiUrl: row.apiUrl || DEFAULT_ZEPTOMAIL_URL,
    hasToken: Boolean(token.trim()),
    tokenMasked: maskSecret(token),
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    bounceAddress: row.bounceAddress,
    agentAlias: row.agentAlias,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveEmailSettings(
  database: PrismaClient | Prisma.TransactionClient,
  encryptionSecret: string,
  input: {
    apiUrl?: string | undefined;
    apiToken?: string | undefined;
    fromAddress?: string | undefined;
    fromName?: string | undefined;
    bounceAddress?: string | undefined;
    agentAlias?: string | undefined;
    clearToken?: boolean | undefined;
  },
): Promise<EmailSettings> {
  await ensureEmailSettings(database);
  const tokenUpdate =
    input.clearToken === true
      ? { apiToken: "" }
      : input.apiToken !== undefined && input.apiToken.trim()
        ? { apiToken: encryptSecret(input.apiToken, encryptionSecret) }
        : {};

  return database.emailSettings.update({
    where: { id: EMAIL_SETTINGS_ID },
    data: {
      ...(input.apiUrl !== undefined
        ? { apiUrl: input.apiUrl.trim() || DEFAULT_ZEPTOMAIL_URL }
        : {}),
      ...tokenUpdate,
      ...(input.fromAddress !== undefined
        ? { fromAddress: input.fromAddress.trim() }
        : {}),
      ...(input.fromName !== undefined
        ? { fromName: input.fromName.trim() || "Milox" }
        : {}),
      ...(input.bounceAddress !== undefined
        ? { bounceAddress: input.bounceAddress.trim() }
        : {}),
      ...(input.agentAlias !== undefined
        ? { agentAlias: input.agentAlias.trim() }
        : {}),
    },
  });
}
