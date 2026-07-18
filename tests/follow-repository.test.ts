import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaFollowRepository } from "../src/modules/follows/infrastructure/prisma-follow-repository.js";

const followerId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const followeeId = "fca0622f-cba7-4398-bfe7-11842c026990";
const followId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";

describe("PrismaFollowRepository", () => {
  it("atomically activates a public follow and updates both counters", async () => {
    const transaction = {
      follow: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: followId }),
      },
      user: {
        update: vi
          .fn()
          .mockResolvedValueOnce({ followerCount: 6 })
          .mockResolvedValueOnce({}),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const database = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: followeeId,
          isPrivateAccount: false,
        }),
      },
      follow: { findUnique: vi.fn() },
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    } as unknown as PrismaClient;

    const state = await new PrismaFollowRepository(database).follow(
      "public_user",
      followerId,
    );

    expect(state).toEqual({
      isFollowing: true,
      followRequested: false,
      followerCount: 6,
    });
    expect(transaction.user.update).toHaveBeenCalledTimes(2);
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "user.followed" }),
      }),
    );
  });

  it("keeps counters unchanged for a private follow request", async () => {
    const transaction = {
      follow: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: followId }),
      },
      user: {
        update: vi.fn(),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ followerCount: 5 }),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const database = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: followeeId,
          isPrivateAccount: true,
        }),
      },
      follow: { findUnique: vi.fn() },
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    } as unknown as PrismaClient;

    const state = await new PrismaFollowRepository(database).follow(
      "private_user",
      followerId,
    );

    expect(state).toEqual({
      isFollowing: false,
      followRequested: true,
      followerCount: 5,
    });
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "follow.requested" }),
      }),
    );
  });
});
