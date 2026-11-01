import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaPostRepository } from "../src/modules/posts/infrastructure/prisma-post-repository.js";

const authorId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const viewerId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const postId = "b9e27322-a92d-4b13-8ddc-3849a3b09a5a";

describe("PrismaPostRepository.recordView", () => {
  it("returns null without writing when the post is not visible", async () => {
    const database = {
      post: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const result = await new PrismaPostRepository(database).recordView(
      postId,
      viewerId,
    );

    expect(result).toBeNull();
    expect(database.$queryRaw).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("returns the current viewCount without writing when the author views their own post", async () => {
    const database = {
      post: {
        findFirst: vi.fn().mockResolvedValue({
          authorId,
          viewCount: 7,
        }),
      },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const result = await new PrismaPostRepository(database).recordView(
      postId,
      authorId,
    );

    expect(result).toEqual({ viewCount: 7 });
    expect(database.$queryRaw).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("records a unique view via a single atomic SQL write (no interactive transaction)", async () => {
    const database = {
      post: {
        findFirst: vi.fn().mockResolvedValue({
          authorId,
          viewCount: 3,
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ viewCount: 4 }]),
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const result = await new PrismaPostRepository(database).recordView(
      postId,
      viewerId,
    );

    expect(result).toEqual({ viewCount: 4 });
    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("returns null when the atomic write cannot resolve a viewCount", async () => {
    const database = {
      post: {
        findFirst: vi.fn().mockResolvedValue({
          authorId,
          viewCount: 0,
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ viewCount: null }]),
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const result = await new PrismaPostRepository(database).recordView(
      postId,
      viewerId,
    );

    expect(result).toBeNull();
  });
});
