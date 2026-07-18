import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { FollowRepository } from "../src/modules/follows/application/ports/follow-repository.js";
import { FollowService } from "../src/modules/follows/application/services/follow-service.js";
import { FollowController } from "../src/modules/follows/presentation/follow-controller.js";
import { createFollowRouters } from "../src/modules/follows/presentation/follow-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "follow-router-secret-at-least-32",
} as AppConfig;
const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const followId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";

describe("follow HTTP contract", () => {
  it("follows a public user and returns synchronized state", async () => {
    const repository = createRepository();
    vi.mocked(repository.follow).mockResolvedValue({
      isFollowing: true,
      followRequested: false,
      followerCount: 4,
    });

    const response = await request(createTestApp(repository)).put(
      "/api/v1/users/night_user/follow",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        isFollowing: true,
        followRequested: false,
        followerCount: 4,
      },
      meta: { requestId: expect.any(String) },
    });
  });

  it("returns a cursor envelope for public follower lists", async () => {
    const repository = createRepository();
    vi.mocked(repository.listFollowers).mockResolvedValue([]);

    const response = await request(createTestApp(repository)).get(
      "/api/v1/users/night_user/followers?limit=10",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: { items: [] },
      meta: {
        pagination: { nextCursor: null, hasMore: false },
      },
    });
  });

  it("returns incoming follow requests to the authenticated recipient", async () => {
    const repository = createRepository();
    vi.mocked(repository.listIncoming).mockResolvedValue([]);

    const response = await request(createTestApp(repository)).get(
      "/api/v1/follow-requests",
    );

    expect(response.status).toBe(200);
    expect(repository.listIncoming).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ limit: 20 }),
    );
  });

  it("rejects an unknown follow-request action", async () => {
    const response = await request(createTestApp(createRepository()))
      .post(`/api/v1/follow-requests/${followId}`)
      .send({ action: "ignore" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

function createTestApp(repository: FollowRepository) {
  const service = new FollowService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
  const controller = new FollowController(service);
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = { userId, role: "USER", emailVerified: true };
    next();
  };
  const pass: RequestHandler = (_req, _res, next) => {
    next();
  };
  const routers = createFollowRouters(
    controller,
    authenticate,
    pass,
    pass,
  );
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use("/api/v1/users", routers.users);
  app.use("/api/v1/follow-requests", routers.requests);
  app.use(errorHandler);
  return app;
}

function createRepository(): FollowRepository {
  return {
    follow: vi.fn(),
    unfollow: vi.fn(),
    respond: vi.fn(),
    listFollowers: vi.fn(),
    listFollowing: vi.fn(),
    listIncoming: vi.fn(),
  };
}
