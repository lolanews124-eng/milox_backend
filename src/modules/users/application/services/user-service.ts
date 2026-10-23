import { ageRangeLabel } from "../../../../shared/contracts/age-ranges.js";
import {
  USERNAME_COOLDOWN_DAYS,
  assessProfileCompletion,
  canChangeUsername,
  usernameChangeAvailableAt,
} from "../../../../shared/contracts/profile-completion.js";
import {
  ReelReviewStatus,
  UserRole,
  UserStatus,
  type AgeRange,
  type PremiumTier,
  type PrismaClient,
  type RelationshipGoal,
} from "@prisma/client";

import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import { computeProfileHealth } from "../../../moderation/application/profile-health.js";
import {
  resolveUserEntitlements,
  syncUserPremiumState,
  type UserEntitlements,
} from "../../../premium/application/entitlements.js";
import { MILOX_OFFICIAL_USERNAME } from "../../../official-chat/official-chat-config.js";
import {
  isAdsEligibleProfile,
  moderateProfileText,
} from "../../../moderation/application/ugc-moderation.js";
import type { AuthService } from "../../../auth/application/services/auth-service.js";
import {
  DuplicateUsernameError,
  InvalidProfileReferenceError,
} from "../ports/user-repository.js";
import type {
  PrivacySettings,
  UpdateProfileData,
  UserProfileRecord,
  UserRepository,
  ViewerRelation,
} from "../ports/user-repository.js";
import { presentPublicAuthor, viewerFollowStateFromStatus } from "../../../posts/application/post-view.js";
import type { ProfileUpdatePostWriter } from "../../../posts/application/profile-update-post-writer.js";
import type { ProfileViewRepository } from "../ports/profile-view-repository.js";

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "help",
  "milox",
  "moderator",
  "root",
  "security",
  "staff",
  "support",
]);

export interface UpdateProfileInput {
  username?: string | undefined;
  displayName?: string | null | undefined;
  bio?: string | null | undefined;
  ageRange?: AgeRange | undefined;
  country?: string | undefined;
  relationshipGoal?: RelationshipGoal | null | undefined;
  websiteUrl?: string | null | undefined;
  instagramHandle?: string | null | undefined;
  profilePhotoMediaId?: string | null | undefined;
  coverPhotoMediaId?: string | null | undefined;
  interestSlugs?: string[] | undefined;
}

/** Google allows 50,000 URLs per file. Stay under that so one response stays small. */
const PUBLIC_SITEMAP_PAGE_SIZE = 10_000;

export class UserService {
  constructor(
    private readonly repository: UserRepository,
    private readonly authService: AuthService,
    private readonly config: AppConfig,
    private readonly database: PrismaClient,
    private readonly profileUpdatePosts?: ProfileUpdatePostWriter,
    private readonly profileViews?: ProfileViewRepository,
  ) {}

  async getEntitlements(userId: string): Promise<UserEntitlements> {
    await this.requireActiveUser(userId);
    return resolveUserEntitlements(
      this.database,
      userId,
      this.config.INTEREST_DAILY_LIMIT,
    );
  }

  async getMe(userId: string): Promise<object> {
    const user = await this.requireActiveUser(userId);
    const entitlements = await resolveUserEntitlements(
      this.database,
      userId,
      this.config.INTEREST_DAILY_LIMIT,
    );
    return mapPrivateProfile(user, this.config, entitlements);
  }

  async getProfileHealth(userId: string): Promise<object> {
    const user = await this.requireActiveUser(userId);
    const warnings = await this.database.profileWarning.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        reasonCode: true,
        message: true,
        scoreDelta: true,
        restrictUntil: true,
        createdAt: true,
      },
    });
    const health = computeProfileHealth(warnings, new Date());
    const bioState = user.bioModerationState ?? "APPROVED";
    const bioPubliclyVisible = bioState === "APPROVED";
    // Strike-based health score is separate from keyword UGC gating — surface both.
    return {
      score: health.score,
      band: health.band,
      bandLabel: health.bandLabel,
      restrictedUntil: health.restrictedUntil?.toISOString() ?? null,
      bioModerationState: bioState,
      bioPubliclyVisible,
      bioHeldForReview: bioState === "PENDING",
      bioRejected: bioState === "REJECTED" || bioState === "REMOVED",
      warnings: [...warnings]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, 12)
        .map((warning) => ({
          id: warning.id,
          kind: warning.kind,
          reasonCode: warning.reasonCode,
          message: warning.message,
          scoreDelta: warning.scoreDelta,
          createdAt: warning.createdAt.toISOString(),
        })),
    };
  }

  async publicSitemap(query: {
    kind: "counts" | "profiles" | "posts" | "reels";
    page: number;
  }): Promise<
    | {
        profiles: number;
        posts: number;
        reels: number;
        pageSize: number;
      }
    | {
        kind: "profiles" | "posts" | "reels";
        page: number;
        pageSize: number;
        total: number;
        items: Array<{
          username?: string;
          id?: string;
          updatedAt: string;
          images?: string[];
          video?: {
            contentUrl: string;
            thumbnailUrl: string | null;
            title: string;
            description: string;
            durationSec: number | null;
          } | null;
        }>;
      }
  > {
    const author = {
      deletedAt: null,
      status: UserStatus.ACTIVE,
      isPrivateAccount: false,
      role: UserRole.USER,
      isSystemAccount: false,
    };
    // Only substantive public UGC — thin empty profiles/posts flood the
    // sitemap, burn crawl budget, and push marketing pages out of Google.
    const profileWhere = {
      ...author,
      profilePhotoMediaId: { not: null },
      OR: [
        { postCount: { gte: 1 } },
        { AND: [{ bio: { not: null } }, { NOT: { bio: "" } }] },
      ],
    };
    const postWhere = {
      deletedAt: null,
      isHidden: false,
      author,
      media: { some: {} },
    };
    const reelWhere = {
      deletedAt: null,
      status: ReelReviewStatus.APPROVED,
      author,
      posterMediaId: { not: null },
      durationMs: { gte: 1000 },
    };
    if (query.kind === "counts") {
      const [profiles, posts, reels] = await Promise.all([
        this.database.user.count({ where: profileWhere }),
        this.database.post.count({ where: postWhere }),
        this.database.reel.count({ where: reelWhere }),
      ]);
      return {
        profiles,
        posts,
        reels,
        pageSize: PUBLIC_SITEMAP_PAGE_SIZE,
      };
    }

    const skip = (query.page - 1) * PUBLIC_SITEMAP_PAGE_SIZE;
    const pageSize = PUBLIC_SITEMAP_PAGE_SIZE;
    if (query.kind === "profiles") {
      const [total, rows] = await Promise.all([
        this.database.user.count({ where: profileWhere }),
        this.database.user.findMany({
          where: profileWhere,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip,
          take: pageSize,
          select: {
            username: true,
            updatedAt: true,
            bio: true,
            postCount: true,
            profilePhotoMediaId: true,
            coverPhotoMediaId: true,
          },
        }),
      ]);
      const items = rows
        .filter((row) => {
          const bio = row.bio?.replace(/\s+/g, " ").trim() ?? "";
          return bio.length >= 20 || row.postCount >= 1;
        })
        .map((row) => {
          const images = [
            mediaUrl(row.profilePhotoMediaId ?? undefined, this.config),
            mediaUrl(row.coverPhotoMediaId ?? undefined, this.config),
          ].filter((url): url is string => Boolean(url));
          return {
            username: row.username,
            updatedAt: row.updatedAt.toISOString(),
            ...(images.length > 0 ? { images } : {}),
          };
        });
      return {
        kind: "profiles",
        page: query.page,
        pageSize,
        total,
        items,
      };
    }
    if (query.kind === "posts") {
      const [total, rows] = await Promise.all([
        this.database.post.count({ where: postWhere }),
        this.database.post.findMany({
          where: postWhere,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip,
          take: pageSize,
          select: {
            id: true,
            updatedAt: true,
            media: {
              orderBy: { sortOrder: "asc" },
              take: 10,
              select: { mediaAssetId: true },
            },
          },
        }),
      ]);
      return {
        kind: "posts",
        page: query.page,
        pageSize,
        total,
        items: rows.map((row) => {
          const images = row.media
            .map((item) => mediaUrl(item.mediaAssetId, this.config))
            .filter((url): url is string => Boolean(url));
          return {
            id: row.id,
            updatedAt: row.updatedAt.toISOString(),
            ...(images.length > 0 ? { images } : {}),
          };
        }),
      };
    }
    const [total, rows] = await Promise.all([
      this.database.reel.count({ where: reelWhere }),
      this.database.reel.findMany({
        where: reelWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          createdAt: true,
          caption: true,
          durationMs: true,
          mediaAssetId: true,
          posterMediaId: true,
          author: { select: { username: true, displayName: true } },
        },
      }),
    ]);
    return {
      kind: "reels",
      page: query.page,
      pageSize,
      total,
      items: rows.map((row) => {
        const contentUrl = mediaUrl(row.mediaAssetId, this.config);
        const thumbnailUrl = mediaUrl(
          row.posterMediaId ?? undefined,
          this.config,
        );
        const authorName =
          row.author.displayName?.trim() || row.author.username;
        const caption = row.caption?.replace(/\s+/g, " ").trim() || "";
        const title =
          caption.slice(0, 100) || `Reel by ${authorName} on Milox`;
        const description =
          caption.slice(0, 2048) || `Reel by ${authorName} on Milox.`;
        const images = thumbnailUrl ? [thumbnailUrl] : [];
        return {
          id: row.id,
          updatedAt: row.createdAt.toISOString(),
          ...(images.length > 0 ? { images } : {}),
          video: contentUrl
            ? {
                contentUrl,
                thumbnailUrl,
                title,
                description,
                durationSec:
                  row.durationMs > 0
                    ? Math.max(1, Math.round(row.durationMs / 1000))
                    : null,
              }
            : null,
        };
      }),
    };
  }

  async getPublicProfile(
    username: string,
    viewerUserId?: string,
  ): Promise<object> {
    const user = await this.repository.findByUsername(
      normalizeUsername(username),
    );
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      (user.role !== "USER" &&
        !(user.isSystemAccount && user.usernameNormalized === MILOX_OFFICIAL_USERNAME))
    ) {
      // Suspended / banned / deleted profiles are not publicly addressable (404, not soft redirect).
      throw new AppError("NOT_FOUND", "User not found", 404);
    }
    const relation = await this.repository.getViewerRelation(
      user.id,
      viewerUserId,
    );
    if (relation.isBlocked && !relation.isSelf) {
      throw new AppError("NOT_FOUND", "User not found", 404);
    }
    if (
      this.profileViews &&
      viewerUserId &&
      !relation.isSelf &&
      !relation.isBlocked &&
      !user.isSystemAccount
    ) {
      void this.profileViews
        .upsertView(user.id, viewerUserId)
        .catch(() => undefined);
    }
    const entitlements = await resolveUserEntitlements(
      this.database,
      user.id,
      this.config.INTEREST_DAILY_LIMIT,
    );
    void reconcilePremiumDenormalization(
      this.database,
      user,
      entitlements,
    ).catch(() => undefined);
    return mapPublicProfile(user, relation, this.config, entitlements);
  }

  async getProfileViewsSummary(userId: string): Promise<object> {
    await this.requireActiveUser(userId);
    const entitlements = await resolveUserEntitlements(
      this.database,
      userId,
      this.config.INTEREST_DAILY_LIMIT,
    );
    const totalCount = this.profileViews
      ? await this.profileViews.countViews(userId)
      : 0;
    const previewSlotCount = Math.min(totalCount, 3);
    const recentPreview =
      entitlements.features.profileViews && this.profileViews
        ? (
            await this.profileViews.listViews(userId, { limit: 3 })
          ).map((row) => ({
            viewer: presentPublicAuthor(row.viewer, this.config),
            viewedAt: row.viewedAt.toISOString(),
            lastViewedAt: row.updatedAt.toISOString(),
          }))
        : [];

    return {
      totalCount,
      previewSlotCount,
      isPremium: entitlements.isPremium,
      premiumTier: entitlements.tier,
      premiumExpiresAt: entitlements.expiresAt,
      entitlements: entitlements.features,
      recentPreview,
    };
  }

  async getProfileViews(
    userId: string,
    options: { limit: number; cursor?: string },
  ): Promise<{
    items: object[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    await this.requireActiveUser(userId);
    const entitlements = await resolveUserEntitlements(
      this.database,
      userId,
      this.config.INTEREST_DAILY_LIMIT,
    );
    if (!entitlements.features.profileViews) {
      throw new AppError(
        "PREMIUM_REQUIRED",
        "Premium subscription required to view profile visitors",
        403,
      );
    }
    if (!this.profileViews) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const before = options.cursor
      ? decodeProfileViewCursor(options.cursor)
      : undefined;
    const rows = await this.profileViews.listViews(userId, {
      limit: options.limit + 1,
      ...(before ? { before } : {}),
    });
    const hasMore = rows.length > options.limit;
    const page = rows.slice(0, options.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        viewer: presentPublicAuthor(row.viewer, this.config),
        viewedAt: row.viewedAt.toISOString(),
        lastViewedAt: row.updatedAt.toISOString(),
      })),
      nextCursor:
        hasMore && last
          ? encodeProfileViewCursor({
              updatedAt: last.updatedAt.toISOString(),
              viewerId: last.viewerId,
            })
          : null,
      hasMore,
    };
  }

  async search(
    term: string,
    options: { viewerId?: string; cursor?: string; limit: number },
  ): Promise<{
    items: object[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const before = options.cursor
      ? decodeUserSearchCursor(options.cursor)
      : undefined;
    const rows = await this.repository.searchUsers({
      term,
      limit: options.limit + 1,
      ...(options.viewerId ? { viewerId: options.viewerId } : {}),
      ...(before ? { before } : {}),
    });
    const hasMore = rows.length > options.limit;
    const page = rows.slice(0, options.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => presentPublicAuthor(row, this.config)),
      nextCursor:
        hasMore && last
          ? encodeUserSearchCursor({
              followerCount: last.followerCount,
              id: last.id,
            })
          : null,
      hasMore,
    };
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<object> {
    const current = await this.requireActiveUser(userId);
    // Never trust client-supplied moderation fields (schema is .strict(), belt+suspenders).
    const data: UpdateProfileData = { ...input };
    delete (data as { bioModerationState?: unknown }).bioModerationState;
    delete (data as { bioModerationReason?: unknown }).bioModerationReason;
    delete (data as { bioModeratedAt?: unknown }).bioModeratedAt;

    if (input.username !== undefined) {
      const normalized = normalizeUsername(input.username);
      if (RESERVED_USERNAMES.has(normalized)) {
        throw new AppError(
          "USERNAME_RESERVED",
          "This username is reserved",
          422,
        );
      }
      if (normalized !== current.usernameNormalized) {
        if (
          !canChangeUsername(current.usernameChangedAt, current.createdAt)
        ) {
          throw new AppError(
            "USERNAME_CHANGE_LIMITED",
            `Username can be changed once every ${USERNAME_COOLDOWN_DAYS} days`,
            429,
          );
        }
        data.username = input.username;
        data.usernameNormalized = normalized;
        data.usernameChangedAt = new Date();
      } else {
        delete data.username;
      }
    }

    if (input.ageRange !== undefined) {
      data.ageRange = input.ageRange;
    }
    if (input.country !== undefined) {
      data.country = input.country;
    }
    if (input.interestSlugs) {
      data.interestSlugs = [
        ...new Set(input.interestSlugs.map((slug) => slug.toLowerCase())),
      ];
    }

    // Profile photo is required for Discover/feed quality — never clear it.
    if (
      input.profilePhotoMediaId === null ||
      (input.profilePhotoMediaId !== undefined &&
        String(input.profilePhotoMediaId).trim() === "")
    ) {
      throw new AppError(
        "PROFILE_PHOTO_REQUIRED",
        "A profile photo is required. You can replace it, but not remove it.",
        422,
      );
    }

    if (input.bio !== undefined || input.websiteUrl !== undefined) {
      const moderation = moderateProfileText({
        bio: input.bio !== undefined ? input.bio : current.bio,
        websiteUrl:
          input.websiteUrl !== undefined ? input.websiteUrl : current.websiteUrl,
      });
      data.bioModerationState = moderation.state;
      data.bioModerationReason = moderation.reason;
      data.bioModeratedAt = new Date();
    }

    try {
      const updated = await this.repository.updateProfile(userId, data);
      await this.publishProfilePhotoUpdatePosts(current, input);
      return mapPrivateProfile(
        updated,
        this.config,
        await resolveUserEntitlements(
          this.database,
          userId,
          this.config.INTEREST_DAILY_LIMIT,
        ),
      );
    } catch (error: unknown) {
      if (error instanceof DuplicateUsernameError) {
        throw new AppError("USERNAME_TAKEN", "Username is already in use", 409);
      }
      if (error instanceof InvalidProfileReferenceError) {
        const message =
          error.field === "interestSlugs"
            ? "One or more selected interests are not available. Please try again."
            : "A referenced profile value is invalid";
        const code =
          error.field === "interestSlugs"
            ? "INVALID_INTEREST_TAG"
            : "MEDIA_NOT_OWNED";
        throw new AppError(code, message, 422);
      }
      throw error;
    }
  }

  async updatePrivacy(
    userId: string,
    settings: PrivacySettings,
  ): Promise<object> {
    await this.requireActiveUser(userId);
    const updated = await this.repository.updatePrivacy(userId, settings);
    return mapPrivateProfile(
      updated,
      this.config,
      await resolveUserEntitlements(
        this.database,
        userId,
        this.config.INTEREST_DAILY_LIMIT,
      ),
    );
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.requireActiveUser(userId);
    await this.authService.changePassword(
      userId,
      currentPassword,
      newPassword,
    );
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.requireActiveUser(userId);
    await this.repository.softDelete(userId, new Date());
  }

  private async requireActiveUser(userId: string): Promise<UserProfileRecord> {
    const user = await this.repository.findById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError("NOT_FOUND", "User not found", 404);
    }
    return user;
  }

  private async publishProfilePhotoUpdatePosts(
    current: UserProfileRecord,
    input: UpdateProfileInput,
  ): Promise<void> {
    if (!this.profileUpdatePosts) return;

    const profilePhotoChanged =
      input.profilePhotoMediaId !== undefined &&
      input.profilePhotoMediaId !== null &&
      input.profilePhotoMediaId !== current.profilePhoto?.id;
    const coverPhotoChanged =
      input.coverPhotoMediaId !== undefined &&
      input.coverPhotoMediaId !== null &&
      input.coverPhotoMediaId !== current.coverPhoto?.id;

    const tasks: Promise<void>[] = [];
    if (profilePhotoChanged && input.profilePhotoMediaId) {
      tasks.push(
        this.profileUpdatePosts.createProfilePhotoUpdatePost(
          current.id,
          input.profilePhotoMediaId,
        ),
      );
    }
    if (coverPhotoChanged && input.coverPhotoMediaId) {
      tasks.push(
        this.profileUpdatePosts.createCoverPhotoUpdatePost(
          current.id,
          input.coverPhotoMediaId,
        ),
      );
    }

    await Promise.all(
      tasks.map((task) =>
        task.catch(() => {
          // Profile update should succeed even if feed post creation fails.
        }),
      ),
    );
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

function premiumProfileFields(
  user: UserProfileRecord,
  entitlements?: UserEntitlements,
): {
  isVerifiedBadge: boolean;
  premiumTier: PremiumTier;
  premiumBadgeLabel: string | null;
  premiumPlanCode: string | null;
} {
  const grantVerified = entitlements?.features.grantVerifiedBadge ?? false;
  return {
    isVerifiedBadge: user.isVerifiedBadge || grantVerified,
    premiumTier: entitlements?.tier ?? user.premiumTier,
    premiumBadgeLabel: entitlements?.features.badgeLabel ?? null,
    premiumPlanCode: entitlements?.planCode ?? null,
  };
}

async function reconcilePremiumDenormalization(
  database: PrismaClient,
  user: UserProfileRecord,
  entitlements: UserEntitlements,
): Promise<void> {
  const needsSync = user.premiumTier !== entitlements.tier;
  if (!needsSync) return;
  await syncUserPremiumState(database, user.id);
}

function mapPublicProfile(
  user: UserProfileRecord,
  relation: ViewerRelation,
  config: AppConfig,
  entitlements?: UserEntitlements,
): object {
  const isOfficialAccount =
    user.isSystemAccount && user.usernameNormalized === MILOX_OFFICIAL_USERNAME;
  const premium = premiumProfileFields(user, entitlements);

  const bioPublic =
    !user.bioModerationState || user.bioModerationState === "APPROVED"
      ? user.bio
      : null;
  const websitePublic =
    !user.bioModerationState || user.bioModerationState === "APPROVED"
      ? user.websiteUrl
      : null;
  const adsEligible = isAdsEligibleProfile({
    bioModerationState: user.bioModerationState ?? null,
    status: user.status,
    deletedAt: null,
  });

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: bioPublic,
    profilePhotoUrl: mediaUrl(user.profilePhoto?.id, config),
    coverPhotoUrl: mediaUrl(user.coverPhoto?.id, config),
    ...(isOfficialAccount
      ? {}
      : {
          gender: user.gender,
          ...(!user.hideAge ? { ageRange: ageRangeLabel(user.ageRange) } : {}),
          ...(!user.hideCountry ? { country: user.country } : {}),
          relationshipGoal: user.relationshipGoal,
          websiteUrl: websitePublic,
          instagramHandle: user.instagramHandle,
          interests: user.interests.map(({ tag }) => tag.slug),
        }),
    isVerifiedBadge: premium.isVerifiedBadge,
    premiumTier: premium.premiumTier,
    premiumBadgeLabel: premium.premiumBadgeLabel,
    premiumPlanCode: premium.premiumPlanCode,
    isOfficialAccount,
    isPrivateAccount: user.isPrivateAccount,
    adsEligible,
    followerCount: user.followerCount,
    followingCount: user.followingCount,
    postCount: user.postCount,
    ...(!user.hideLastSeen && user.lastSeenAt
      ? { lastSeenAt: user.lastSeenAt.toISOString() }
      : {}),
    viewerRelation: relation,
    viewerFollowState: viewerFollowStateFromStatus(
      relation.isFollowing
        ? "ACTIVE"
        : relation.followRequested
          ? "PENDING"
          : undefined,
    ),
    createdAt: user.createdAt.toISOString(),
  };
}

function mapPrivateProfile(
  user: UserProfileRecord,
  config: AppConfig,
  entitlements: UserEntitlements,
): object {
  const relation: ViewerRelation = {
    isSelf: true,
    isFollowing: false,
    followRequested: false,
    isFollowedBy: false,
    isBlocked: false,
    hasPendingInterest: false,
    hasIncomingPendingInterest: false,
    isMatched: false,
  };
  const profilePhotoUrl = mediaUrl(user.profilePhoto?.id, config);
  const completion = assessProfileCompletion({
    displayName: user.displayName,
    username: user.username,
    profilePhotoId: user.profilePhoto?.id ?? null,
    profilePhotoUrl,
    ageRange: user.ageRange,
    country: user.country,
    relationshipGoal: user.relationshipGoal,
    interests: user.interests.map(({ tag }) => tag.slug),
  });
  const usernameChangeAllowed = canChangeUsername(
    user.usernameChangedAt,
    user.createdAt,
  );
  const nextUsernameChangeAt = usernameChangeAvailableAt(
    user.usernameChangedAt,
    user.createdAt,
  );
  return {
    ...mapPublicProfile(user, relation, config, entitlements),
    // Owner always sees own bio/website even while held for review.
    bio: user.bio,
    websiteUrl: user.websiteUrl,
    bioModerationState: user.bioModerationState ?? "APPROVED",
    bioModerationReason:
      user.bioModerationState && user.bioModerationState !== "APPROVED"
        ? "Your bio is held for review and is not shown publicly yet."
        : null,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    ageRange: user.ageRange,
    ageRangeLabel: ageRangeLabel(user.ageRange),
    country: user.country,
    role: user.role,
    status: user.status,
    hideAge: user.hideAge,
    hideCountry: user.hideCountry,
    hideLastSeen: user.hideLastSeen,
    hideOnline: user.hideOnline,
    walletBalance: user.wallet?.balance ?? 0,
    profileComplete: completion.isComplete,
    profileCompletionMissing: completion.missingFields,
    usernameChangedAt: user.usernameChangedAt?.toISOString() ?? null,
    canChangeUsername: usernameChangeAllowed,
    canChangeUsernameAt: usernameChangeAllowed
      ? null
      : nextUsernameChangeAt.toISOString(),
    broadcastEnabled: user.broadcastEnabled,
    isPremium: entitlements.isPremium,
    premiumTier: entitlements.tier,
    premiumExpiresAt: entitlements.expiresAt,
    premiumPlanCode: entitlements.planCode,
    premiumPlanName: entitlements.planName,
    premiumBadgeLabel: entitlements.features.badgeLabel,
    entitlements: entitlements.features,
  };
}

function encodeProfileViewCursor(cursor: {
  updatedAt: string;
  viewerId: string;
}): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeProfileViewCursor(value: string): {
  updatedAt: Date;
  viewerId: string;
} {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { updatedAt?: unknown }).updatedAt !== "string" ||
      typeof (parsed as { viewerId?: unknown }).viewerId !== "string"
    ) {
      throw new Error("bad cursor");
    }
    const updatedAt = new Date((parsed as { updatedAt: string }).updatedAt);
    if (Number.isNaN(updatedAt.getTime())) {
      throw new Error("bad cursor");
    }
    return {
      updatedAt,
      viewerId: (parsed as { viewerId: string }).viewerId,
    };
  } catch {
    throw new AppError(
      "INVALID_CURSOR",
      "The pagination cursor is invalid or expired",
      400,
    );
  }
}

function mediaUrl(
  mediaId: string | undefined,
  config: AppConfig,
): string | null {
  if (!mediaId) return null;
  return `${config.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/media/${mediaId}`;
}

function encodeUserSearchCursor(cursor: {
  followerCount: number;
  id: string;
}): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeUserSearchCursor(value: string): {
  followerCount: number;
  id: string;
} {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { followerCount?: unknown }).followerCount !==
        "number" ||
      typeof (parsed as { id?: unknown }).id !== "string"
    ) {
      throw new Error("bad cursor");
    }
    return parsed as { followerCount: number; id: string };
  } catch {
    throw new AppError(
      "INVALID_CURSOR",
      "The pagination cursor is invalid or expired",
      400,
    );
  }
}
