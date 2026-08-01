import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import type { AuthRepository } from "../src/modules/auth/application/ports/auth-repository.js";
import {
  AuthService,
  normalizeEmail,
  normalizeUsername,
} from "../src/modules/auth/application/services/auth-service.js";
import { CryptoService } from "../src/modules/auth/application/services/crypto-service.js";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 3001,
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  WEB_ORIGIN: "http://localhost:3000",
  ADMIN_ORIGIN: "http://localhost:3002",
  CORS_ORIGINS: [],
  API_PUBLIC_URL: "http://localhost:3001",
  UPLOAD_ROOT: "../../uploads-test",
  JWT_ACCESS_SECRET: "test-secret-that-is-at-least-32-bytes-long",
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_ISSUER: "milox-api",
  JWT_AUDIENCE: "milox-clients",
  REFRESH_TOKEN_TTL_DAYS: 30,
  EMAIL_VERIFICATION_TTL_HOURS: 24,
  AUTO_VERIFY_EMAIL: false,
  PASSWORD_RESET_TTL_MINUTES: 30,
  SMTP_HOST: "",
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  EMAIL_FROM: "no-reply@example.com",
  EMAIL_WORKER_POLL_MS: 5_000,
  FEED_SCORE_POLL_MS: 300_000,
  INTEREST_DAILY_LIMIT: 20,
  CHAT_OUTBOX_POLL_MS: 500,
  NOTIFICATION_OUTBOX_POLL_MS: 500,
};

describe("auth utilities", () => {
  it("normalizes identity fields consistently", () => {
    expect(normalizeEmail("  Alex@Example.COM ")).toBe("alex@example.com");
    expect(normalizeUsername(" NightBoy ")).toBe("nightboy");
  });
});

describe("AuthService", () => {
  it("blocks staff login on consumer clients", async () => {
    const repository = createRepository();
    vi.mocked(repository.findUserByEmail).mockResolvedValue({
      id: "fca0622f-cba7-4398-bfe7-11842c026990",
      username: "miloxadmin",
      displayName: "Admin",
      email: "admin@milox.in",
      passwordHash: "hash",
      ageRange: "AGE_25_28",
      country: "India",
      gender: "PREFER_NOT_TO_SAY",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      isVerifiedBadge: false,
      isSystemAccount: false,
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    });
    const crypto = new CryptoService(config);
    vi.spyOn(crypto, "verifyLoginPassword").mockResolvedValue(true);
    const service = new AuthService(repository, crypto, config);

    await expect(
      service.login("admin@milox.in", "password", { clientKind: "consumer" }),
    ).rejects.toMatchObject({
      code: "STAFF_LOGIN_FORBIDDEN",
      statusCode: 403,
    });
  });

  it("allows staff login on admin clients", async () => {
    const repository = createRepository();
    const staffUser = {
      id: "fca0622f-cba7-4398-bfe7-11842c026990",
      username: "miloxadmin",
      displayName: "Admin",
      email: "admin@milox.in",
      passwordHash: "hash",
      ageRange: "AGE_25_28" as const,
      country: "India",
      gender: "PREFER_NOT_TO_SAY" as const,
      role: "SUPER_ADMIN" as const,
      status: "ACTIVE" as const,
      isVerifiedBadge: false,
      isSystemAccount: false,
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    };
    vi.mocked(repository.findUserByEmail).mockResolvedValue(staffUser);
    vi.mocked(repository.createRefreshSession).mockResolvedValue(undefined);
    const crypto = new CryptoService(config);
    vi.spyOn(crypto, "verifyLoginPassword").mockResolvedValue(true);
    vi.spyOn(crypto, "createAccessToken").mockResolvedValue("access-token");
    vi.spyOn(crypto, "createOpaqueToken").mockReturnValue({
      raw: "refresh-token",
      hash: "refresh-hash",
    });
    vi.spyOn(crypto, "createId").mockReturnValue("session-id");
    const service = new AuthService(repository, crypto, config);

    await expect(
      service.login("admin@milox.in", "password", { clientKind: "admin" }),
    ).resolves.toMatchObject({
      accessToken: "access-token",
      user: { role: "SUPER_ADMIN" },
    });
  });

  it("blocks regular users from admin client login", async () => {
    const repository = createRepository();
    vi.mocked(repository.findUserByEmail).mockResolvedValue({
      id: "fca0622f-cba7-4398-bfe7-11842c026990",
      username: "night_user",
      displayName: "Night",
      email: "night@example.com",
      passwordHash: "hash",
      ageRange: "AGE_25_28",
      country: "India",
      gender: "PREFER_NOT_TO_SAY",
      role: "USER",
      status: "ACTIVE",
      isVerifiedBadge: false,
      isSystemAccount: false,
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    });
    const crypto = new CryptoService(config);
    vi.spyOn(crypto, "verifyLoginPassword").mockResolvedValue(true);
    const service = new AuthService(repository, crypto, config);

    await expect(
      service.login("night@example.com", "password", { clientKind: "admin" }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      statusCode: 401,
    });
  });

  it("does not reveal whether a forgot-password email exists", async () => {
    const repository = createRepository();
    vi.mocked(repository.findUserByEmail).mockResolvedValue(null);
    const service = new AuthService(
      repository,
      new CryptoService(config),
      config,
    );

    await expect(service.forgotPassword("missing@example.com")).resolves.toBe(
      undefined,
    );
    expect(repository.createPasswordReset).not.toHaveBeenCalled();
  });

  it("revokes the flow when refresh-token reuse is detected", async () => {
    const repository = createRepository();
    vi.mocked(repository.rotateRefreshSession).mockResolvedValue({
      status: "reused",
    });
    const service = new AuthService(
      repository,
      new CryptoService(config),
      config,
    );

    await expect(service.refresh("stolen-refresh-token", {})).rejects.toMatchObject({
      code: "REFRESH_REUSE_DETECTED",
      statusCode: 401,
    });
  });

  it("creates and verifies signed access tokens", async () => {
    const crypto = new CryptoService(config);
    const token = await crypto.createAccessToken({
      userId: "4a727dd8-a77d-4a51-8841-3e94a4b68650",
      role: "USER",
      emailVerified: true,
    });

    await expect(crypto.verifyAccessToken(token)).resolves.toEqual({
      userId: "4a727dd8-a77d-4a51-8841-3e94a4b68650",
      role: "USER",
      emailVerified: true,
    });
  });
});

function createRepository(): AuthRepository {
  return {
    findUserByEmail: vi.fn(),
    findUserById: vi.fn(),
    createAccount: vi.fn(),
    createRefreshSession: vi.fn(),
    rotateRefreshSession: vi.fn(),
    revokeRefreshSession: vi.fn(),
    revokeAllUserSessions: vi.fn(),
    verifyEmail: vi.fn(),
    createEmailVerification: vi.fn(),
    createPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
  };
}
