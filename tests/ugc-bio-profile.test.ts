import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { signupSchema } from "../src/modules/auth/presentation/auth-schemas.js";
import { moderateProfileText } from "../src/modules/moderation/application/ugc-moderation.js";
import type {
  UserProfileRecord,
  UserRepository,
  ViewerRelation,
} from "../src/modules/users/application/ports/user-repository.js";
import { UserService } from "../src/modules/users/application/services/user-service.js";
import { updateProfileSchema } from "../src/modules/users/presentation/user-schemas.js";
import { AppError } from "../src/shared/errors/app-error.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  INTEREST_DAILY_LIMIT: 20,
} as AppConfig;

describe("registration has no bio path", () => {
  it("signup schema rejects a client-supplied bio field", () => {
    const parsed = signupSchema.safeParse({
      username: "new_user",
      email: "new@example.com",
      password: "password12345",
      ageRange: "AGE_25_28",
      country: "India",
      gender: "FEMALE",
      displayName: "New User",
      bio: "horny, seducing",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("bio moderation on profile update", () => {
  it("rejects sexually solicitous first-time bios server-side", () => {
    expect(() =>
      moderateProfileText({ bio: "horny, seducing", websiteUrl: null }),
    ).toThrow(AppError);
  });

  it("rejects the same content on subsequent bio edits", () => {
    expect(() =>
      moderateProfileText({
        bio: "Still horny tonight",
        websiteUrl: "https://example.com",
      }),
    ).toThrow(AppError);
  });

  it("holds ambiguous sexy language for review (pending)", () => {
    const result = moderateProfileText({
      bio: "feeling sexy",
      websiteUrl: null,
    });
    expect(result.state).toBe("PENDING");
    expect(result.isHidden).toBe(true);
  });

  it("updateProfile does not persist rejected bios", async () => {
    const repository = createRepository();
    vi.mocked(repository.findById).mockResolvedValue(profileFixture());
    const service = createService(repository);

    await expect(
      service.updateProfile("user-id", { bio: "horny, seducing" }),
    ).rejects.toMatchObject({ code: "CONTENT_REJECTED", statusCode: 422 });
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it("updateProfile persists PENDING for reviewable bio language", async () => {
    const repository = createRepository();
    vi.mocked(repository.findById).mockResolvedValue(profileFixture());
    vi.mocked(repository.updateProfile).mockImplementation(async (_id, data) =>
      profileFixture({
        bio: data.bio ?? null,
        ...(data.bioModerationState !== undefined
          ? { bioModerationState: data.bioModerationState }
          : {}),
      }),
    );
    const service = createService(repository);

    await service.updateProfile("user-id", { bio: "feeling sexy" });

    expect(repository.updateProfile).toHaveBeenCalledWith(
      "user-id",
      expect.objectContaining({
        bio: "feeling sexy",
        bioModerationState: "PENDING",
      }),
    );
  });

  it("public profile omits non-approved bio text", async () => {
    const repository = createRepository();
    vi.mocked(repository.findByUsername).mockResolvedValue(
      profileFixture({
        bio: "held for review text",
        bioModerationState: "PENDING",
      }),
    );
    vi.mocked(repository.getViewerRelation).mockResolvedValue(
      relationFixture(),
    );
    const service = createService(repository);

    const output = (await service.getPublicProfile("moon_user")) as {
      bio: string | null;
      adsEligible: boolean;
    };
    expect(output.bio).toBeNull();
    expect(output.adsEligible).toBe(false);
  });

  it("rejects client attempts to set bioModerationState via schema", () => {
    const parsed = updateProfileSchema.safeParse({
      bio: "hello world bio",
      bioModerationState: "APPROVED",
    });
    expect(parsed.success).toBe(false);
  });

  it("ignores a forged APPROVED status on prohibited bio text", async () => {
    const repository = createRepository();
    vi.mocked(repository.findById).mockResolvedValue(profileFixture());
    const service = createService(repository);

    await expect(
      service.updateProfile("user-id", {
        bio: "horny, seducing",
        // @ts-expect-error — simulate a forged client payload
        bioModerationState: "APPROVED",
      }),
    ).rejects.toMatchObject({ code: "CONTENT_REJECTED", statusCode: 422 });
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it("server re-evaluates bio; client REJECTED cannot override a clean bio", async () => {
    const repository = createRepository();
    vi.mocked(repository.findById).mockResolvedValue(profileFixture());
    vi.mocked(repository.updateProfile).mockImplementation(async (_id, data) =>
      profileFixture({
        bio: data.bio ?? "clean bio text here",
        ...(data.bioModerationState !== undefined
          ? { bioModerationState: data.bioModerationState }
          : {}),
      }),
    );
    const service = createService(repository);

    await service.updateProfile("user-id", {
      bio: "clean bio text here",
      // @ts-expect-error — simulate a forged client payload
      bioModerationState: "REJECTED",
    });

    expect(repository.updateProfile).toHaveBeenCalledWith(
      "user-id",
      expect.objectContaining({
        bio: "clean bio text here",
        bioModerationState: "APPROVED",
      }),
    );
  });

  it("profile health exposes UGC bio gate separately from strike score", async () => {
    const repository = createRepository();
    vi.mocked(repository.findById).mockResolvedValue(
      profileFixture({
        bio: "pending bio",
        bioModerationState: "PENDING",
      }),
    );
    const database = {
      profileWarning: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      userSubscription: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new UserService(
      repository,
      {} as never,
      config,
      database as never,
    );
    const health = (await service.getProfileHealth("user-id")) as {
      score: number;
      band: string;
      bioPubliclyVisible: boolean;
      bioHeldForReview: boolean;
    };
    expect(health.score).toBe(100);
    expect(health.band).toBe("GOOD");
    expect(health.bioPubliclyVisible).toBe(false);
    expect(health.bioHeldForReview).toBe(true);
  });
});

function createService(repository: UserRepository): UserService {
  return new UserService(repository, {} as never, config, {
    userSubscription: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { update: vi.fn() },
    profileWarning: { findMany: vi.fn().mockResolvedValue([]) },
  } as never);
}

function createRepository(): UserRepository {
  return {
    findById: vi.fn(),
    findByUsername: vi.fn(),
    getViewerRelation: vi.fn(),
    updateProfile: vi.fn(),
    updatePrivacy: vi.fn(),
    searchUsers: vi.fn(),
    listFollowers: vi.fn(),
    listFollowing: vi.fn(),
    softDelete: vi.fn(),
    getPremiumStatus: vi.fn().mockResolvedValue({
      isPremium: false,
      premiumExpiresAt: null,
    }),
  } as unknown as UserRepository;
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

function profileFixture(
  overrides: Partial<UserProfileRecord> = {},
): UserProfileRecord {
  return {
    id: "user-id",
    username: "moon_user",
    usernameNormalized: "moon_user",
    usernameChangedAt: null,
    email: "moon@example.com",
    emailVerifiedAt: new Date(),
    ageRange: "AGE_25_28",
    gender: "FEMALE",
    role: "USER",
    status: "ACTIVE",
    displayName: "Moon",
    bio: "Hello",
    bioModerationState: "APPROVED",
    bioModerationReason: null,
    country: "India",
    relationshipGoal: "DATING",
    websiteUrl: null,
    instagramHandle: null,
    isVerifiedBadge: false,
    broadcastEnabled: false,
    premiumTier: "FREE",
    premiumExpiresAt: null,
    isSystemAccount: false,
    isPrivateAccount: false,
    hideAge: false,
    hideCountry: false,
    hideLastSeen: false,
    hideOnline: false,
    followerCount: 1,
    followingCount: 1,
    postCount: 0,
    lastSeenAt: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    profilePhoto: { id: "3d98a9aa-19e3-4b77-a5f0-94a0637541aa" },
    coverPhoto: null,
    interests: [{ tag: { slug: "music", label: "Music" } }],
    wallet: { balance: 0 },
    ...overrides,
  } as UserProfileRecord;
}
