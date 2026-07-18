import {
  FollowStatus,
  UserStatus,
  type Prisma,
} from "@prisma/client";

export function visibleAuthorWhere(
  viewerId?: string,
): Prisma.UserWhereInput {
  const visibleCard = visibleUserCardWhere(viewerId);
  if (!viewerId) return { ...visibleCard, isPrivateAccount: false };

  return {
    ...visibleCard,
    OR: [
      { id: viewerId },
      { isPrivateAccount: false },
      {
        followers: {
          some: { followerId: viewerId, status: FollowStatus.ACTIVE },
        },
      },
    ],
  };
}

export function visibleUserCardWhere(
  viewerId?: string,
): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = {
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };
  if (!viewerId) return base;
  return {
    ...base,
    blocksInitiated: { none: { blockedId: viewerId } },
    blocksReceived: { none: { blockerId: viewerId } },
  };
}

export function visiblePostWhere(
  postId: string,
  viewerId?: string,
): Prisma.PostWhereInput {
  return {
    id: postId,
    ...visiblePostContentWhere(viewerId),
  };
}

export function visiblePostContentWhere(
  viewerId?: string,
): Prisma.PostWhereInput {
  return {
    deletedAt: null,
    isHidden: false,
    author: { is: visibleAuthorWhere(viewerId) },
  };
}

export function postViewSelect(viewerId?: string) {
  return {
    id: true,
    body: true,
    likeCount: true,
    commentCount: true,
    shareCount: true,
    saveCount: true,
    trendingScore: true,
    createdAt: true,
    updatedAt: true,
    author: {
      select: {
        ...publicAuthorSelect(),
        // Lets the client render a Follow button with the correct state.
        followers: viewerId
          ? {
              where: { followerId: viewerId },
              select: { status: true },
              take: 1,
            }
          : { select: { status: true }, take: 0 },
      },
    },
    media: {
      where: { mediaAsset: { deletedAt: null } },
      orderBy: { sortOrder: "asc" as const },
      select: {
        sortOrder: true,
        mediaAsset: {
          select: {
            id: true,
            kind: true,
            mimeType: true,
            width: true,
            height: true,
            blurHash: true,
            createdAt: true,
          },
        },
      },
    },
    likes: viewerId
      ? {
          where: { userId: viewerId },
          select: { userId: true },
          take: 1,
        }
      : {
          select: { userId: true },
          take: 0,
        },
    saves: viewerId
      ? {
          where: { userId: viewerId },
          select: { userId: true },
          take: 1,
        }
      : {
          select: { userId: true },
          take: 0,
        },
  } satisfies Prisma.PostSelect;
}

export function publicAuthorSelect() {
  return {
    id: true,
    username: true,
    displayName: true,
    bio: true,
    dateOfBirth: true,
    gender: true,
    countryCode: true,
    relationshipGoal: true,
    websiteUrl: true,
    instagramHandle: true,
    isVerifiedBadge: true,
    isPrivateAccount: true,
    hideAge: true,
    hideCountry: true,
    hideOnline: true,
    lastSeenAt: true,
    followerCount: true,
    followingCount: true,
    postCount: true,
    createdAt: true,
    profilePhoto: { select: { id: true } },
    coverPhoto: { select: { id: true } },
    interests: {
      select: { tag: { select: { slug: true } } },
    },
  } satisfies Prisma.UserSelect;
}
