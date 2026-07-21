import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { InterestDailyLimitError } from "../src/modules/interests/application/ports/interest-repository.js";
import type { InterestViewRecord } from "../src/modules/interests/application/interest-view.js";
import { PrismaInterestRepository } from "../src/modules/interests/infrastructure/prisma-interest-repository.js";

const senderId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const recipientId = "fca0622f-cba7-4398-bfe7-11842c026990";
const interestId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";
const key = "4c960e9a-592a-41e0-9942-2589f5dd0894";

describe("PrismaInterestRepository", () => {
  it("replays an idempotent send without opening another transaction", async () => {
    const interest = interestFixture();
    const database = {
      idempotencyRecord: {
        findUnique: vi.fn().mockResolvedValue({
          requestHash: "a".repeat(64),
          resourceId: interestId,
        }),
      },
      interest: { findUnique: vi.fn().mockResolvedValue(interest) },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const result = await new PrismaInterestRepository(database).create({
      senderId,
      recipientId,
      message: null,
      idempotencyKey: key,
      requestHash: "a".repeat(64),
      dailyLimit: 20,
      interestSendCost: 0,
    });

    expect(result).toEqual({ interest, replayed: true });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("enforces the daily limit inside a serializable transaction", async () => {
    const transaction = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: recipientId }) },
      match: { findUnique: vi.fn().mockResolvedValue(null) },
      interest: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(20),
        create: vi.fn(),
      },
      wallet: { findUnique: vi.fn() },
    };
    const database = {
      idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null) },
      interest: { findFirst: vi.fn() },
      $transaction: vi.fn(
        (
          callback: (client: typeof transaction) => unknown,
          _options: unknown,
        ) => callback(transaction),
      ),
    } as unknown as PrismaClient;

    await expect(
      new PrismaInterestRepository(database).create({
        senderId,
        recipientId,
        message: null,
        idempotencyKey: key,
        requestHash: "a".repeat(64),
        dailyLimit: 20,
        interestSendCost: 0,
      }),
    ).rejects.toBeInstanceOf(InterestDailyLimitError);
    expect(transaction.interest.create).not.toHaveBeenCalled();
    expect(database.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });
});

function interestFixture(): InterestViewRecord {
  return {
    id: interestId,
    status: "PENDING",
    message: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    respondedAt: null,
    sender: userFixture(senderId, "sender"),
    recipient: userFixture(recipientId, "recipient"),
  };
}

function userFixture(id: string, username: string) {
  return {
    id,
    username,
    displayName: null,
    bio: null,
    ageRange: "AGE_25_28",
    gender: "OTHER" as const,
    country: "India",
    relationshipGoal: null,
    websiteUrl: null,
    instagramHandle: null,
    isVerifiedBadge: false,
    isPrivateAccount: false,
    hideAge: true,
    hideCountry: true,
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    profilePhoto: null,
    coverPhoto: null,
    interests: [],
  };
}
