import type { Gender, RelationshipGoal } from "@prisma/client";

import type { AppConfig } from "../../../config/env.js";
import { isUserOnline } from "../../chat/realtime/presence-registry.js";
import { calculateAge } from "../../users/application/services/user-service.js";

export interface PostAuthorViewRecord {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  dateOfBirth: Date;
  gender: Gender;
  countryCode: string | null;
  relationshipGoal: RelationshipGoal | null;
  websiteUrl: string | null;
  instagramHandle: string | null;
  isVerifiedBadge: boolean;
  isPrivateAccount: boolean;
  hideAge: boolean;
  hideCountry: boolean;
  hideOnline?: boolean;
  lastSeenAt?: Date | null;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  profilePhoto: { id: string } | null;
  coverPhoto: { id: string } | null;
  interests: Array<{ tag: { slug: string } }>;
  /** Present only on feed/post queries; the viewer's follow row if any. */
  followers?: Array<{ status: string }>;
}

export interface PostViewRecord {
  id: string;
  body: string | null;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount: number;
  trendingScore: number;
  createdAt: Date;
  updatedAt: Date;
  author: PostAuthorViewRecord;
  media: Array<{
    sortOrder: number;
    mediaAsset: {
      id: string;
      kind: string;
      mimeType: string;
      width: number | null;
      height: number | null;
      blurHash: string | null;
      createdAt: Date;
    };
  }>;
  likes: Array<{ userId: string }>;
  saves: Array<{ userId: string }>;
}

export function presentPost(post: PostViewRecord, config: AppConfig): object {
  const author = post.author;
  return {
    id: post.id,
    author: presentPublicAuthor(author, config),
    body: post.body,
    media: post.media.map(({ mediaAsset }) => ({
      id: mediaAsset.id,
      kind: mediaAsset.kind,
      url: mediaUrl(mediaAsset.id, config),
      mimeType: mediaAsset.mimeType,
      width: mediaAsset.width,
      height: mediaAsset.height,
      blurHash: mediaAsset.blurHash,
      createdAt: mediaAsset.createdAt.toISOString(),
    })),
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    shareCount: post.shareCount,
    saveCount: post.saveCount,
    viewerLiked: post.likes.length > 0,
    viewerSaved: post.saves.length > 0,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function presentPublicAuthor(
  author: PostAuthorViewRecord,
  config: AppConfig,
): object {
  return {
    id: author.id,
    username: author.username,
    displayName: author.displayName,
    bio: author.bio,
    profilePhotoUrl: mediaUrl(author.profilePhoto?.id, config),
    coverPhotoUrl: mediaUrl(author.coverPhoto?.id, config),
    gender: author.gender,
    ...(!author.hideAge ? { age: calculateAge(author.dateOfBirth) } : {}),
    ...(!author.hideCountry ? { countryCode: author.countryCode } : {}),
    relationshipGoal: author.relationshipGoal,
    websiteUrl: author.websiteUrl,
    instagramHandle: author.instagramHandle,
    interests: author.interests.map(({ tag }) => tag.slug),
    isVerifiedBadge: author.isVerifiedBadge,
    isPrivateAccount: author.isPrivateAccount,
    ...(!author.hideOnline ? { online: isUserOnline(author.id) } : {}),
    ...(author.followers
      ? { viewerFollowState: followState(author.followers[0]?.status) }
      : {}),
    followerCount: author.followerCount,
    followingCount: author.followingCount,
    postCount: author.postCount,
    createdAt: author.createdAt.toISOString(),
  };
}

function followState(
  status: string | undefined,
): "none" | "following" | "requested" {
  if (status === "ACTIVE") return "following";
  if (status === "PENDING") return "requested";
  return "none";
}

function mediaUrl(mediaId: string | undefined, config: AppConfig): string | null {
  if (!mediaId) return null;
  return `${config.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/media/${mediaId}`;
}
