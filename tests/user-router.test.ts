import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import type { AuthService } from "../src/modules/auth/application/services/auth-service.js";
import type {
  UserProfileRecord,
  UserRepository,
} from "../src/modules/users/application/ports/user-repository.js";
import { UserService } from "../src/modules/users/application/services/user-service.js";
import { UserController } from "../src/modules/users/presentation/user-controller.js";
import { createUserRouter } from "../src/modules/users/presentation/user-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const authenticate: RequestHandler = (request, _response, next) => {
  request.auth = {
    userId: "6c9437fd-9103-42c6-b7e4-5a52a6d32cdd",
    role: "USER",
    emailVerified: true,
  };
  next();
};

describe("user HTTP contract", () => {
  it("returns private fields only from /users/me", async () => {
    const repository = createRepository();
    vi.mocked(repository.findById).mockResolvedValue(profileFixture());
    const app = createTestApp(repository);

    const response = await request(app).get("/api/v1/users/me");

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      username: "private_user",
      email: "private@example.com",
      dateOfBirth: "2000-01-01",
    });
    expect(response.body.data).not.toHaveProperty("passwordHash");
  });

  it("does not leak hidden fields from a public profile route", async () => {
    const repository = createRepository();
    vi.mocked(repository.findByUsername).mockResolvedValue(
      profileFixture({ hideAge: true, hideCountry: true }),
    );
    vi.mocked(repository.getViewerRelation).mockResolvedValue({
      isSelf: false,
      isFollowing: false,
      followRequested: false,
      isFollowedBy: false,
      isBlocked: false,
      hasPendingInterest: false,
      isMatched: false,
    });
    const app = createTestApp(repository);

    const response = await request(app).get(
      "/api/v1/users/private_user",
    );

    expect(response.status).toBe(200);
    expect(response.body.data).not.toHaveProperty("email");
    expect(response.body.data).not.toHaveProperty("dateOfBirth");
    expect(response.body.data).not.toHaveProperty("age");
    expect(response.body.data).not.toHaveProperty("countryCode");
  });
});

function createTestApp(repository: UserRepository) {
  const config = {
    API_PUBLIC_URL: "http://localhost:3001",
  } as AppConfig;
  const service = new UserService(
    repository,
    {} as AuthService,
    config,
  );
  const controller = new UserController(service);
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use(
    "/api/v1/users",
    createUserRouter(controller, {
      authenticate,
      optionalAuthenticate: authenticate,
      requireVerified: (_request, _response, next) => {
        next();
      },
    }),
  );
  app.use(errorHandler);
  return app;
}

function createRepository(): UserRepository {
  return {
    findById: vi.fn(),
    findByUsername: vi.fn(),
    searchUsers: vi.fn(),
    getViewerRelation: vi.fn(),
    updateProfile: vi.fn(),
    updatePrivacy: vi.fn(),
    softDelete: vi.fn(),
  };
}

function profileFixture(
  overrides: Partial<UserProfileRecord> = {},
): UserProfileRecord {
  return {
    id: "6c9437fd-9103-42c6-b7e4-5a52a6d32cdd",
    username: "private_user",
    usernameNormalized: "private_user",
    usernameChangedAt: null,
    email: "private@example.com",
    emailVerifiedAt: new Date(),
    dateOfBirth: new Date("2000-01-01T00:00:00.000Z"),
    gender: "OTHER",
    role: "USER",
    status: "ACTIVE",
    displayName: null,
    bio: null,
    countryCode: "IN",
    relationshipGoal: null,
    websiteUrl: null,
    instagramHandle: null,
    isVerifiedBadge: false,
    isPrivateAccount: false,
    hideAge: false,
    hideCountry: false,
    hideLastSeen: false,
    hideOnline: false,
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    lastSeenAt: null,
    createdAt: new Date(),
    profilePhoto: null,
    coverPhoto: null,
    interests: [],
    ...overrides,
  };
}
