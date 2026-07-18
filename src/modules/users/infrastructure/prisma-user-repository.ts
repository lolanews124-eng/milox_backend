import {
  ConversationStatus,
  InterestStatus,
  MatchStatus,
  MediaKind,
  Prisma,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";

import {
  DuplicateUsernameError,
  InvalidProfileReferenceError,
} from "../application/ports/user-repository.js";
import type {
  PrivacySettings,
  UpdateProfileData,
  UserProfileRecord,
  UserRepository,
  UserSearchQuery,
  ViewerRelation,
} from "../application/ports/user-repository.js";
import type { PostAuthorViewRecord } from "../../posts/application/post-view.js";
import {
  publicAuthorSelect,
  visibleUserCardWhere,
} from "../../posts/infrastructure/post-query-policy.js";

const profileSelect = {
  id: true,
  username: true,
  usernameNormalized: true,
  usernameChangedAt: true,
  email: true,
  emailVerifiedAt: true,
  dateOfBirth: true,
  gender: true,
  role: true,
  status: true,
  displayName: true,
  bio: true,
  countryCode: true,
  relationshipGoal: true,
  websiteUrl: true,
  instagramHandle: true,
  isVerifiedBadge: true,
  isPrivateAccount: true,
  hideAge: true,
  hideCountry: true,
  hideLastSeen: true,
  hideOnline: true,
  followerCount: true,
  followingCount: true,
  postCount: true,
  lastSeenAt: true,
  createdAt: true,
  profilePhoto: { select: { id: true } },
  coverPhoto: { select: { id: true } },
  interests: {
    select: { tag: { select: { slug: true, label: true } } },
    orderBy: { tag: { label: "asc" } },
  },
} satisfies Prisma.UserSelect;

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly database: PrismaClient) {}

  findById(userId: string): Promise<UserProfileRecord | null> {
    return this.database.user.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
  }

  findByUsername(
    usernameNormalized: string,
  ): Promise<UserProfileRecord | null> {
    return this.database.user.findFirst({
      where: {
        usernameNormalized,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: profileSelect,
    });
  }

  async searchUsers(
    query: UserSearchQuery,
  ): Promise<PostAuthorViewRecord[]> {
    const term = query.term.trim();
    const normalized = term.toLowerCase();
    const rows = await this.database.user.findMany({
      where: {
        AND: [
          visibleUserCardWhere(query.viewerId),
          ...(query.viewerId ? [{ id: { not: query.viewerId } }] : []),
          {
            OR: [
              { usernameNormalized: { contains: normalized } },
              {
                displayName: {
                  contains: term,
                  mode: "insensitive",
                },
              },
            ],
          },
          ...(query.before
            ? [
                {
                  OR: [
                    { followerCount: { lt: query.before.followerCount } },
                    {
                      followerCount: query.before.followerCount,
                      id: { lt: query.before.id },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ followerCount: "desc" }, { id: "desc" }],
      take: query.limit,
      select: {
        ...publicAuthorSelect(),
        ...(query.viewerId
          ? {
              followers: {
                where: {
                  followerId: query.viewerId,
                  status: { in: ["ACTIVE", "PENDING"] },
                },
                select: { status: true },
                take: 1,
              },
            }
          : {}),
      },
    });
    return rows as PostAuthorViewRecord[];
  }

  async getViewerRelation(
    profileUserId: string,
    viewerUserId?: string,
  ): Promise<ViewerRelation> {
    if (!viewerUserId) return emptyRelation(false);
    if (viewerUserId === profileUserId) return emptyRelation(true);

    const [following, followedBy, block, pendingInterest, match] =
      await this.database.$transaction([
        this.database.follow.findUnique({
          where: {
            followerId_followeeId: {
              followerId: viewerUserId,
              followeeId: profileUserId,
            },
          },
          select: { status: true },
        }),
        this.database.follow.findUnique({
          where: {
            followerId_followeeId: {
              followerId: profileUserId,
              followeeId: viewerUserId,
            },
          },
          select: { status: true },
        }),
        this.database.block.findFirst({
          where: {
            OR: [
              { blockerId: viewerUserId, blockedId: profileUserId },
              { blockerId: profileUserId, blockedId: viewerUserId },
            ],
          },
          select: { id: true },
        }),
        this.database.interest.findFirst({
          where: {
            senderId: viewerUserId,
            recipientId: profileUserId,
            status: InterestStatus.PENDING,
          },
          select: { id: true },
        }),
        this.database.match.findFirst({
          where: {
            status: MatchStatus.ACTIVE,
            OR: [
              { userAId: viewerUserId, userBId: profileUserId },
              { userAId: profileUserId, userBId: viewerUserId },
            ],
          },
          select: { id: true },
        }),
      ]);

    return {
      isSelf: false,
      isFollowing: following?.status === "ACTIVE",
      followRequested: following?.status === "PENDING",
      isFollowedBy: followedBy?.status === "ACTIVE",
      isBlocked: Boolean(block),
      hasPendingInterest: Boolean(pendingInterest),
      isMatched: Boolean(match),
    };
  }

  async updateProfile(
    userId: string,
    data: UpdateProfileData,
  ): Promise<UserProfileRecord> {
    try {
      return await this.database.$transaction(async (transaction) => {
        if (
          data.username !== undefined &&
          (data.usernameNormalized === undefined ||
            data.usernameChangedAt === undefined)
        ) {
          throw new Error("Normalized username metadata is required");
        }
        if (data.interestSlugs) {
          const count = await transaction.interestTag.count({
            where: { slug: { in: data.interestSlugs }, isActive: true },
          });
          if (count !== data.interestSlugs.length) {
            throw new InvalidProfileReferenceError("interestSlugs");
          }
        }

        await validateMedia(
          transaction,
          userId,
          data.profilePhotoMediaId,
          MediaKind.PROFILE_PHOTO,
          "profilePhotoMediaId",
        );
        await validateMedia(
          transaction,
          userId,
          data.coverPhotoMediaId,
          MediaKind.COVER_PHOTO,
          "coverPhotoMediaId",
        );

        return transaction.user.update({
          where: { id: userId },
          data: {
            ...(data.username !== undefined &&
            data.usernameNormalized !== undefined &&
            data.usernameChangedAt !== undefined
              ? {
                  username: data.username,
                  usernameNormalized: data.usernameNormalized,
                  usernameChangedAt: data.usernameChangedAt,
                }
              : {}),
            ...(data.displayName !== undefined
              ? { displayName: data.displayName }
              : {}),
            ...(data.bio !== undefined ? { bio: data.bio } : {}),
            ...(data.countryCode !== undefined
              ? { countryCode: data.countryCode }
              : {}),
            ...(data.relationshipGoal !== undefined
              ? { relationshipGoal: data.relationshipGoal }
              : {}),
            ...(data.websiteUrl !== undefined
              ? { websiteUrl: data.websiteUrl }
              : {}),
            ...(data.instagramHandle !== undefined
              ? { instagramHandle: data.instagramHandle }
              : {}),
            ...(data.profilePhotoMediaId !== undefined
              ? {
                  profilePhoto:
                    data.profilePhotoMediaId === null
                      ? { disconnect: true }
                      : { connect: { id: data.profilePhotoMediaId } },
                }
              : {}),
            ...(data.coverPhotoMediaId !== undefined
              ? {
                  coverPhoto:
                    data.coverPhotoMediaId === null
                      ? { disconnect: true }
                      : { connect: { id: data.coverPhotoMediaId } },
                }
              : {}),
            ...(data.interestSlugs !== undefined
              ? {
                  interests: {
                    deleteMany: {},
                    create: data.interestSlugs.map((slug) => ({
                      tag: { connect: { slug } },
                    })),
                  },
                }
              : {}),
          },
          select: profileSelect,
        });
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new DuplicateUsernameError();
      }
      throw error;
    }
  }

  updatePrivacy(
    userId: string,
    settings: PrivacySettings,
  ): Promise<UserProfileRecord> {
    return this.database.user.update({
      where: { id: userId },
      data: {
        ...(settings.isPrivateAccount !== undefined
          ? { isPrivateAccount: settings.isPrivateAccount }
          : {}),
        ...(settings.hideAge !== undefined
          ? { hideAge: settings.hideAge }
          : {}),
        ...(settings.hideCountry !== undefined
          ? { hideCountry: settings.hideCountry }
          : {}),
        ...(settings.hideLastSeen !== undefined
          ? { hideLastSeen: settings.hideLastSeen }
          : {}),
        ...(settings.hideOnline !== undefined
          ? { hideOnline: settings.hideOnline }
          : {}),
      },
      select: profileSelect,
    });
  }

  async softDelete(userId: string, now: Date): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: userId },
        data: {
          status: UserStatus.PENDING_DELETION,
          deletedAt: now,
          displayName: null,
          bio: null,
          countryCode: null,
          relationshipGoal: null,
          websiteUrl: null,
          instagramHandle: null,
          profilePhoto: { disconnect: true },
          coverPhoto: { disconnect: true },
          interests: { deleteMany: {} },
        },
      });
      await transaction.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.post.updateMany({
        where: { authorId: userId, deletedAt: null },
        data: { isHidden: true },
      });
      await transaction.comment.updateMany({
        where: { authorId: userId, deletedAt: null },
        data: { isHidden: true },
      });
      await transaction.interest.updateMany({
        where: {
          status: InterestStatus.PENDING,
          OR: [{ senderId: userId }, { recipientId: userId }],
        },
        data: { status: InterestStatus.CANCELLED, respondedAt: now },
      });
      await transaction.match.updateMany({
        where: {
          status: MatchStatus.ACTIVE,
          OR: [{ userAId: userId }, { userBId: userId }],
        },
        data: { status: MatchStatus.UNMATCHED, unmatchedAt: now },
      });
      await transaction.conversation.updateMany({
        where: { members: { some: { userId } } },
        data: { status: ConversationStatus.CLOSED },
      });
      await transaction.mediaAsset.updateMany({
        where: { ownerUserId: userId, deletedAt: null },
        data: { deletedAt: now },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: "UserDeletionRequested",
          aggregateType: "User",
          aggregateId: userId,
          payload: { userId },
        },
      });
    });
  }
}

function emptyRelation(isSelf: boolean): ViewerRelation {
  return {
    isSelf,
    isFollowing: false,
    followRequested: false,
    isFollowedBy: false,
    isBlocked: false,
    hasPendingInterest: false,
    isMatched: false,
  };
}

async function validateMedia(
  transaction: Prisma.TransactionClient,
  userId: string,
  mediaId: string | null | undefined,
  kind: MediaKind,
  field: "profilePhotoMediaId" | "coverPhotoMediaId",
): Promise<void> {
  if (mediaId === undefined || mediaId === null) return;
  const media = await transaction.mediaAsset.findFirst({
    where: { id: mediaId, ownerUserId: userId, kind, deletedAt: null },
    select: { id: true },
  });
  if (!media) throw new InvalidProfileReferenceError(field);
}
