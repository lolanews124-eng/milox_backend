import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import type {
  AuthRepository,
  CreateAccountData,
} from "../src/modules/auth/application/ports/auth-repository.js";
import { AuthService } from "../src/modules/auth/application/services/auth-service.js";
import { CryptoService } from "../src/modules/auth/application/services/crypto-service.js";
import { AuthController } from "../src/modules/auth/presentation/auth-controller.js";
import { createAuthRouter } from "../src/modules/auth/presentation/auth-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

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

describe("auth HTTP contract", () => {
  it("returns a web session with refresh token only in an httpOnly cookie", async () => {
    const repository = createRepository();
    vi.mocked(repository.createAccount).mockImplementation(
      (data: CreateAccountData) =>
        Promise.resolve({
          id: "fca0622f-cba7-4398-bfe7-11842c026990",
          username: data.username,
          email: data.email,
          passwordHash: data.passwordHash,
          dateOfBirth: data.dateOfBirth,
          gender: data.gender,
          role: "USER",
          status: "ACTIVE",
          emailVerifiedAt: null,
          createdAt: new Date("2026-07-17T00:00:00.000Z"),
        }),
    );
    const app = createTestApp(repository);

    const response = await request(app).post("/api/v1/auth/signup").send({
      username: "night_user",
      email: "Night@Example.com",
      password: "long-enough-password",
      dateOfBirth: "2000-01-01",
      gender: "PREFER_NOT_TO_SAY",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.user.email).toBe("night@example.com");
    expect(response.body.data).not.toHaveProperty("refreshToken");
    expect(response.body.data.user).not.toHaveProperty("passwordHash");
    expect(response.headers["set-cookie"]?.[0]).toContain("milox_rt=");
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(repository.createRefreshSession).toHaveBeenCalledOnce();
  });

  it("returns the refresh token to an explicitly identified mobile client", async () => {
    const repository = createRepository();
    vi.mocked(repository.createAccount).mockImplementation(
      (data: CreateAccountData) =>
        Promise.resolve({
          id: "fca0622f-cba7-4398-bfe7-11842c026990",
          username: data.username,
          email: data.email,
          passwordHash: data.passwordHash,
          dateOfBirth: data.dateOfBirth,
          gender: data.gender,
          role: "USER",
          status: "ACTIVE",
          emailVerifiedAt: null,
          createdAt: new Date(),
        }),
    );
    const app = createTestApp(repository);

    const response = await request(app)
      .post("/api/v1/auth/signup")
      .set("X-Client-Platform", "mobile")
      .send({
        username: "mobile_user",
        email: "mobile@example.com",
        password: "long-enough-password",
        dateOfBirth: "2000-01-01",
        gender: "OTHER",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("returns the standard validation error envelope", async () => {
    const app = createTestApp(createRepository());
    const response = await request(app).post("/api/v1/auth/signup").send({
      username: "x",
      email: "not-an-email",
      password: "short",
      dateOfBirth: "bad",
      gender: "UNKNOWN",
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
      meta: { requestId: expect.any(String) },
    });
  });
});

function createTestApp(repository: AuthRepository) {
  const crypto = new CryptoService(config);
  const service = new AuthService(repository, crypto, config);
  const controller = new AuthController(service, config);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(requestId);
  app.use("/api/v1/auth", createAuthRouter(controller, crypto));
  app.use(errorHandler);
  return app;
}

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
