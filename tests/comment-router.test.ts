import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { CommentRepository } from "../src/modules/comments/application/ports/comment-repository.js";
import type { CommentViewRecord } from "../src/modules/comments/application/comment-view.js";
import { CommentService } from "../src/modules/comments/application/services/comment-service.js";
import { CommentController } from "../src/modules/comments/presentation/comment-controller.js";
import { createCommentRouters } from "../src/modules/comments/presentation/comment-router.js";
import { errorHandler } from "../src/shared/http/error-handler.js";
import { requestId } from "../src/shared/http/request-id.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "comment-router-secret-at-least-32",
} as AppConfig;
const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const postId = "b9e27322-a92d-4b13-8ddc-3849a3b09a5a";
const commentId = "98ea1ca9-5f22-4207-8659-3db6e5d54861";

describe("comment HTTP contract", () => {
  it("returns a top-level comment page", async () => {
    const repository = createRepository();
    vi.mocked(repository.listTopLevel).mockResolvedValue([]);

    const response = await request(createTestApp(repository)).get(
      `/api/v1/posts/${postId}/comments?limit=10`,
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
  });

  it("creates a comment with the standard response envelope", async () => {
    const repository = createRepository();
    vi.mocked(repository.create).mockResolvedValue(commentFixture());

    const response = await request(createTestApp(repository))
      .post(`/api/v1/posts/${postId}/comments`)
      .send({ body: "A respectful comment" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: { id: commentId, postId, body: "A respectful comment" },
      meta: { requestId: expect.any(String) },
    });
  });

  it("rejects blank comment bodies", async () => {
    const response = await request(createTestApp(createRepository()))
      .post(`/api/v1/posts/${postId}/comments`)
      .send({ body: "   " });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for replies of a hidden parent", async () => {
    const repository = createRepository();
    vi.mocked(repository.listReplies).mockResolvedValue(null);

    const response = await request(createTestApp(repository)).get(
      `/api/v1/comments/${commentId}/replies`,
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("COMMENT_NOT_FOUND");
  });
});

function createTestApp(repository: CommentRepository) {
  const service = new CommentService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
  const controller = new CommentController(service);
  const authenticate: RequestHandler = (req, _res, next) => {
    req.auth = { userId, role: "USER", emailVerified: true };
    next();
  };
  const pass: RequestHandler = (_req, _res, next) => {
    next();
  };
  const routers = createCommentRouters(
    controller,
    authenticate,
    pass,
    pass,
  );
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.use("/api/v1/posts", routers.postComments);
  app.use("/api/v1/comments", routers.comments);
  app.use(errorHandler);
  return app;
}

function createRepository(): CommentRepository {
  return {
    create: vi.fn(),
    listTopLevel: vi.fn(),
    listReplies: vi.fn(),
    softDelete: vi.fn(),
    like: vi.fn(),
    unlike: vi.fn(),
  };
}

function commentFixture(): CommentViewRecord {
  return {
    id: commentId,
    postId,
    parentId: null,
    body: "A respectful comment",
    likeCount: 0,
    replyCount: 0,
    depth: 0,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    author: {
      id: userId,
      username: "author",
      displayName: null,
      bio: null,
      ageRange: "AGE_25_28",
      gender: "OTHER",
      country: "India",
      relationshipGoal: null,
      websiteUrl: null,
      instagramHandle: null,
      isVerifiedBadge: false,
      isPrivateAccount: false,
      hideAge: true,
      hideCountry: true,
      followerCount: 0,
      followingCount: 0,
      postCount: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      profilePhoto: null,
      coverPhoto: null,
      interests: [],
    },
    likes: [],
  };
}
