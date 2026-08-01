import { EmailJobType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAuthRepository } from "../src/modules/auth/infrastructure/prisma-auth-repository.js";

describe("PrismaAuthRepository.createAccount", () => {
  it("creates the user when official chat bootstrap fails", async () => {
    const createdUser = {
      id: "user-1",
      username: "night_user",
      displayName: "night_user",
      email: "night@example.com",
      passwordHash: "hash",
      ageRange: "AGE_25_28",
      country: "India",
      gender: "PREFER_NOT_TO_SAY",
      role: "USER",
      status: "ACTIVE",
      isVerifiedBadge: false,
      isSystemAccount: false,
      emailVerifiedAt: null,
      createdAt: new Date("2026-07-17T00:00:00.000Z"),
    };

    const transaction = {
      user: {
        create: vi.fn().mockResolvedValue(createdUser),
      },
      emailVerificationToken: { create: vi.fn().mockResolvedValue({}) },
      emailJob: { create: vi.fn().mockResolvedValue({}) },
    };

    const database = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };

    const signupOfficialChat = {
      bootstrapWelcomeInTransaction: vi
        .fn()
        .mockRejectedValue(new Error("official chat schema missing")),
    };

    const repository = new PrismaAuthRepository(
      database as never,
      undefined,
      signupOfficialChat,
    );

    const user = await repository.createAccount({
      username: "night_user",
      usernameNormalized: "night_user",
      email: "night@example.com",
      passwordHash: "hash",
      displayName: "night_user",
      ageRange: "AGE_25_28",
      country: "India",
      gender: "PREFER_NOT_TO_SAY",
      autoVerifyEmail: false,
      verificationTokenHash: "hash-token",
      verificationToken: "raw-token",
      verificationExpiresAt: new Date("2026-07-18T00:00:00.000Z"),
    });

    expect(user).toEqual(createdUser);
    expect(transaction.user.create).toHaveBeenCalledOnce();
    expect(transaction.emailVerificationToken.create).toHaveBeenCalledOnce();
    expect(transaction.emailJob.create).toHaveBeenCalledWith({
      data: {
        type: EmailJobType.EMAIL_VERIFICATION,
        toEmail: "night@example.com",
        payload: {
          userId: "user-1",
          token: "raw-token",
        },
      },
    });
    expect(signupOfficialChat.bootstrapWelcomeInTransaction).toHaveBeenCalledOnce();
  });
});
