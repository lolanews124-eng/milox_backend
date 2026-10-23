import { describe, expect, it, vi } from "vitest";

import type { AuthRepository } from "../src/modules/auth/application/ports/auth-repository.js";
import { AuthService } from "../src/modules/auth/application/services/auth-service.js";
import type { CryptoService } from "../src/modules/auth/application/services/crypto-service.js";
import type { AppConfig } from "../src/config/env.js";

const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";

describe("auth inactivity signals + suspended rejection", () => {
  it("records lastLoginAt on successful login session", async () => {
    const repository = createRepository();
    vi.mocked(repository.findUserByEmail).mockResolvedValue(activeUser());
    vi.mocked(repository.createRefreshSession).mockResolvedValue(undefined);
    vi.mocked(repository.touchLastLoginAt).mockResolvedValue(undefined);

    const crypto = createCrypto(true);
    const service = new AuthService(
      repository,
      crypto,
      minimalConfig(),
    );

    await service.login("a@example.com", "password", { clientKind: "consumer" });

    expect(repository.touchLastLoginAt).toHaveBeenCalledWith(userId);
  });

  it("rejects login for suspended accounts", async () => {
    const repository = createRepository();
    vi.mocked(repository.findUserByEmail).mockResolvedValue({
      ...activeUser(),
      status: "SUSPENDED",
    });
    const crypto = createCrypto(true);
    const service = new AuthService(
      repository,
      crypto,
      minimalConfig(),
    );

    await expect(
      service.login("a@example.com", "password", { clientKind: "consumer" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    expect(repository.createRefreshSession).not.toHaveBeenCalled();
  });

  it("rejects refresh and revokes sessions when status is not ACTIVE", async () => {
    const repository = createRepository();
    vi.mocked(repository.rotateRefreshSession).mockResolvedValue({
      status: "rotated",
      user: { ...activeUser(), status: "SUSPENDED" },
    });
    vi.mocked(repository.revokeAllUserSessions).mockResolvedValue(undefined);
    const crypto = createCrypto(true);
    const service = new AuthService(
      repository,
      crypto,
      minimalConfig(),
    );

    await expect(
      service.refresh("refresh-token", { clientKind: "consumer" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    expect(repository.revokeAllUserSessions).toHaveBeenCalledWith(userId);
  });
});

function activeUser() {
  return {
    id: userId,
    username: "alice",
    displayName: "Alice",
    email: "a@example.com",
    passwordHash: "hash",
    ageRange: "AGE_25_28" as const,
    country: "IN",
    gender: "FEMALE" as const,
    role: "USER" as const,
    status: "ACTIVE" as const,
    isVerifiedBadge: false,
    isSystemAccount: false,
    emailVerifiedAt: new Date(),
    createdAt: new Date(),
  };
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
    touchLastLoginAt: vi.fn(),
  };
}

function createCrypto(passwordOk: boolean): CryptoService {
  return {
    verifyLoginPassword: vi.fn().mockResolvedValue(passwordOk),
    verifyPassword: vi.fn(),
    hashPassword: vi.fn(),
    createOpaqueToken: vi.fn().mockReturnValue({
      raw: "raw",
      hash: "hash",
    }),
    hashOpaqueToken: vi.fn().mockReturnValue("hashed"),
    hashIp: vi.fn().mockReturnValue(undefined),
    createId: vi.fn().mockReturnValue("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    createAccessToken: vi.fn().mockResolvedValue("access"),
    verifyAccessToken: vi.fn(),
  } as unknown as CryptoService;
}

function minimalConfig(): AppConfig {
  return {
    REFRESH_TOKEN_TTL_DAYS: 30,
    JWT_ACCESS_TTL_SECONDS: 900,
  } as AppConfig;
}
