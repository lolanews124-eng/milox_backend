import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import type {
  PostRepository,
} from "../src/modules/posts/application/ports/post-repository.js";
import {
  IdempotencyConflictError,
  PostActionConflictError,
  PostMediaOwnershipError,
} from "../src/modules/posts/application/ports/post-repository.js";
import type { PostViewRecord } from "../src/modules/posts/application/post-view.js";
import { PostService } from "../src/modules/posts/application/services/post-service.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "post-service-secret-at-least-32-bytes",
} as AppConfig;
const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const postId = "b9e27322-a92d-4b13-8ddc-3849a3b09a5a";

describe("PostService", () => {
  it("creates an idempotent post with normalized text", async () => {
    const repository = createRepository();
    vi.mocked(repository.create).mockResolvedValue({
      post: postFixture(),
      replayed: true,
    });
    const service = createService(repository);

    const result = await service.create(
      userId,
      { body: "  anonymous thought  ", mediaIds: [] },
      "4c960e9a-592a-41e0-9942-2589f5dd0894",
    );

    expect(result.replayed).toBe(true);
    expect(repository.create).toHaveBeenCalledWith({
      authorId: userId,
      body: "anonymous thought",
      mediaIds: [],
      idempotencyKey: "4c960e9a-592a-41e0-9942-2589f5dd0894",
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("rejects duplicate media and media not owned by the author", async () => {
    const repository = createRepository();
    const service = createService(repository);
    const mediaId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";

    await expect(
      service.create(userId, { mediaIds: [mediaId, mediaId] }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    vi.mocked(repository.create).mockRejectedValue(
      new PostMediaOwnershipError(),
    );
    await expect(
      service.create(userId, { mediaIds: [mediaId] }),
    ).rejects.toMatchObject({ code: "MEDIA_NOT_OWNED", statusCode: 403 });
  });

  it("rejects reuse of an idempotency key with another payload", async () => {
    const repository = createRepository();
    vi.mocked(repository.create).mockRejectedValue(
      new IdempotencyConflictError(),
    );

    await expect(
      createService(repository).create(
        userId,
        { body: "different", mediaIds: [] },
        "4c960e9a-592a-41e0-9942-2589f5dd0894",
      ),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    });
  });

  it("does not reveal an unauthorized post owner during edits", async () => {
    const repository = createRepository();
    vi.mocked(repository.findVisible).mockResolvedValue(
      postFixture({ authorId: "fca0622f-cba7-4398-bfe7-11842c026990" }),
    );

    await expect(
      createService(repository).update(postId, userId, { body: "edit" }),
    ).rejects.toMatchObject({ code: "POST_NOT_FOUND", statusCode: 404 });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("maps action conflicts to stable API errors", async () => {
    const repository = createRepository();
    vi.mocked(repository.like).mockRejectedValue(
      new PostActionConflictError("already_liked"),
    );

    await expect(
      createService(repository).like(postId, userId),
    ).rejects.toMatchObject({ code: "ALREADY_LIKED", statusCode: 409 });
  });

  it("paginates user posts and keeps hidden profile fields private", async () => {
    const repository = createRepository();
    vi.mocked(repository.listByUsername).mockResolvedValue([
      postFixture({ hideAge: true, hideCountry: true }),
      postFixture(),
    ]);
    const service = createService(repository);

    const page = await service.listByUsername("author", { limit: 1 });

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));
    const author = (page.items[0] as { author: Record<string, unknown> }).author;
    expect(author).not.toHaveProperty("age");
    expect(author).not.toHaveProperty("countryCode");
    expect(author).not.toHaveProperty("email");
  });
});

function createService(repository: PostRepository): PostService {
  return new PostService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
}

function createRepository(): PostRepository {
  return {
    create: vi.fn(),
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

function postFixture(
  overrides: {
    authorId?: string;
    hideAge?: boolean;
    hideCountry?: boolean;
  } = {},
): PostViewRecord {
  return {
    id: postId,
    body: "anonymous thought",
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    saveCount: 0,
    trendingScore: 0,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    author: {
      id: overrides.authorId ?? userId,
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
    media: [],
    likes: [],
    saves: [],
  };
}
