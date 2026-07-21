import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import type { FeedRepository } from "../src/modules/feed/application/ports/feed-repository.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import { FeedService } from "../src/modules/feed/application/services/feed-service.js";
import { FeedController } from "../src/modules/feed/presentation/feed-controller.js";
import { createFeedRouter } from "../src/modules/feed/presentation/feed-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "feed-router-secret-at-least-32-bytes",
} as AppConfig;

describe("feed HTTP contract", () => {
  it("returns the cursor pagination envelope", async () => {
    const repository = createRepository();
    vi.mocked(repository.getLatest).mockResolvedValue([]);
    const response = await request(createTestApp(repository)).get(
      "/api/v1/feed/latest?limit=10",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { items: [] },
      meta: {
        requestId: expect.any(String),
        pagination: { nextCursor: null, hasMore: false },
      },
    });
    expect(repository.getLatest).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });

  it("rejects an out-of-range page size", async () => {
    const response = await request(createTestApp(createRepository())).get(
      "/api/v1/feed/latest?limit=500",
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("passes discover filters to the repository", async () => {
    const repository = createRepository();
    vi.mocked(repository.getDiscoverPeople).mockResolvedValue([]);
    const response = await request(createTestApp(repository)).get(
      "/api/v1/feed/discover?limit=20&ageRange=AGE_25_28&ageRange=AGE_29_34&gender=FEMALE&country=India&country=United%20States",
    );

    expect(response.status).toBe(200);
    expect(repository.getDiscoverPeople).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        viewerId: "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9",
        ageRanges: ["AGE_25_28", "AGE_29_34"],
        genders: ["FEMALE"],
        countries: ["India", "United States"],
      }),
    );
  });

  it("accepts comma-separated discover filter values", async () => {
    const repository = createRepository();
    vi.mocked(repository.getDiscoverPeople).mockResolvedValue([]);
    const response = await request(createTestApp(repository)).get(
      "/api/v1/feed/discover?ageRange=AGE_18_24,AGE_65_70&gender=MALE,NON_BINARY&country=Canada",
    );

    expect(response.status).toBe(200);
    expect(repository.getDiscoverPeople).toHaveBeenCalledWith(
      expect.objectContaining({
        ageRanges: ["AGE_18_24", "AGE_65_70"],
        genders: ["MALE", "NON_BINARY"],
        countries: ["Canada"],
      }),
    );
  });

  it("rejects invalid discover filter values", async () => {
    const response = await request(createTestApp(createRepository())).get(
      "/api/v1/feed/discover?ageRange=NOT_A_RANGE",
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

function createTestApp(repository: FeedRepository) {
  const service = new FeedService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
  const controller = new FeedController(service);
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = {
      userId: "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9",
      role: "USER",
      emailVerified: true,
    };
    next();
  };
  const optionalAuthenticate: RequestHandler = (_req, _res, next) => {
    next();
  };
  const app = express();
  app.use(requestId);
  app.use(
    "/api/v1/feed",
    createFeedRouter(controller, authenticate, optionalAuthenticate),
  );
  app.use(errorHandler);
  return app;
}

function createRepository(): FeedRepository {
  return {
    getLatest: vi.fn(),
    getFollowing: vi.fn(),
    getTrending: vi.fn(),
    getSuggested: vi.fn(),
    getDiscoverPeople: vi.fn(),
    passProfile: vi.fn(),
    getPassedProfileIds: vi.fn(),
    userExists: vi.fn(),
  };
}
