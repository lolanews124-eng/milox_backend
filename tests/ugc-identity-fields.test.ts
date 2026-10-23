import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/env.js";
import { signupSchema } from "../src/modules/auth/presentation/auth-schemas.js";
import {
  moderateDisplayName,
  moderateUsername,
} from "../src/modules/moderation/application/ugc-moderation.js";
import type {
  UserProfileRecord,
  UserRepository,
} from "../src/modules/users/application/ports/user-repository.js";
import { UserService } from "../src/modules/users/application/services/user-service.js";
import { AppError } from "../src/shared/errors/app-error.js";

const config = {
  API_PUBLIC_URL: "http://localhost:3001",
  INTEREST_DAILY_LIMIT: 20,
} as AppConfig;

describe("display name / username moderation", () => {
  it.each([
    ["hornydude"],
    ["Horny Dude"],
    ["chatsex"],
    ["sex_chat"],
    ["s e x"],
  ])("rejects prohibited display name: %s", (name) => {
    expect(() => moderateDisplayName(name)).toThrow(AppError);
  });

  it.each([
    ["hornydude"],
    ["chatsex"],
    ["sexchat99"],
    ["hornymen"],
  ])("rejects prohibited username: %s", (username) => {
    expect(() => moderateUsername(username)).toThrow(AppError);
  });

  it.each([
    ["Priya Sharma"],
    ["Alex"],
    ["Moon"],
    ["From Essex"],
  ])("allows harmless display name: %s", (name) => {
    expect(() => moderateDisplayName(name)).not.toThrow();
  });

  it.each([["priya_sharma"], ["moon_user"], ["essex_fan"], ["alex99"]])(
    "allows harmless username: %s",
    (username) => {
      expect(() => moderateUsername(username)).not.toThrow();
    },
  );

  it("updateProfile rejects prohibited displayName before persist", async () => {
    const repository = createRepository();
    vi.mocked(repository.findById).mockResolvedValue(profileFixture());
    const service = createService(repository);

    await expect(
      service.updateProfile("user-id", { displayName: "hornydude" }),
    ).rejects.toMatchObject({ code: "CONTENT_REJECTED", statusCode: 422 });
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it("updateProfile rejects prohibited username before persist", async () => {
    const repository = createRepository();
    vi.mocked(repository.findById).mockResolvedValue(
      profileFixture({
        usernameChangedAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    );
    const service = createService(repository);

    await expect(
      service.updateProfile("user-id", { username: "hornydude" }),
    ).rejects.toMatchObject({ code: "CONTENT_REJECTED", statusCode: 422 });
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it("signup schema still enforces username format", () => {
    const bad = signupSchema.safeParse({
      username: "ab",
      email: "a@example.com",
      password: "password12345",
      ageRange: "AGE_25_28",
      country: "India",
      gender: "FEMALE",
      displayName: "Valid Name",
    });
    expect(bad.success).toBe(false);
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
    softDelete: vi.fn(),
    getPremiumStatus: vi.fn().mockResolvedValue({
      isPremium: false,
      premiumExpiresAt: null,
    }),
  } as unknown as UserRepository;
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
