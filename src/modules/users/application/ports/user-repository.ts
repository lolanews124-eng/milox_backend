import type {
  Gender,
  RelationshipGoal,
  UserRole,
  UserStatus,
} from "@prisma/client";

import type { PostAuthorViewRecord } from "../../../posts/application/post-view.js";

export interface UserProfileRecord {
  id: string;
  username: string;
  usernameNormalized: string;
  usernameChangedAt: Date | null;
  email: string;
  emailVerifiedAt: Date | null;
  dateOfBirth: Date;
  gender: Gender;
  role: UserRole;
  status: UserStatus;
  displayName: string | null;
  bio: string | null;
  countryCode: string | null;
  relationshipGoal: RelationshipGoal | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  isVerifiedBadge: boolean;
  isPrivateAccount: boolean;
  hideAge: boolean;
  hideCountry: boolean;
  hideLastSeen: boolean;
  hideOnline: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  lastSeenAt: Date | null;
  createdAt: Date;
  profilePhoto: { id: string } | null;
  coverPhoto: { id: string } | null;
  interests: Array<{ tag: { slug: string; label: string } }>;
  wallet: { balance: number } | null;
}

export interface ViewerRelation {
  isSelf: boolean;
  isFollowing: boolean;
  followRequested: boolean;
  isFollowedBy: boolean;
  isBlocked: boolean;
  hasPendingInterest: boolean;
  isMatched: boolean;
}

export interface UpdateProfileData {
  username?: string | undefined;
  usernameNormalized?: string | undefined;
  usernameChangedAt?: Date | undefined;
  displayName?: string | null | undefined;
  bio?: string | null | undefined;
  countryCode?: string | null | undefined;
  relationshipGoal?: RelationshipGoal | null | undefined;
  websiteUrl?: string | null | undefined;
  instagramHandle?: string | null | undefined;
  profilePhotoMediaId?: string | null | undefined;
  coverPhotoMediaId?: string | null | undefined;
  interestSlugs?: string[] | undefined;
}

export interface PrivacySettings {
  isPrivateAccount?: boolean | undefined;
  hideAge?: boolean | undefined;
  hideCountry?: boolean | undefined;
  hideLastSeen?: boolean | undefined;
  hideOnline?: boolean | undefined;
}

export interface UserSearchQuery {
  term: string;
  viewerId?: string;
  limit: number;
  before?: { followerCount: number; id: string };
}

export interface UserRepository {
  findById(userId: string): Promise<UserProfileRecord | null>;
  findByUsername(usernameNormalized: string): Promise<UserProfileRecord | null>;
  searchUsers(query: UserSearchQuery): Promise<PostAuthorViewRecord[]>;
  getViewerRelation(
    profileUserId: string,
    viewerUserId?: string,
  ): Promise<ViewerRelation>;
  updateProfile(
    userId: string,
    data: UpdateProfileData,
  ): Promise<UserProfileRecord>;
  updatePrivacy(
    userId: string,
    settings: PrivacySettings,
  ): Promise<UserProfileRecord>;
  softDelete(userId: string, now: Date): Promise<void>;
}

export class DuplicateUsernameError extends Error {}

export class InvalidProfileReferenceError extends Error {
  constructor(public readonly field: "interestSlugs" | "profilePhotoMediaId" | "coverPhotoMediaId") {
    super(`Invalid profile reference: ${field}`);
  }
}
