import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { PostRepository } from "../src/modules/posts/application/ports/post-repository.js";
import type { PostViewRecord } from "../src/modules/posts/application/post-view.js";
import { PostService } from "../src/modules/posts/application/services/post-service.js";
import { PostController } from "../src/modules/posts/presentation/post-controller.js";
import { createPostRouters } from "../src/modules/posts/presentation/post-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "post-router-secret-at-least-32-bytes",
} as AppConfig;
const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const postId = "b9e27322-a92d-4b13-8ddc-3849a3b09a5a";
const idempotencyKey = "4c960e9a-592a-41e0-9942-2589f5dd0894";

describe("post HTTP contract", () => {
  it("creates a post with required idempotency metadata", async () => {
    const repository = createRepository();
    vi.mocked(repository.create).mockResolvedValue({
      post: postFixture(),
      replayed: false,
    });

    const response = await request(createTestApp(repository))
      .post("/api/v1/posts")
      .set("Idempotency-Key", idempotencyKey)
      .send({ body: "A private thought", mediaIds: [] });

    expect(response.status).toBe(201);
    expect(response.header["idempotency-replayed"]).toBe("false");
    expect(response.body).toMatchObject({
      success: true,
      data: { id: postId, body: "A private thought" },
      meta: { requestId: expect.any(String) },
    });
  });

  it("rejects create without an Idempotency-Key", async () => {
    const response = await request(createTestApp(createRepository()))
      .post("/api/v1/posts")
      .send({ body: "A thought", mediaIds: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when privacy policy hides a post", async () => {
    const repository = createRepository();
    vi.mocked(repository.findVisible).mockResolvedValue(null);

    const response = await request(createTestApp(repository)).get(
      `/api/v1/posts/${postId}`,
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("POST_NOT_FOUND");
  });

  it("serves user post pages from the users route", async () => {
    const repository = createRepository();
    vi.mocked(repository.listByUsername).mockResolvedValue([]);

    const response = await request(createTestApp(repository)).get(
      "/api/v1/users/author/posts?limit=10",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: { items: [] },
      meta: {
        pagination: { nextCursor: null, hasMore: false },
      },
    });
  });
});

function createTestApp(repository: PostRepository) {
  const service = new PostService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
  const controller = new PostController(service);
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = { userId, role: "USER", emailVerified: true };
    next();
  };
  const optionalAuthenticate: RequestHandler = (_req, _res, next) => {
    next();
  };
  const requireVerified: RequestHandler = (_req, _res, next) => {
    next();
  };
  const routers = createPostRouters(
    controller,
    authenticate,
    optionalAuthenticate,
    requireVerified,
  );
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use("/api/v1/posts", routers.posts);
  app.use("/api/v1/users", routers.userPosts);
  app.use(errorHandler);
  return app;
}

function createRepository(): PostRepository {
  return {
    create: vi.fn(),
    createProfileUpdatePost: vi.fn(),
    findVisible: vi.fn(),
    listByUsername: vi.fn(),
    listSaved: vi.fn(),
    listTrendingHashtags: vi.fn(),
    searchHashtags: vi.fn(),
    findHashtag: vi.fn(),
    listByHashtag: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    like: vi.fn(),
    unlike: vi.fn(),
    save: vi.fn(),
    unsave: vi.fn(),
    share: vi.fn(),
    report: vi.fn(),
  };
}

function postFixture(): PostViewRecord {
  return {
    id: postId,
    kind: "STANDARD",
    body: "A private thought",
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    saveCount: 0,
    trendingScore: 0,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    author: {
      id: userId,
      username: "author",
      displayName: null,
      bio: null,
      dateOfBirth: new Date("2000-01-01T00:00:00.000Z"),
      gender: "OTHER",
      countryCode: "IN",
      relationshipGoal: null,
      websiteUrl: null,
      instagramHandle: null,
      isVerifiedBadge: false,
      isPrivateAccount: false,
      hideAge: false,
      hideCountry: false,
      hideOnline: false,
      lastSeenAt: null,
      followerCount: 0,
      followingCount: 0,
      postCount: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      profilePhoto: null,
      coverPhoto: null,
      interests: [],
    },
    media: [],
    likes: [],
    saves: [],
  };
}
