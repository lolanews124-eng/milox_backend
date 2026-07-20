import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import type { AuthService } from "../src/modules/auth/application/services/auth-service.js";
import type {
  UserProfileRecord,
  UserRepository,
  ViewerRelation,
} from "../src/modules/users/application/ports/user-repository.js";
import {
  calculateAge,
  UserService,
} from "../src/modules/users/application/services/user-service.js";

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
    expect(output).not.toHaveProperty("dateOfBirth");
    expect(output).not.toHaveProperty("age");
    expect(output).not.toHaveProperty("countryCode");
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
    vi.mocked(repository.findById).mockResolvedValue(
      profileFixture({ profilePhoto: { id: "old-photo" }, coverPhoto: null }),
    );
    vi.mocked(repository.updateProfile).mockResolvedValue(profileFixture());

    await createService(repository, profileUpdatePosts).updateProfile("user-id", {
      profilePhotoMediaId: "new-photo",
      coverPhotoMediaId: "new-cover",
    });

    expect(profileUpdatePosts.createProfilePhotoUpdatePost).toHaveBeenCalledWith(
      "user-id",
      "new-photo",
    );
    expect(profileUpdatePosts.createCoverPhotoUpdatePost).toHaveBeenCalledWith(
      "user-id",
      "new-cover",
    );
  });
});

describe("calculateAge", () => {
  it("uses the UTC birthday boundary", () => {
    expect(
      calculateAge(
        new Date("2000-07-18T00:00:00.000Z"),
        new Date("2026-07-17T12:00:00.000Z"),
      ),
    ).toBe(25);
  });
});

function createService(
  repository: UserRepository,
  profileUpdatePosts?: {
    createProfilePhotoUpdatePost: ReturnType<typeof vi.fn>;
    createCoverPhotoUpdatePost: ReturnType<typeof vi.fn>;
  },
): UserService {
  const authService = {} as AuthService;
  return new UserService(repository, authService, config, profileUpdatePosts);
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
    id: "user-id",
    username: "moon_user",
    usernameNormalized: "moon_user",
    usernameChangedAt: null,
    email: "private@example.com",
    emailVerifiedAt: new Date(),
    dateOfBirth: new Date("2000-01-01T00:00:00.000Z"),
    gender: "PREFER_NOT_TO_SAY",
    role: "USER",
    status: "ACTIVE",
    displayName: null,
    bio: "Hello",
    countryCode: "IN",
    relationshipGoal: "LONG_TERM",
    websiteUrl: null,
    instagramHandle: null,
    isVerifiedBadge: false,
    isPrivateAccount: false,
    hideAge: false,
    hideCountry: false,
    hideLastSeen: false,
    hideOnline: false,
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    lastSeenAt: new Date(),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
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
    isMatched: false,
    ...overrides,
  };
}
