import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import type {
  FeedPostRecord,
  FeedRepository,
} from "../src/modules/feed/application/ports/feed-repository.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import { FeedService } from "../src/modules/feed/application/services/feed-service.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "feed-cursor-secret-at-least-32-bytes",
} as AppConfig;

describe("FeedCursorCodec", () => {
  it("round-trips a signed cursor and rejects tampering", () => {
    const codec = new FeedCursorCodec(config.JWT_ACCESS_SECRET);
    const cursor = codec.encode({
      version: 1,
      kind: "chronological",
      id: "b9e27322-a92d-4b13-8ddc-3849a3b09a5a",
      createdAt: "2026-07-17T00:00:00.000Z",
    });

    expect(codec.decode(cursor)).toMatchObject({ kind: "chronological" });
    expect(() => codec.decode(`${cursor}x`)).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
  });
});

describe("FeedService", () => {
  it("returns limit items, viewer state, and a signed next cursor", async () => {
    const repository = createRepository();
    vi.mocked(repository.getLatest).mockResolvedValue([
      postFixture(1),
      postFixture(2),
      postFixture(3),
    ]);
    const codec = new FeedCursorCodec(config.JWT_ACCESS_SECRET);
    const service = new FeedService(repository, codec, config);

    const page = await service.getPage("latest", { limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.items[0]).toMatchObject({
      viewerLiked: true,
      viewerSaved: false,
      author: {
        username: "author_1",
        profilePhotoUrl:
          "http://localhost:3001/api/v1/media/a04189bc-c1f2-4da2-bef8-c8289b5ad4a1",
      },
    });
    expect(page.items[0]).not.toHaveProperty("author.email");
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(codec.decode(page.nextCursor!)).toMatchObject({
      kind: "chronological",
      id: postFixture(2).id,
    });
  });

  it("omits hidden author age and country", async () => {
    const repository = createRepository();
    vi.mocked(repository.getTrending).mockResolvedValue([
      postFixture(1, { hideAge: true, hideCountry: true }),
    ]);
    const service = new FeedService(
      repository,
      new FeedCursorCodec(config.JWT_ACCESS_SECRET),
      config,
    );

    const page = await service.getPage("trending", { limit: 20 });
    const author = (page.items[0] as { author: Record<string, unknown> }).author;
    expect(author).not.toHaveProperty("ageRange");
    expect(author).not.toHaveProperty("country");
  });

  it("requires authentication for following feed", async () => {
    const repository = createRepository();
    const service = new FeedService(
      repository,
      new FeedCursorCodec(config.JWT_ACCESS_SECRET),
      config,
    );

    await expect(
      service.getPage("following", { limit: 20 }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
    expect(repository.getFollowing).not.toHaveBeenCalled();
  });
});

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

function postFixture(
  sequence: number,
  authorOverrides: Partial<FeedPostRecord["author"]> = {},
): FeedPostRecord {
  const id = `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  return {
    id,
    body: `Post ${sequence}`,
    likeCount: 1,
    commentCount: 2,
    shareCount: 3,
    saveCount: 4,
    trendingScore: 10 - sequence,
    createdAt: new Date(`2026-07-${17 - sequence}T00:00:00.000Z`),
    updatedAt: new Date(`2026-07-${17 - sequence}T00:00:00.000Z`),
    author: {
      id: "c9725831-5a9b-451f-bb79-2c5bd5d651d3",
      username: `author_${sequence}`,
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
      hideAge: false,
      hideCountry: false,
      hideOnline: false,
      lastSeenAt: null,
      followerCount: 0,
      followingCount: 0,
      postCount: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      profilePhoto: {
        id: "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1",
      },
      coverPhoto: null,
      interests: [],
      ...authorOverrides,
    },
    media: [],
    likes: [{ userId: "viewer-id" }],
    saves: [],
  };
}
