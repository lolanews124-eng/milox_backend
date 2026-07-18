import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { FeedCursorCodec } from "../src/modules/feed/application/services/feed-cursor.js";
import type { FollowRepository } from "../src/modules/follows/application/ports/follow-repository.js";
import {
  CannotFollowSelfError,
  FollowConflictError,
} from "../src/modules/follows/application/ports/follow-repository.js";
import type { FollowListEntry } from "../src/modules/follows/application/follow-view.js";
import { FollowService } from "../src/modules/follows/application/services/follow-service.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  JWT_ACCESS_SECRET: "follow-service-secret-at-least-32",
} as AppConfig;
const viewerId = "8b4dd0d9-7a0d-4d75-a4ad-cb1ca37924e9";
const followId = "a04189bc-c1f2-4da2-bef8-c8289b5ad4a1";

describe("FollowService", () => {
  it("normalizes usernames and returns active follow state", async () => {
    const repository = createRepository();
    vi.mocked(repository.follow).mockResolvedValue({
      isFollowing: true,
      followRequested: false,
      followerCount: 8,
    });

    const state = await createService(repository).follow(
      " @Night_User ",
      viewerId,
    );

    expect(repository.follow).toHaveBeenCalledWith("night_user", viewerId);
    expect(state).toEqual({
      isFollowing: true,
      followRequested: false,
      followerCount: 8,
    });
  });

  it("maps self-follow and pending-request conflicts", async () => {
    const repository = createRepository();
    vi.mocked(repository.follow).mockRejectedValueOnce(
      new CannotFollowSelfError(),
    );
    await expect(
      createService(repository).follow("self", viewerId),
    ).rejects.toMatchObject({
      code: "CANNOT_FOLLOW_SELF",
      statusCode: 422,
    });

    vi.mocked(repository.follow).mockRejectedValueOnce(
      new FollowConflictError("request_pending"),
    );
    await expect(
      createService(repository).follow("private_user", viewerId),
    ).rejects.toMatchObject({
      code: "FOLLOW_REQUEST_PENDING",
      statusCode: 409,
    });
  });

  it("maps missing pending requests without revealing another recipient", async () => {
    const repository = createRepository();
    vi.mocked(repository.respond).mockResolvedValue(false);

    await expect(
      createService(repository).respond(followId, viewerId, "accept"),
    ).rejects.toMatchObject({
      code: "FOLLOW_REQUEST_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("returns privacy-safe follower pages and signed cursors", async () => {
    const repository = createRepository();
    vi.mocked(repository.listFollowers).mockResolvedValue([
      followEntry({ hideAge: true, hideCountry: true }),
      followEntry(),
    ]);

    const page = await createService(repository).listFollowers("author", {
      viewerId,
      limit: 1,
    });

    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));
    const user = page.items[0] as Record<string, unknown>;
    expect(user).not.toHaveProperty("age");
    expect(user).not.toHaveProperty("countryCode");
    expect(user).not.toHaveProperty("email");
  });

  it("includes follow IDs in incoming request pages", async () => {
    const repository = createRepository();
    vi.mocked(repository.listIncoming).mockResolvedValue([followEntry()]);

    const page = await createService(repository).listIncoming(viewerId, {
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({
      id: followId,
      user: { username: "anonymous_user" },
      createdAt: "2026-07-17T00:00:00.000Z",
    });
  });
});

function createService(repository: FollowRepository): FollowService {
  return new FollowService(
    repository,
    new FeedCursorCodec(config.JWT_ACCESS_SECRET),
    config,
  );
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

function followEntry(
  overrides: { hideAge?: boolean; hideCountry?: boolean } = {},
): FollowListEntry {
  return {
    id: followId,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    user: {
      id: "fca0622f-cba7-4398-bfe7-11842c026990",
      username: "anonymous_user",
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
      followerCount: 2,
      followingCount: 3,
      postCount: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      profilePhoto: null,
      coverPhoto: null,
      interests: [],
    },
  };
}
