import {
  FollowStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  postViewSelect,
  visibleAuthorWhere,
} from "../../posts/infrastructure/post-query-policy.js";
import type {
  FeedPostRecord,
  FeedQuery,
  FeedRepository,
} from "../application/ports/feed-repository.js";
import type { FeedCursor } from "../application/services/feed-cursor.js";

export class PrismaFeedRepository implements FeedRepository {
  constructor(private readonly database: PrismaClient) {}

  getLatest(query: FeedQuery): Promise<FeedPostRecord[]> {
    const cursorWhere = chronologicalCursorWhere(query.cursor);
    return this.findPosts(query, {
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursorWhere ? { cursorWhere } : {}),
    });
  }

  getFollowing(
    query: FeedQuery & { viewerId: string },
  ): Promise<FeedPostRecord[]> {
    const cursorWhere = chronologicalCursorWhere(query.cursor);
    return this.findPosts(query, {
      additionalAuthorWhere: {
        followers: {
          some: {
            followerId: query.viewerId,
            status: FollowStatus.ACTIVE,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursorWhere ? { cursorWhere } : {}),
    });
  }

  getTrending(query: FeedQuery): Promise<FeedPostRecord[]> {
    const cursorWhere = rankedCursorWhere(query.cursor);
    return this.findPosts(query, {
      orderBy: [
        { trendingScore: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      ...(cursorWhere ? { cursorWhere } : {}),
    });
  }

  async getSuggested(
    query: FeedQuery & { viewerId: string },
  ): Promise<FeedPostRecord[]> {
    const tags = await this.database.userInterest.findMany({
      where: { userId: query.viewerId },
      select: { tagId: true },
    });
    const tagIds = tags.map(({ tagId }) => tagId);
    const cursorWhere = rankedCursorWhere(query.cursor);

    return this.findPosts(query, {
      additionalAuthorWhere: {
        id: { not: query.viewerId },
        isPrivateAccount: false,
        passedByProfiles: {
          none: { viewerId: query.viewerId },
        },
        followers: {
          none: {
            followerId: query.viewerId,
            status: FollowStatus.ACTIVE,
          },
        },
        ...(tagIds.length > 0
          ? {
              OR: [
                { interests: { some: { tagId: { in: tagIds } } } },
                {
                  createdAt: {
                    gte: new Date(Date.now() - 30 * 86_400_000),
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [
        { trendingScore: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      ...(cursorWhere ? { cursorWhere } : {}),
    });
  }

  async passProfile(viewerId: string, targetId: string): Promise<void> {
    await this.database.profilePass.upsert({
      where: { viewerId_targetId: { viewerId, targetId } },
      create: { viewerId, targetId },
      update: {},
    });
  }

  async getPassedProfileIds(viewerId: string): Promise<string[]> {
    const rows = await this.database.profilePass.findMany({
      where: { viewerId },
      select: { targetId: true },
    });
    return rows.map(({ targetId }) => targetId);
  }

  async userExists(userId: string): Promise<boolean> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return Boolean(user);
  }

  private findPosts(
    query: FeedQuery,
    options: {
      additionalAuthorWhere?: Prisma.UserWhereInput;
      orderBy: Prisma.PostOrderByWithRelationInput[];
      cursorWhere?: Prisma.PostWhereInput;
    },
  ): Promise<FeedPostRecord[]> {
    const authorVisibility = visibleAuthorWhere(query.viewerId);
    const authorWhere: Prisma.UserWhereInput = options.additionalAuthorWhere
      ? { AND: [authorVisibility, options.additionalAuthorWhere] }
      : authorVisibility;

    return this.database.post.findMany({
      where: {
        deletedAt: null,
        isHidden: false,
        author: { is: authorWhere },
        ...(options.cursorWhere ? { AND: [options.cursorWhere] } : {}),
      },
      orderBy: options.orderBy,
      take: query.limit + 1,
      select: postViewSelect(query.viewerId),
    });
  }
}

function chronologicalCursorWhere(
  cursor: FeedCursor | undefined,
): Prisma.PostWhereInput | undefined {
  if (!cursor || cursor.kind !== "chronological") return undefined;
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt, id: { lt: cursor.id } },
    ],
  };
}

function rankedCursorWhere(
  cursor: FeedCursor | undefined,
): Prisma.PostWhereInput | undefined {
  if (!cursor || cursor.kind !== "ranked") return undefined;
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { trendingScore: { lt: cursor.score } },
      { trendingScore: cursor.score, createdAt: { lt: createdAt } },
      {
        trendingScore: cursor.score,
        createdAt,
        id: { lt: cursor.id },
      },
    ],
  };
}

