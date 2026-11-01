/**
 * PostgreSQL concurrency/correctness tests for PrismaPostRepository.recordView.
 *
 * Opt-in only:
 *   $env:POST_VIEW_PG="1"
 *   $env:POST_VIEW_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/milox_post_view_e2e?schema=public"
 *
 * Setup (local only):
 *   npm run test:post-view-pg:setup
 *   Then run with the env vars above.
 */
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPostRepository } from "../../src/modules/posts/infrastructure/prisma-post-repository.js";
import {
  assertPostViewPgEnabled,
  assertSafePostViewDatabaseUrl,
} from "./safety.js";

const optedIn = process.env.POST_VIEW_PG === "1";
const describePg = optedIn ? describe : describe.skip;

const RUN = `pview_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

describe("post-view PG safety gate", () => {
  it("refuses milox_live_copy", () => {
    expect(() =>
      assertSafePostViewDatabaseUrl(
        "postgresql://postgres:x@127.0.0.1:5432/milox_live_copy?schema=public",
      ),
    ).toThrow(/milox_post_view_e2e/);
  });

  it("accepts milox_post_view_e2e on loopback", () => {
    const safe = assertSafePostViewDatabaseUrl(
      "postgresql://postgres:x@127.0.0.1:5432/milox_post_view_e2e?schema=public",
    );
    expect(safe.database).toBe("milox_post_view_e2e");
  });

  it("documents opt-in when disabled", () => {
    if (optedIn) return;
    expect(process.env.POST_VIEW_PG).not.toBe("1");
  });
});

describePg("PrismaPostRepository.recordView (PostgreSQL)", () => {
  let database: PrismaClient;
  let repository: PrismaPostRepository;
  let authorId = "";
  let viewerA = "";
  let viewerB = "";
  let publicPostId = "";
  let privatePostId = "";
  let ownPostId = "";

  beforeAll(async () => {
    assertPostViewPgEnabled();
    const safe = assertSafePostViewDatabaseUrl(
      process.env.POST_VIEW_DATABASE_URL,
    );
    database = new PrismaClient({
      datasources: { db: { url: safe.url } },
    });
    repository = new PrismaPostRepository(database);
    await database.$connect();

    authorId = randomUUID();
    viewerA = randomUUID();
    viewerB = randomUUID();
    publicPostId = randomUUID();
    privatePostId = randomUUID();
    ownPostId = randomUUID();

    const users = [
      { id: authorId, username: `${RUN}_auth` },
      { id: viewerA, username: `${RUN}_va` },
      { id: viewerB, username: `${RUN}_vb` },
    ];
    for (const user of users) {
      await database.user.create({
        data: {
          id: user.id,
          username: user.username.slice(0, 32),
          usernameNormalized: user.username.slice(0, 32).toLowerCase(),
          email: `${user.username}@pview.milox.local`,
          passwordHash: "pview-not-a-real-hash",
          ageRange: "AGE_25_28",
          gender: "PREFER_NOT_TO_SAY",
          country: "India",
          status: "ACTIVE",
          role: "USER",
          isPrivateAccount: false,
        },
      });
    }

    const privateAuthorId = randomUUID();
    await database.user.create({
      data: {
        id: privateAuthorId,
        username: `${RUN}_priv`.slice(0, 32),
        usernameNormalized: `${RUN}_priv`.slice(0, 32).toLowerCase(),
        email: `${RUN}_priv@pview.milox.local`,
        passwordHash: "pview-not-a-real-hash",
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        status: "ACTIVE",
        role: "USER",
        isPrivateAccount: true,
      },
    });

    await database.post.create({
      data: {
        id: publicPostId,
        authorId,
        body: `${RUN} public`,
        kind: "STANDARD",
        viewCount: 0,
        moderationState: "APPROVED",
        isHidden: false,
      },
    });
    await database.post.create({
      data: {
        id: ownPostId,
        authorId,
        body: `${RUN} own`,
        kind: "STANDARD",
        viewCount: 5,
        moderationState: "APPROVED",
        isHidden: false,
      },
    });
    await database.post.create({
      data: {
        id: privatePostId,
        authorId: privateAuthorId,
        body: `${RUN} private`,
        kind: "STANDARD",
        viewCount: 0,
        moderationState: "APPROVED",
        isHidden: false,
      },
    });
  });

  afterAll(async () => {
    if (!database) return;
    await database.postView.deleteMany({
      where: {
        OR: [
          { postId: { in: [publicPostId, privatePostId, ownPostId] } },
          { viewerId: { in: [viewerA, viewerB, authorId] } },
        ],
      },
    });
    await database.post.deleteMany({
      where: { id: { in: [publicPostId, privatePostId, ownPostId] } },
    });
    await database.user.deleteMany({
      where: {
        OR: [
          { id: { in: [authorId, viewerA, viewerB] } },
          { email: { endsWith: "@pview.milox.local" } },
        ],
      },
    });
    await database.$disconnect();
  });

  it("increments once for a first unique view and not again on duplicate", async () => {
    const first = await repository.recordView(publicPostId, viewerA);
    expect(first).toEqual({ viewCount: 1 });

    const duplicate = await repository.recordView(publicPostId, viewerA);
    expect(duplicate).toEqual({ viewCount: 1 });

    const views = await database.postView.count({
      where: { postId: publicPostId, viewerId: viewerA },
    });
    expect(views).toBe(1);

    const post = await database.post.findUniqueOrThrow({
      where: { id: publicPostId },
      select: { viewCount: true },
    });
    expect(post.viewCount).toBe(1);
  });

  it("never double-increments under concurrent duplicate requests", async () => {
    const postId = randomUUID();
    const viewerId = randomUUID();
    await database.user.create({
      data: {
        id: viewerId,
        username: `${RUN}_cd`.slice(0, 32),
        usernameNormalized: `${RUN}_cd`.slice(0, 32).toLowerCase(),
        email: `${RUN}_cd@pview.milox.local`,
        passwordHash: "pview-not-a-real-hash",
        ageRange: "AGE_25_28",
        gender: "PREFER_NOT_TO_SAY",
        country: "India",
        status: "ACTIVE",
        role: "USER",
      },
    });
    await database.post.create({
      data: {
        id: postId,
        authorId,
        body: `${RUN} concurrent-dup`,
        kind: "STANDARD",
        viewCount: 0,
        moderationState: "APPROVED",
        isHidden: false,
      },
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => repository.recordView(postId, viewerId)),
    );

    expect(results.every((row) => row?.viewCount === 1)).toBe(true);
    const post = await database.post.findUniqueOrThrow({
      where: { id: postId },
      select: { viewCount: true },
    });
    expect(post.viewCount).toBe(1);
    expect(
      await database.postView.count({ where: { postId, viewerId } }),
    ).toBe(1);
  });

  it("increments once per distinct viewer under concurrent load", async () => {
    const postId = randomUUID();
    await database.post.create({
      data: {
        id: postId,
        authorId,
        body: `${RUN} many-viewers`,
        kind: "STANDARD",
        viewCount: 0,
        moderationState: "APPROVED",
        isHidden: false,
      },
    });

    const viewerIds = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const id = randomUUID();
        await database.user.create({
          data: {
            id,
            username: `${RUN}_mv${index}`.slice(0, 32),
            usernameNormalized: `${RUN}_mv${index}`.slice(0, 32).toLowerCase(),
            email: `${RUN}_mv${index}@pview.milox.local`,
            passwordHash: "pview-not-a-real-hash",
            ageRange: "AGE_25_28",
            gender: "PREFER_NOT_TO_SAY",
            country: "India",
            status: "ACTIVE",
            role: "USER",
          },
        });
        return id;
      }),
    );

    const results = await Promise.all(
      viewerIds.map((id) => repository.recordView(postId, id)),
    );

    expect(results.map((row) => row?.viewCount).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );

    const post = await database.post.findUniqueOrThrow({
      where: { id: postId },
      select: { viewCount: true },
    });
    expect(post.viewCount).toBe(12);
    expect(await database.postView.count({ where: { postId } })).toBe(12);
  });

  it("does not increment when the author views their own post", async () => {
    const result = await repository.recordView(ownPostId, authorId);
    expect(result).toEqual({ viewCount: 5 });
    expect(
      await database.postView.count({
        where: { postId: ownPostId, viewerId: authorId },
      }),
    ).toBe(0);
    const post = await database.post.findUniqueOrThrow({
      where: { id: ownPostId },
      select: { viewCount: true },
    });
    expect(post.viewCount).toBe(5);
  });

  it("returns null for an invisible private post without writing", async () => {
    const result = await repository.recordView(privatePostId, viewerA);
    expect(result).toBeNull();
    expect(
      await database.postView.count({ where: { postId: privatePostId } }),
    ).toBe(0);
  });

  it("returns null after soft-delete and does not increment further", async () => {
    const postId = randomUUID();
    await database.post.create({
      data: {
        id: postId,
        authorId,
        body: `${RUN} deleted`,
        kind: "STANDARD",
        viewCount: 2,
        moderationState: "APPROVED",
        isHidden: false,
      },
    });

    const before = await repository.recordView(postId, viewerB);
    expect(before).toEqual({ viewCount: 3 });

    await database.post.update({
      where: { id: postId },
      data: { deletedAt: new Date(), isHidden: true },
    });

    const after = await repository.recordView(postId, viewerA);
    expect(after).toBeNull();

    const post = await database.post.findUniqueOrThrow({
      where: { id: postId },
      select: { viewCount: true },
    });
    expect(post.viewCount).toBe(3);
  });
});
