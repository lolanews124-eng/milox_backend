import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { BlockConflictError } from "../src/modules/moderation/application/ports/moderation-repository.js";
import { PrismaModerationRepository } from "../src/modules/moderation/infrastructure/prisma-moderation-repository.js";

const blockerId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const blockedId = "fca0622f-cba7-4398-bfe7-11842c026990";

describe("PrismaModerationRepository", () => {
  it("creates a block and severs pending social links", async () => {
    const transaction = {
      block: { create: vi.fn().mockResolvedValue({ id: "block-id" }) },
      follow: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "follow-id",
            followerId: blockerId,
            followeeId: blockedId,
            status: "ACTIVE",
          },
        ]),
        delete: vi.fn().mockResolvedValue({}),
      },
      user: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      interest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const database = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: blockedId }),
      },
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    } as unknown as PrismaClient;

    await new PrismaModerationRepository(database).block("nightboy", blockerId);

    expect(transaction.block.create).toHaveBeenCalledWith({
      data: { blockerId, blockedId },
    });
    expect(transaction.follow.delete).toHaveBeenCalled();
    expect(transaction.interest.updateMany).toHaveBeenCalled();
  });

  it("maps duplicate blocks to a conflict", async () => {
    const database = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: blockedId }),
      },
      $transaction: vi.fn(async () => {
        const error = Object.assign(new Error("unique"), {
          code: "P2002",
          name: "PrismaClientKnownRequestError",
        });
        Object.setPrototypeOf(
          error,
          (
            await import("@prisma/client")
          ).Prisma.PrismaClientKnownRequestError.prototype,
        );
        throw error;
      }),
    } as unknown as PrismaClient;

    // Simpler path: throw a real Prisma known request error shape
    const { Prisma } = await import("@prisma/client");
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint",
      { code: "P2002", clientVersion: "test" },
    );
    const failingDatabase = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: blockedId }),
      },
      $transaction: vi.fn().mockRejectedValue(prismaError),
    } as unknown as PrismaClient;

    await expect(
      new PrismaModerationRepository(failingDatabase).block(
        "nightboy",
        blockerId,
      ),
    ).rejects.toBeInstanceOf(BlockConflictError);
    void database;
  });
});
