import type { Gender, UserRole, UserStatus } from "@prisma/client";

import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import { DuplicateAccountError } from "../ports/auth-repository.js";
import type {
  AuthRepository,
  AuthUser,
} from "../ports/auth-repository.js";
import type { CryptoService } from "./crypto-service.js";

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

export interface SignupInput {
  username: string;
  email: string;
  password: string;
  dateOfBirth: string;
  gender: Gender;
  referralCode?: string | undefined;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PrivateAuthUser;
}

export interface PrivateAuthUser {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  dateOfBirth: string;
  gender: Gender;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly crypto: CryptoService,
    private readonly config: AppConfig,
  ) {}

  async signup(
    input: SignupInput,
    context: RequestContext,
  ): Promise<AuthSession> {
    const dateOfBirth = new Date(`${input.dateOfBirth}T00:00:00.000Z`);
    if (!isAdult(dateOfBirth, new Date())) {
      throw new AppError("UNDERAGE", "You must be at least 18 years old", 422);
    }

    const verification = this.crypto.createOpaqueToken();
    const passwordHash = await this.crypto.hashPassword(input.password);

    let user: AuthUser;
    try {
      user = await this.repository.createAccount({
        username: input.username,
        usernameNormalized: normalizeUsername(input.username),
        email: normalizeEmail(input.email),
        passwordHash,
        dateOfBirth,
        gender: input.gender,
        autoVerifyEmail: this.config.AUTO_VERIFY_EMAIL,
        verificationTokenHash: verification.hash,
        verificationToken: verification.raw,
        verificationExpiresAt: addHours(
          new Date(),
          this.config.EMAIL_VERIFICATION_TTL_HOURS,
        ),
        ...(input.referralCode
          ? { referralCode: input.referralCode.trim().toUpperCase() }
          : {}),
      });
    } catch (error: unknown) {
      if (error instanceof DuplicateAccountError) {
        const code =
          error.field === "email" ? "EMAIL_ALREADY_REGISTERED" : "USERNAME_TAKEN";
        throw new AppError(code, `${capitalize(error.field)} is already in use`, 409);
      }
      throw error;
    }

    return this.createSession(user, context);
  }

  async login(
    email: string,
    password: string,
    context: RequestContext,
  ): Promise<AuthSession> {
    const user = await this.repository.findUserByEmail(normalizeEmail(email));
    const validPassword = await this.crypto.verifyLoginPassword(
      user?.passwordHash,
      password,
    );
    if (!user || !validPassword) {
      throw new AppError(
        "INVALID_CREDENTIALS",
        "Invalid email or password",
        401,
      );
    }

    if (user.status !== "ACTIVE") {
      throw new AppError(
        "ACCOUNT_SUSPENDED",
        "This account is not currently active",
        403,
      );
    }

    return this.createSession(user, context);
  }

  async refresh(
    refreshToken: string,
    context: RequestContext,
  ): Promise<AuthSession> {
    const replacement = this.crypto.createOpaqueToken();
    const result = await this.repository.rotateRefreshSession({
      currentTokenHash: this.crypto.hashOpaqueToken(refreshToken),
      newSessionId: this.crypto.createId(),
      newTokenHash: replacement.hash,
      newExpiresAt: addDays(
        new Date(),
        this.config.REFRESH_TOKEN_TTL_DAYS,
      ),
      ...optionalContext(context, this.crypto),
    });

    if (result.status === "reused") {
      throw new AppError(
        "REFRESH_REUSE_DETECTED",
        "Session reuse detected; please log in again",
        401,
      );
    }
    if (result.status === "invalid") {
      throw new AppError("INVALID_TOKEN", "Invalid refresh token", 401);
    }
    if (result.user.status !== "ACTIVE") {
      await this.repository.revokeAllUserSessions(result.user.id);
      throw new AppError(
        "ACCOUNT_SUSPENDED",
        "This account is not currently active",
        403,
      );
    }

    return {
      accessToken: await this.createAccessToken(result.user),
      refreshToken: replacement.raw,
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
      user: mapPrivateUser(result.user),
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.repository.revokeRefreshSession(
      this.crypto.hashOpaqueToken(refreshToken),
    );
  }

  async verifyEmail(token: string): Promise<void> {
    const user = await this.repository.verifyEmail(
      this.crypto.hashOpaqueToken(token),
      new Date(),
    );
    if (!user) {
      throw new AppError(
        "INVALID_TOKEN",
        "Verification token is invalid or expired",
        400,
      );
    }
    await this.repository.revokeAllUserSessions(user.id);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.status !== "ACTIVE" || user.emailVerifiedAt) return;

    const token = this.crypto.createOpaqueToken();
    await this.repository.createEmailVerification(
      user.id,
      user.email,
      token.hash,
      token.raw,
      addHours(new Date(), this.config.EMAIL_VERIFICATION_TTL_HOURS),
    );
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.repository.findUserByEmail(normalizeEmail(email));
    if (!user || user.status !== "ACTIVE") return;

    const token = this.crypto.createOpaqueToken();
    await this.repository.createPasswordReset(
      user.id,
      user.email,
      token.hash,
      token.raw,
      addMinutes(new Date(), this.config.PASSWORD_RESET_TTL_MINUTES),
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const passwordHash = await this.crypto.hashPassword(newPassword);
    const reset = await this.repository.resetPassword(
      this.crypto.hashOpaqueToken(token),
      passwordHash,
      new Date(),
    );
    if (!reset) {
      throw new AppError(
        "INVALID_TOKEN",
        "Reset token is invalid or expired",
        400,
      );
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.repository.findUserById(userId);
    if (
      !user ||
      !(await this.crypto.verifyPassword(user.passwordHash, currentPassword))
    ) {
      throw new AppError(
        "INVALID_CREDENTIALS",
        "Current password is incorrect",
        401,
      );
    }
    const passwordHash = await this.crypto.hashPassword(newPassword);
    await this.repository.updatePassword(userId, passwordHash);
    await this.repository.revokeAllUserSessions(userId);
  }

  private async createSession(
    user: AuthUser,
    context: RequestContext,
  ): Promise<AuthSession> {
    const refresh = this.crypto.createOpaqueToken();
    await this.repository.createRefreshSession({
      id: this.crypto.createId(),
      userId: user.id,
      tokenHash: refresh.hash,
      familyId: this.crypto.createId(),
      expiresAt: addDays(new Date(), this.config.REFRESH_TOKEN_TTL_DAYS),
      ...optionalContext(context, this.crypto),
    });

    return {
      accessToken: await this.createAccessToken(user),
      refreshToken: refresh.raw,
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
      user: mapPrivateUser(user),
    };
  }

  private createAccessToken(user: AuthUser): Promise<string> {
    return this.crypto.createAccessToken({
      userId: user.id,
      role: user.role,
      emailVerified: Boolean(user.emailVerifiedAt),
    });
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isAdult(dateOfBirth: Date, now: Date): boolean {
  if (Number.isNaN(dateOfBirth.getTime())) return false;
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()),
  );
  return dateOfBirth <= cutoff;
}

function mapPrivateUser(user: AuthUser): PrivateAuthUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    dateOfBirth: user.dateOfBirth.toISOString().slice(0, 10),
    gender: user.gender,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

function optionalContext(
  context: RequestContext,
  crypto: CryptoService,
): { userAgent?: string; ipHash?: string } {
  const userAgent = context.userAgent?.slice(0, 512);
  const ipHash = crypto.hashIp(context.ip);
  return {
    ...(userAgent ? { userAgent } : {}),
    ...(ipHash ? { ipHash } : {}),
  };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addHours(date: Date, hours: number): Date {
  return addMinutes(date, hours * 60);
}

function addDays(date: Date, days: number): Date {
  return addHours(date, days * 24);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
