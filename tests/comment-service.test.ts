import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { CommentRepository } from "../src/modules/comments/application/ports/comment-repository.js";
import {
  CommentActionConflictError,
  CommentDepthError,
} from "../src/modules/comments/application/ports/comment-repository.js";
import type { CommentViewRecord } from "../src/modules/comments/application/comment-view.js";
import { CommentService } from "../src/modules/comments/application/services/comment-service.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "comment-service-secret-at-least-32",
} as AppConfig;
const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const postId = "b9e27322-a92d-4b13-8ddc-3849a3b09a5a";
const commentId = "98ea1ca9-5f22-4207-8659-3db6e5d54861";
const parentId = "26bfa884-e6e4-47a6-a309-bf1ed3ebec5e";

describe("CommentService", () => {
  it("normalizes and creates a one-level reply", async () => {
    const repository = createRepository();
    vi.mocked(repository.create).mockResolvedValue(
      commentFixture({ parentId }),
    );

    const comment = await createService(repository).create(postId, userId, {
      body: "  respectful reply  ",
      parentId,
    });

    expect(repository.create).toHaveBeenCalledWith({
      postId,
      authorId: userId,
      body: "respectful reply",
      parentId,
    });
    expect(comment).toMatchObject({ id: commentId, parentId });
  });

  it("maps nested reply attempts to COMMENT_DEPTH_EXCEEDED", async () => {
    const repository = createRepository();
    vi.mocked(repository.create).mockRejectedValue(new CommentDepthError());

    await expect(
      createService(repository).create(postId, userId, {
        body: "too deep",
        parentId,
      }),
    ).rejects.toMatchObject({
      code: "COMMENT_DEPTH_EXCEEDED",
      statusCode: 422,
    });
  });

  it("does not expose comments when their post is hidden", async () => {
    const repository = createRepository();
    vi.mocked(repository.listTopLevel).mockResolvedValue(null);

    await expect(
      createService(repository).listTopLevel(postId, { limit: 20 }),
    ).rejects.toMatchObject({ code: "POST_NOT_FOUND", statusCode: 404 });
  });

  it("returns signed pagination and privacy-safe authors", async () => {
    const repository = createRepository();
    vi.mocked(repository.listTopLevel).mockResolvedValue([
      commentFixture({ hideAge: true, hideCountry: true }),
      commentFixture(),
    ]);

    const page = await createService(repository).listTopLevel(postId, {
      limit: 1,
    });

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));
    const author = (page.items[0] as { author: Record<string, unknown> }).author;
    expect(author).not.toHaveProperty("age");
    expect(author).not.toHaveProperty("countryCode");
    expect(author).not.toHaveProperty("email");
  });

  it("maps duplicate likes to a stable conflict", async () => {
    const repository = createRepository();
    vi.mocked(repository.like).mockRejectedValue(
      new CommentActionConflictError("already_liked"),
    );

    await expect(
      createService(repository).like(commentId, userId),
    ).rejects.toMatchObject({ code: "ALREADY_LIKED", statusCode: 409 });
  });

  it("returns COMMENT_NOT_FOUND for unauthorized deletion", async () => {
    const repository = createRepository();
    vi.mocked(repository.softDelete).mockResolvedValue(false);

    await expect(
      createService(repository).delete(commentId, userId),
    ).rejects.toMatchObject({ code: "COMMENT_NOT_FOUND", statusCode: 404 });
  });
});

function createService(repository: CommentRepository): CommentService {
  return new CommentService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
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

function commentFixture(
  overrides: {
    parentId?: string;
    hideAge?: boolean;
    hideCountry?: boolean;
  } = {},
): CommentViewRecord {
  return {
    id: commentId,
    postId,
    parentId: overrides.parentId ?? null,
    body: "respectful reply",
    likeCount: 0,
    replyCount: 0,
    depth: overrides.parentId ? 1 : 0,
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
      hideAge: overrides.hideAge ?? false,
      hideCountry: overrides.hideCountry ?? false,
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
    likes: [],
  };
}
