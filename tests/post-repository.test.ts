import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { IdempotencyConflictError } from "../src/modules/posts/application/ports/post-repository.js";
import type { PostViewRecord } from "../src/modules/posts/application/post-view.js";
import { PrismaPostRepository } from "../src/modules/posts/infrastructure/prisma-post-repository.js";

const userId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const postId = "b9e27322-a92d-4b13-8ddc-3849a3b09a5a";
const key = "4c960e9a-592a-41e0-9942-2589f5dd0894";

describe("PrismaPostRepository idempotency", () => {
  it("returns the original post without opening another transaction", async () => {
    const post = postFixture();
    const database = {
      idempotencyRecord: {
        findUnique: vi.fn().mockResolvedValue({
          requestHash: "a".repeat(64),
          resourceId: postId,
        }),
      },
      post: { findUnique: vi.fn().mockResolvedValue(post) },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const repository = new PrismaPostRepository(database);

    const result = await repository.create({
      authorId: userId,
      body: "thought",
      mediaIds: [],
      idempotencyKey: key,
      requestHash: "a".repeat(64),
    });

    expect(result).toEqual({ post, replayed: true });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("rejects the same key when the request hash differs", async () => {
    const database = {
      idempotencyRecord: {
        findUnique: vi.fn().mockResolvedValue({
          requestHash: "a".repeat(64),
          resourceId: postId,
        }),
      },
      post: { findUnique: vi.fn() },
    } as unknown as PrismaClient;

    await expect(
      new PrismaPostRepository(database).create({
        authorId: userId,
        body: "changed",
        mediaIds: [],
        idempotencyKey: key,
        requestHash: "b".repeat(64),
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(database.post.findUnique).not.toHaveBeenCalled();
  });
});

function postFixture(): PostViewRecord {
  return {
    id: postId,
    body: "thought",
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
      countryCode: null,
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
    media: [],
    likes: [],
    saves: [],
  };
}
