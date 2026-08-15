import type { Prisma, PrismaClient } from "@prisma/client";
import {
  VerifiedBadgeOrderStatus,
  VerifiedBadgePaymentMethod,
  WalletTransactionType,
} from "@prisma/client";

import { AppError } from "../../../shared/errors/app-error.js";
import { InsufficientWalletBalanceError } from "../../rewards/application/ports/rewards-repository.js";
import { debitWallet } from "../../rewards/infrastructure/prisma-rewards-repository.js";

export const VERIFIED_BADGE_PRODUCT_ID = "00000000-0000-4000-a000-0000000000b1";

export interface VerifiedBadgeProductInput {
  isActive?: boolean | undefined;
  title?: string | undefined;
  description?: string | null | undefined;
  currency?: string | undefined;
  priceCents?: number | undefined;
  pricePoints?: number | undefined;
  durationDays?: number | undefined;
  paymentInstructions?: string | null | undefined;
}

function addDays(from: Date, days: number): Date {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function presentProduct(row: {
  id: string;
  isActive: boolean;
  title: string;
  description: string | null;
  currency: string;
  priceCents: number;
  pricePoints: number;
  durationDays: number;
  paymentInstructions: string | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    isActive: row.isActive,
    title: row.title,
    description: row.description,
    currency: row.currency,
    priceCents: row.priceCents,
    pricePoints: row.pricePoints,
    durationDays: row.durationDays,
    paymentInstructions: row.paymentInstructions,
    updatedAt: row.updatedAt.toISOString(),
    cashEnabled: row.priceCents > 0,
    pointsEnabled: row.pricePoints > 0,
  };
}

function presentOrder(row: {
  id: string;
  userId: string;
  status: VerifiedBadgeOrderStatus;
  paymentMethod: VerifiedBadgePaymentMethod;
  amountCents: number;
  pointsSpent: number;
  currency: string;
  durationDays: number;
  badgeExpiresAt: Date | null;
  note: string | null;
  processedAt: Date | null;
  createdAt: Date;
  user?: { username: string; displayName: string | null } | undefined;
  processedBy?: { username: string } | null | undefined;
}) {
  return {
    id: row.id,
    userId: row.userId,
    username: row.user?.username,
    displayName: row.user?.displayName ?? null,
    status: row.status,
    paymentMethod: row.paymentMethod,
    amountCents: row.amountCents,
    pointsSpent: row.pointsSpent,
    currency: row.currency,
    durationDays: row.durationDays,
    badgeExpiresAt: row.badgeExpiresAt?.toISOString() ?? null,
    note: row.note,
    processedAt: row.processedAt?.toISOString() ?? null,
    processedByUsername: row.processedBy?.username ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class VerifiedBadgeService {
  constructor(private readonly database: PrismaClient) {}

  async getOrCreateProduct() {
    const existing = await this.database.verifiedBadgeProduct.findUnique({
      where: { id: VERIFIED_BADGE_PRODUCT_ID },
    });
    if (existing) return existing;
    return this.database.verifiedBadgeProduct.create({
      data: {
        id: VERIFIED_BADGE_PRODUCT_ID,
        isActive: false,
        title: "Verified badge",
        description:
          "Blue tick only — no Elite plan required. Price and duration are set by admins.",
        currency: "INR",
        priceCents: 19_900,
        pricePoints: 0,
        durationDays: 365,
      },
    });
  }

  async getPublicOffer(userId: string) {
    const [product, user, pending, wallet] = await Promise.all([
      this.getOrCreateProduct(),
      this.database.user.findUnique({
        where: { id: userId },
        select: {
          isVerifiedBadge: true,
          verifiedBadgeExpiresAt: true,
        },
      }),
      this.database.verifiedBadgeOrder.findFirst({
        where: { userId, status: VerifiedBadgeOrderStatus.PENDING },
        orderBy: { createdAt: "desc" },
      }),
      this.database.wallet.findUnique({
        where: { userId },
        select: { balance: true },
      }),
    ]);

    const now = new Date();
    const expiresAt = user?.verifiedBadgeExpiresAt ?? null;
    const verifiedNow = Boolean(
      user?.isVerifiedBadge && (!expiresAt || expiresAt > now),
    );

    return {
      available: product.isActive && (product.priceCents > 0 || product.pricePoints > 0),
      product: presentProduct(product),
      isVerified: verifiedNow,
      expiresAt: expiresAt?.toISOString() ?? null,
      pendingOrder: pending ? presentOrder(pending) : null,
      walletBalance: wallet?.balance ?? 0,
    };
  }

  async updateProduct(input: VerifiedBadgeProductInput) {
    const current = await this.getOrCreateProduct();
    const nextActive = input.isActive ?? current.isActive;
    const nextCents = input.priceCents ?? current.priceCents;
    const nextPoints = input.pricePoints ?? current.pricePoints;
    if (nextActive && nextCents <= 0 && nextPoints <= 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Enable a cash price or a points price before turning the offer on",
        400,
      );
    }
    const updated = await this.database.verifiedBadgeProduct.update({
      where: { id: VERIFIED_BADGE_PRODUCT_ID },
      data: {
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.currency !== undefined
          ? { currency: input.currency.toUpperCase() }
          : {}),
        ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
        ...(input.pricePoints !== undefined
          ? { pricePoints: input.pricePoints }
          : {}),
        ...(input.durationDays !== undefined
          ? { durationDays: input.durationDays }
          : {}),
        ...(input.paymentInstructions !== undefined
          ? { paymentInstructions: input.paymentInstructions }
          : {}),
      },
    });
    return presentProduct(updated);
  }

  async purchase(
    userId: string,
    method: VerifiedBadgePaymentMethod,
  ): Promise<object> {
    const product = await this.getOrCreateProduct();
    if (!product.isActive) {
      throw new AppError(
        "VERIFIED_BADGE_UNAVAILABLE",
        "Verified badge purchases are not available right now",
        409,
      );
    }

    if (method === VerifiedBadgePaymentMethod.POINTS && product.pricePoints <= 0) {
      throw new AppError(
        "VERIFIED_BADGE_UNAVAILABLE",
        "Points checkout is not enabled for the verified badge",
        409,
      );
    }
    if (method === VerifiedBadgePaymentMethod.MANUAL && product.priceCents <= 0) {
      throw new AppError(
        "VERIFIED_BADGE_UNAVAILABLE",
        "Cash checkout is not enabled for the verified badge",
        409,
      );
    }

    const pending = await this.database.verifiedBadgeOrder.findFirst({
      where: { userId, status: VerifiedBadgeOrderStatus.PENDING },
      select: { id: true },
    });
    if (pending) {
      throw new AppError(
        "VERIFIED_BADGE_PENDING",
        "You already have a pending verified badge request",
        409,
      );
    }

    if (method === VerifiedBadgePaymentMethod.POINTS) {
      try {
        const order = await this.completePointsPurchase(userId, product);
        return { order: presentOrder(order), granted: true };
      } catch (error) {
        if (error instanceof InsufficientWalletBalanceError) {
          throw new AppError(
            "INSUFFICIENT_POINTS",
            "Not enough Milox Points for the verified badge",
            402,
          );
        }
        throw error;
      }
    }

    const order = await this.database.verifiedBadgeOrder.create({
      data: {
        userId,
        status: VerifiedBadgeOrderStatus.PENDING,
        paymentMethod: VerifiedBadgePaymentMethod.MANUAL,
        amountCents: product.priceCents,
        pointsSpent: 0,
        currency: product.currency,
        durationDays: product.durationDays,
      },
    });
    return { order: presentOrder(order), granted: false };
  }

  async listOrders(query: {
    page: number;
    pageSize: number;
    status?: VerifiedBadgeOrderStatus;
    q?: string;
  }) {
    const where: Prisma.VerifiedBadgeOrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            user: {
              OR: [
                { username: { contains: query.q, mode: "insensitive" } },
                { displayName: { contains: query.q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.verifiedBadgeOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: { select: { username: true, displayName: true } },
          processedBy: { select: { username: true } },
        },
      }),
      this.database.verifiedBadgeOrder.count({ where }),
    ]);
    return {
      items: items.map(presentOrder),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async completeOrder(
    actorId: string,
    orderId: string,
    note?: string,
  ): Promise<object> {
    const order = await this.database.verifiedBadgeOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new AppError("NOT_FOUND", "Verified badge order not found", 404);
    }
    if (order.status !== VerifiedBadgeOrderStatus.PENDING) {
      throw new AppError(
        "ADMIN_STATE_CONFLICT",
        "This order is no longer pending",
        409,
      );
    }

    const completed = await this.database.$transaction(async (tx) => {
      const expiresAt = this.computeExpiry(order.durationDays, await this.currentExpiry(tx, order.userId));
      await this.grantBadge(tx, order.userId, expiresAt);
      return tx.verifiedBadgeOrder.update({
        where: { id: order.id },
        data: {
          status: VerifiedBadgeOrderStatus.COMPLETED,
          badgeExpiresAt: expiresAt,
          processedById: actorId,
          processedAt: new Date(),
          note: note ?? order.note,
        },
        include: {
          user: { select: { username: true, displayName: true } },
          processedBy: { select: { username: true } },
        },
      });
    });
    return presentOrder(completed);
  }

  async rejectOrder(
    actorId: string,
    orderId: string,
    note?: string,
  ): Promise<object> {
    const order = await this.database.verifiedBadgeOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new AppError("NOT_FOUND", "Verified badge order not found", 404);
    }
    if (order.status !== VerifiedBadgeOrderStatus.PENDING) {
      throw new AppError(
        "ADMIN_STATE_CONFLICT",
        "This order is no longer pending",
        409,
      );
    }
    const updated = await this.database.verifiedBadgeOrder.update({
      where: { id: order.id },
      data: {
        status: VerifiedBadgeOrderStatus.REJECTED,
        processedById: actorId,
        processedAt: new Date(),
        note: note ?? null,
      },
      include: {
        user: { select: { username: true, displayName: true } },
        processedBy: { select: { username: true } },
      },
    });
    return presentOrder(updated);
  }

  private async completePointsPurchase(
    userId: string,
    product: Awaited<ReturnType<VerifiedBadgeService["getOrCreateProduct"]>>,
  ) {
    return this.database.$transaction(async (tx) => {
      const order = await tx.verifiedBadgeOrder.create({
        data: {
          userId,
          status: VerifiedBadgeOrderStatus.PENDING,
          paymentMethod: VerifiedBadgePaymentMethod.POINTS,
          amountCents: 0,
          pointsSpent: product.pricePoints,
          currency: product.currency,
          durationDays: product.durationDays,
        },
      });
      await debitWallet(tx, {
        userId,
        amount: product.pricePoints,
        type: WalletTransactionType.VERIFIED_BADGE,
        idempotencyKey: `verified-badge:${order.id}`,
        referenceType: "verified_badge",
        referenceId: order.id,
        description: "Verified badge",
      });
      const expiresAt = this.computeExpiry(
        product.durationDays,
        await this.currentExpiry(tx, userId),
      );
      await this.grantBadge(tx, userId, expiresAt);
      return tx.verifiedBadgeOrder.update({
        where: { id: order.id },
        data: {
          status: VerifiedBadgeOrderStatus.COMPLETED,
          badgeExpiresAt: expiresAt,
          processedAt: new Date(),
        },
      });
    });
  }

  private computeExpiry(durationDays: number, currentExpiry: Date | null): Date | null {
    if (durationDays <= 0) return null;
    const start =
      currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
    return addDays(start, durationDays);
  }

  private async currentExpiry(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<Date | null> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { verifiedBadgeExpiresAt: true },
    });
    return user?.verifiedBadgeExpiresAt ?? null;
  }

  private async grantBadge(
    tx: Prisma.TransactionClient,
    userId: string,
    expiresAt: Date | null,
  ): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: {
        isVerifiedBadge: true,
        verifiedBadgeExpiresAt: expiresAt,
      },
    });
  }
}
