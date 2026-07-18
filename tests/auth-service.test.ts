import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import type { AuthRepository } from "../src/modules/auth/application/ports/auth-repository.js";
import {
  AuthService,
  isAdult,
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

  it("enforces the exact 18th birthday boundary", () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    expect(isAdult(new Date("2008-07-17T00:00:00.000Z"), now)).toBe(true);
    expect(isAdult(new Date("2008-07-18T00:00:00.000Z"), now)).toBe(false);
  });
});

describe("AuthService", () => {
  it("rejects underage signup before writing data", async () => {
    const repository = createRepository();
    const service = new AuthService(
      repository,
      new CryptoService(config),
      config,
    );

    await expect(
      service.signup(
        {
          username: "young_user",
          email: "young@example.com",
          password: "long-enough-password",
          dateOfBirth: "2010-01-01",
          gender: "PREFER_NOT_TO_SAY",
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "UNDERAGE", statusCode: 422 });

    expect(repository.createAccount).not.toHaveBeenCalled();
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
