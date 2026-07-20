import type { Gender, UserRole, UserStatus } from "@prisma/client";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  dateOfBirth: Date;
  gender: Gender;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface CreateAccountData {
  username: string;
  usernameNormalized: string;
  email: string;
  passwordHash: string;
  dateOfBirth: Date;
  gender: Gender;
  autoVerifyEmail: boolean;
  verificationTokenHash: string;
  verificationToken: string;
  verificationExpiresAt: Date;
  referralCode?: string | undefined;
}

export interface CreateRefreshSessionData {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  userAgent?: string;
  ipHash?: string;
}

export interface RotateRefreshSessionData {
  currentTokenHash: string;
  newSessionId: string;
  newTokenHash: string;
  newExpiresAt: Date;
  userAgent?: string;
  ipHash?: string;
}

export type RotateRefreshSessionResult =
  | { status: "invalid" }
  | { status: "reused" }
  | { status: "rotated"; user: AuthUser };

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(userId: string): Promise<AuthUser | null>;
  createAccount(data: CreateAccountData): Promise<AuthUser>;
  createRefreshSession(data: CreateRefreshSessionData): Promise<void>;
  rotateRefreshSession(
    data: RotateRefreshSessionData,
  ): Promise<RotateRefreshSessionResult>;
  revokeRefreshSession(tokenHash: string): Promise<void>;
  revokeAllUserSessions(userId: string): Promise<void>;
  verifyEmail(tokenHash: string, now: Date): Promise<AuthUser | null>;
  createEmailVerification(
    userId: string,
    email: string,
    tokenHash: string,
    token: string,
    expiresAt: Date,
  ): Promise<void>;
  createPasswordReset(
    userId: string,
    email: string,
    tokenHash: string,
    token: string,
    expiresAt: Date,
  ): Promise<void>;
  resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<boolean>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
}

export class DuplicateAccountError extends Error {
  constructor(public readonly field: "email" | "username") {
    super(`Duplicate ${field}`);
  }
}
