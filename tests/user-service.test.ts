import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import type {
  UserProfileRecord,
  UserRepository,
  ViewerRelation,
} from "../src/modules/users/application/ports/user-repository.js";
import { UserService } from "../src/modules/users/application/services/user-service.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
} as AppConfig;

describe("UserService privacy projections", () => {
  it("omits sensitive and hidden profile fields from public output", async () => {
    const repository = createRepository();
    const profile = profileFixture({
      hideAge: true,
      hideCountry: true,
      hideOnline: false,
      lastSeenAt: null,
      hideLastSeen: true,
    });
    vi.mocked(repository.findByUsername).mockResolvedValue(profile);
    vi.mocked(repository.getViewerRelation).mockResolvedValue(
      relationFixture(),
    );
    const service = createService(repository);

    const output = await service.getPublicProfile("moon_user");

    expect(output).not.toHaveProperty("email");
    expect(output).not.toHaveProperty("ageRangeValue");
    expect(output).not.toHaveProperty("ageRange");
    expect(output).not.toHaveProperty("country");
    expect(output).not.toHaveProperty("lastSeenAt");
    expect(output).toMatchObject({
      username: "moon_user",
      profilePhotoUrl:
        "http://localhost:3001/api/v1/media/3d98a9aa-19e3-4b77-a5f0-94a0637541aa",
    });
  });

  it("hides a profile when either user has blocked the other", async () => {
    const repository = createRepository();
    vi.mocked(repository.findByUsername).mockResolvedValue(profileFixture());
    vi.mocked(repository.getViewerRelation).mockResolvedValue(
      relationFixture({ isBlocked: true }),
    );

    await expect(
      createService(repository).getPublicProfile("moon_user", "viewer-id"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("enforces the 30-day username cooldown", async () => {
    const repository = createRepository();
    vi.mocked(repository.findById).mockResolvedValue(
      profileFixture({ usernameChangedAt: new Date() }),
    );

    await expect(
      createService(repository).updateProfile("user-id", {
        username: "new_name",
      }),
    ).rejects.toMatchObject({
      code: "USERNAME_CHANGE_LIMITED",
      statusCode: 429,
    });
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it("creates feed posts when profile or cover photos change", async () => {
    const repository = createRepository();
    const profileUpdatePosts = {
      createProfilePhotoUpdatePost: vi.fn().mockResolvedValue(undefined),
      createCoverPhotoUpdatePost: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(repository.findById).mockResolvedValue(profileFixture());
    vi.mocked(repository.updateProfile).mockResolvedValue(
      profileFixture({
        profilePhoto: { id: "new-photo-id" },
      }),
    );

    await createService(repository, profileUpdatePosts).updateProfile(
      "user-id",
      { profilePhotoMediaId: "new-photo-id" },
    );

    expect(profileUpdatePosts.createProfilePhotoUpdatePost).toHaveBeenCalled();
  });
});

function createService(
  repository: UserRepository,
  profileUpdatePosts?: {
    createProfilePhotoUpdatePost: ReturnType<typeof vi.fn>;
    createCoverPhotoUpdatePost: ReturnType<typeof vi.fn>;
  },
): UserService {
  return new UserService(
    repository,
    {} as never,
    config,
    profileUpdatePosts,
  );
}

function createRepository(): UserRepository {
  return {
    findById: vi.fn(),
    findByUsername: vi.fn(),
    searchUsers: vi.fn(),
    getViewerRelation: vi.fn(),
    updateProfile: vi.fn(),
    updatePrivacy: vi.fn(),
    softDelete: vi.fn(),
  };
}

function profileFixture(
  overrides: Partial<UserProfileRecord> = {},
): UserProfileRecord {
  return {
    id: "4a727dd8-a77d-4a51-8841-3e94a4b68650",
    username: "moon_user",
    usernameNormalized: "moon_user",
    usernameChangedAt: null,
    email: "moon@example.com",
    emailVerifiedAt: new Date("2026-07-17T00:00:00.000Z"),
    ageRange: "AGE_25_28",
    gender: "PREFER_NOT_TO_SAY",
    role: "USER",
    status: "ACTIVE",
    displayName: "Moon",
    bio: "Hello",
    country: "India",
    relationshipGoal: "DATING",
    websiteUrl: null,
    instagramHandle: null,
    isVerifiedBadge: false,
    isPrivateAccount: false,
    hideAge: false,
    hideCountry: false,
    hideLastSeen: false,
    hideOnline: false,
    followerCount: 10,
    followingCount: 5,
    postCount: 2,
    lastSeenAt: new Date("2026-07-17T00:00:00.000Z"),
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    profilePhoto: { id: "3d98a9aa-19e3-4b77-a5f0-94a0637541aa" },
    coverPhoto: null,
    interests: [{ tag: { slug: "music", label: "Music" } }],
    wallet: { balance: 500 },
    ...overrides,
  };
}

function relationFixture(
  overrides: Partial<ViewerRelation> = {},
): ViewerRelation {
  return {
    isSelf: false,
    isFollowing: false,
    followRequested: false,
    isFollowedBy: false,
    isBlocked: false,
    hasPendingInterest: false,
    hasIncomingPendingInterest: false,
    isMatched: false,
    ...overrides,
  };
}
