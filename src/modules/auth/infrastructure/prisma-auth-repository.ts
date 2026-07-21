import {
  EmailJobType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import type {
  AuthRepository,
  AuthUser,
  CreateAccountData,
  CreateRefreshSessionData,
  RotateRefreshSessionData,
  RotateRefreshSessionResult,
} from "../application/ports/auth-repository.js";
import { DuplicateAccountError } from "../application/ports/auth-repository.js";
import type { SignupRewardsWriter } from "../../rewards/application/ports/rewards-repository.js";

const authUserSelect = {
  id: true,
  username: true,
  email: true,
  passwordHash: true,
  ageRange: true,
  country: true,
  gender: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export class PrismaAuthRepository implements AuthRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly signupRewards?: SignupRewardsWriter,
  ) {}

  findUserByEmail(email: string): Promise<AuthUser | null> {
    return this.database.user.findUnique({
      where: { email },
      select: authUserSelect,
    });
  }

  findUserById(userId: string): Promise<AuthUser | null> {
    return this.database.user.findUnique({
      where: { id: userId },
      select: authUserSelect,
    });
  }

  async createAccount(data: CreateAccountData): Promise<AuthUser> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            username: data.username,
            usernameNormalized: data.usernameNormalized,
            email: data.email,
            passwordHash: data.passwordHash,
            ageRange: data.ageRange,
            country: data.country,
            gender: data.gender,
            ...(data.autoVerifyEmail
              ? { emailVerifiedAt: new Date() }
              : {}),
          },
          select: authUserSelect,
        });

        if (!data.autoVerifyEmail) {
          await transaction.emailVerificationToken.create({
            data: {
              userId: user.id,
              tokenHash: data.verificationTokenHash,
              expiresAt: data.verificationExpiresAt,
            },
          });
          await transaction.emailJob.create({
            data: {
              type: EmailJobType.EMAIL_VERIFICATION,
              toEmail: user.email,
              payload: {
                userId: user.id,
                token: data.verificationToken,
              },
            },
          });
        }

        if (this.signupRewards) {
          await this.signupRewards.bootstrapInTransaction(transaction, {
            userId: user.id,
            username: user.username,
            ...(data.referralCode ? { referralCode: data.referralCode } : {}),
          });
        }

        return user;
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.map(String)
          : [];
        throw new DuplicateAccountError(
          target.includes("email") ? "email" : "username",
        );
      }
      throw error;
    }
  }

  async createRefreshSession(data: CreateRefreshSessionData): Promise<void> {
    await this.database.refreshSession.create({ data });
  }

  rotateRefreshSession(
    data: RotateRefreshSessionData,
  ): Promise<RotateRefreshSessionResult> {
    return this.database.$transaction(
      async (transaction): Promise<RotateRefreshSessionResult> => {
        const current = await transaction.refreshSession.findUnique({
          where: { tokenHash: data.currentTokenHash },
          include: { user: { select: authUserSelect } },
        });

        if (!current || current.expiresAt <= new Date()) {
          return { status: "invalid" };
        }

        if (current.revokedAt) {
          await transaction.refreshSession.updateMany({
            where: { familyId: current.familyId, revokedAt: null },
            data: { revokedAt: new Date(), reuseDetectedAt: new Date() },
          });
          return { status: "reused" };
        }

        const now = new Date();
        const claimed = await transaction.refreshSession.updateMany({
          where: {
            id: current.id,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now },
        });

        if (claimed.count !== 1) {
          await transaction.refreshSession.updateMany({
            where: { familyId: current.familyId, revokedAt: null },
            data: { revokedAt: now, reuseDetectedAt: now },
          });
          return { status: "reused" };
        }

        await transaction.refreshSession.create({
          data: {
            id: data.newSessionId,
            userId: current.userId,
            tokenHash: data.newTokenHash,
            familyId: current.familyId,
            expiresAt: data.newExpiresAt,
            ...(data.userAgent ? { userAgent: data.userAgent } : {}),
            ...(data.ipHash ? { ipHash: data.ipHash } : {}),
          },
        });
        await transaction.refreshSession.update({
          where: { id: current.id },
          data: { replacedById: data.newSessionId },
        });

        return { status: "rotated", user: current.user };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async revokeRefreshSession(tokenHash: string): Promise<void> {
    await this.database.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.database.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  verifyEmail(tokenHash: string, now: Date): Promise<AuthUser | null> {
    return this.database.$transaction(async (transaction) => {
      const token = await transaction.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: { user: { select: authUserSelect } },
      });
      if (!token || token.usedAt || token.expiresAt <= now) return null;

      const claimed = await transaction.emailVerificationToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;

      return transaction.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: now },
        select: authUserSelect,
      });
    });
  }

  async createEmailVerification(
    userId: string,
    email: string,
    tokenHash: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.emailVerificationToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await transaction.emailVerificationToken.create({
        data: { userId, tokenHash, expiresAt },
      });
      await transaction.emailJob.create({
        data: {
          type: EmailJobType.EMAIL_VERIFICATION,
          toEmail: email,
          payload: { userId, token },
        },
      });
    });
  }

  async createPasswordReset(
    userId: string,
    email: string,
    tokenHash: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await transaction.passwordResetToken.create({
        data: { userId, tokenHash, expiresAt },
      });
      await transaction.emailJob.create({
        data: {
          type: EmailJobType.PASSWORD_RESET,
          toEmail: email,
          payload: { userId, token },
        },
      });
    });
  }

  resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const token = await transaction.passwordResetToken.findUnique({
        where: { tokenHash },
      });
      if (!token || token.usedAt || token.expiresAt <= now) return false;

      const claimed = await transaction.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return false;

      await transaction.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      });
      await transaction.refreshSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.database.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }
}
