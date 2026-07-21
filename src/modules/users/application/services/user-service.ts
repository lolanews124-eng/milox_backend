import { ageRangeLabel } from "@milox/contracts";
import type { AgeRange, RelationshipGoal } from "@prisma/client";

import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
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
const USERNAME_COOLDOWN_DAYS = 30;

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

export class UserService {
  constructor(
    private readonly repository: UserRepository,
    private readonly authService: AuthService,
    private readonly config: AppConfig,
    private readonly profileUpdatePosts?: ProfileUpdatePostWriter,
  ) {}

  async getMe(userId: string): Promise<object> {
    const user = await this.requireActiveUser(userId);
    return mapPrivateProfile(user, this.config);
  }

  async getPublicProfile(
    username: string,
    viewerUserId?: string,
  ): Promise<object> {
    const user = await this.repository.findByUsername(
      normalizeUsername(username),
    );
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found", 404);
    }
    const relation = await this.repository.getViewerRelation(
      user.id,
      viewerUserId,
    );
    if (relation.isBlocked && !relation.isSelf) {
      throw new AppError("NOT_FOUND", "User not found", 404);
    }
    return mapPublicProfile(user, relation, this.config);
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
    const data: UpdateProfileData = { ...input };

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
          current.usernameChangedAt &&
          current.usernameChangedAt >
            new Date(Date.now() - USERNAME_COOLDOWN_DAYS * 86_400_000)
        ) {
          throw new AppError(
            "USERNAME_CHANGE_LIMITED",
            "Username can be changed once every 30 days",
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

    try {
      const updated = await this.repository.updateProfile(userId, data);
      await this.publishProfilePhotoUpdatePosts(current, input);
      return mapPrivateProfile(updated, this.config);
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
    return mapPrivateProfile(updated, this.config);
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

function mapPublicProfile(
  user: UserProfileRecord,
  relation: ViewerRelation,
  config: AppConfig,
): object {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    profilePhotoUrl: mediaUrl(user.profilePhoto?.id, config),
    coverPhotoUrl: mediaUrl(user.coverPhoto?.id, config),
    gender: user.gender,
    ...(!user.hideAge ? { ageRange: ageRangeLabel(user.ageRange) } : {}),
    ...(!user.hideCountry ? { country: user.country } : {}),
    relationshipGoal: user.relationshipGoal,
    websiteUrl: user.websiteUrl,
    instagramHandle: user.instagramHandle,
    interests: user.interests.map(({ tag }) => tag.slug),
    isVerifiedBadge: user.isVerifiedBadge,
    isPrivateAccount: user.isPrivateAccount,
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

function mapPrivateProfile(user: UserProfileRecord, config: AppConfig): object {
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
  return {
    ...mapPublicProfile(user, relation, config),
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
  };
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
