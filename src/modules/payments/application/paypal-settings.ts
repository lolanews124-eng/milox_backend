import {
  PaypalCheckoutStatus,
  type PaypalCheckoutKind,
  type PaypalSettings,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "../infrastructure/secret-box.js";

export const PAYPAL_SETTINGS_ID = "default";

export type PaypalRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  mode: "sandbox" | "live";
  webhookId: string;
  nodeEnv: AppConfig["NODE_ENV"];
};

export async function ensurePaypalSettings(
  database: PrismaClient | Prisma.TransactionClient,
): Promise<PaypalSettings> {
  return database.paypalSettings.upsert({
    where: { id: PAYPAL_SETTINGS_ID },
    create: { id: PAYPAL_SETTINGS_ID },
    update: {},
  });
}

function normalizeMode(value: string | undefined): "sandbox" | "live" {
  return value === "sandbox" ? "sandbox" : "live";
}

export async function resolvePaypalCredentials(
  database: PrismaClient,
  config: AppConfig,
): Promise<PaypalRuntimeConfig> {
  const row = await ensurePaypalSettings(database);
  const adminSecret = decryptSecret(row.clientSecret, config.JWT_ACCESS_SECRET);
  const useAdmin = Boolean(row.clientId.trim() && adminSecret);
  return {
    clientId: useAdmin ? row.clientId.trim() : config.PAYPAL_CLIENT_ID,
    clientSecret: useAdmin ? adminSecret : config.PAYPAL_CLIENT_SECRET,
    mode: useAdmin ? normalizeMode(row.mode) : config.PAYPAL_MODE,
    webhookId: useAdmin
      ? row.webhookId.trim()
      : config.PAYPAL_WEBHOOK_ID,
    nodeEnv: config.NODE_ENV,
  };
}

export function paypalWebhookUrl(config: AppConfig): string {
  return `${config.API_PUBLIC_URL.replace(/\/+$/, "")}/api/v1/payments/paypal/webhook`;
}

export function presentPaypalSettings(
  row: PaypalSettings,
  config: AppConfig,
  runtime: PaypalRuntimeConfig,
): object {
  const adminSecret = decryptSecret(row.clientSecret, config.JWT_ACCESS_SECRET);
  const adminReady = Boolean(row.clientId.trim() && adminSecret);
  const envReady = Boolean(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET);
  const source = adminReady ? "admin" : envReady ? "env" : "none";
  return {
    configured: Boolean(runtime.clientId && runtime.clientSecret),
    source,
    mode: runtime.mode,
    clientId: row.clientId,
    hasSecret: Boolean(adminSecret),
    secretMasked: maskSecret(adminSecret),
    webhookId: row.webhookId,
    webhookUrl: paypalWebhookUrl(config),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function savePaypalSettings(
  database: PrismaClient | Prisma.TransactionClient,
  encryptionSecret: string,
  input: {
    clientId?: string | undefined;
    clientSecret?: string | undefined;
    mode?: "sandbox" | "live" | undefined;
    webhookId?: string | undefined;
    clearSecret?: boolean | undefined;
  },
): Promise<PaypalSettings> {
  await ensurePaypalSettings(database);
  const secretUpdate =
    input.clearSecret === true
      ? { clientSecret: "" }
      : input.clientSecret !== undefined && input.clientSecret.trim()
        ? { clientSecret: encryptSecret(input.clientSecret, encryptionSecret) }
        : {};
  return database.paypalSettings.update({
    where: { id: PAYPAL_SETTINGS_ID },
    data: {
      ...(input.clientId !== undefined ? { clientId: input.clientId.trim() } : {}),
      ...secretUpdate,
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.webhookId !== undefined
        ? {
            webhookId: input.webhookId.trim().startsWith("http")
              ? ""
              : input.webhookId.trim(),
          }
        : {}),
    },
  });
}

function dayStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function paidAt(row: { fulfilledAt: Date | null; createdAt: Date }): Date {
  return row.fulfilledAt ?? row.createdAt;
}

function emptyMoney() {
  return { amountMinor: 0, count: 0 };
}

function addMoney(
  bucket: Record<string, { amountMinor: number; count: number }>,
  currency: string,
  amountMinor: number,
) {
  const current = bucket[currency] ?? emptyMoney();
  bucket[currency] = {
    amountMinor: current.amountMinor + amountMinor,
    count: current.count + 1,
  };
}

function moneyList(bucket: Record<string, { amountMinor: number; count: number }>) {
  return Object.entries(bucket)
    .map(([currency, value]) => ({ currency, ...value }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export async function paypalIncomeReport(database: PrismaClient, now = new Date()) {
  const completed = { status: PaypalCheckoutStatus.COMPLETED } as const;
  const today = dayStartUtc(now);
  const week = addDays(today, -6);
  const month = addDays(today, -29);

  const [grouped, recent, windowRows] = await Promise.all([
    database.paypalCheckout.groupBy({
      by: ["kind", "currency"],
      where: completed,
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    database.paypalCheckout.findMany({
      where: completed,
      orderBy: [{ fulfilledAt: "desc" }, { createdAt: "desc" }],
      take: 30,
      select: {
        id: true,
        kind: true,
        amountMinor: true,
        currency: true,
        description: true,
        status: true,
        fulfilledAt: true,
        createdAt: true,
        user: { select: { username: true } },
      },
    }),
    database.paypalCheckout.findMany({
      where: {
        ...completed,
        OR: [{ fulfilledAt: { gte: month } }, { fulfilledAt: null, createdAt: { gte: month } }],
      },
      select: {
        kind: true,
        amountMinor: true,
        currency: true,
        fulfilledAt: true,
        createdAt: true,
      },
    }),
  ]);

  const allTime: Record<string, { amountMinor: number; count: number }> = {};
  const byKind: Array<{
    kind: PaypalCheckoutKind;
    currency: string;
    amountMinor: number;
    count: number;
  }> = grouped.map((row) => {
    addMoney(allTime, row.currency, row._sum.amountMinor ?? 0);
    return {
      kind: row.kind,
      currency: row.currency,
      amountMinor: row._sum.amountMinor ?? 0,
      count: row._count._all,
    };
  });

  const todayBucket: Record<string, { amountMinor: number; count: number }> = {};
  const weekBucket: Record<string, { amountMinor: number; count: number }> = {};
  const monthBucket: Record<string, { amountMinor: number; count: number }> = {};
  const daily = new Map<string, Record<string, { amountMinor: number; count: number }>>();

  for (const row of windowRows) {
    const at = paidAt(row);
    if (at >= today) addMoney(todayBucket, row.currency, row.amountMinor);
    if (at >= week) addMoney(weekBucket, row.currency, row.amountMinor);
    addMoney(monthBucket, row.currency, row.amountMinor);
    const key = at.toISOString().slice(0, 10);
    const day = daily.get(key) ?? {};
    addMoney(day, row.currency, row.amountMinor);
    daily.set(key, day);
  }

  const series: Array<{
    date: string;
    totals: Array<{ currency: string; amountMinor: number; count: number }>;
  }> = [];
  for (let i = 0; i < 30; i += 1) {
    const date = addDays(month, i).toISOString().slice(0, 10);
    series.push({
      date,
      totals: moneyList(daily.get(date) ?? {}),
    });
  }

  return {
    allTime: moneyList(allTime),
    today: moneyList(todayBucket),
    last7Days: moneyList(weekBucket),
    last30Days: moneyList(monthBucket),
    byKind: byKind.sort((a, b) => b.amountMinor - a.amountMinor),
    series,
    recent: recent.map((row) => ({
      id: row.id,
      kind: row.kind,
      username: row.user.username,
      amountMinor: row.amountMinor,
      currency: row.currency,
      description: row.description,
      paidAt: paidAt(row).toISOString(),
    })),
  };
}
