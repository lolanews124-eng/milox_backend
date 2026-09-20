import {
  FollowStatus,
  InterestStatus,
  MatchStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  postViewSelect,
  publicAuthorSelect,
  visibleAuthorWhere,
  visibleUserCardWhere,
} from "../../posts/infrastructure/post-query-policy.js";
import type { PostAuthorViewRecord } from "../../posts/application/post-view.js";
import type {
  DiscoverPeopleQuery,
  FeedPostRecord,
  FeedQuery,
  FeedRepository,
  RankedDiscoverPerson,
  RankedFeedPost,
} from "../application/ports/feed-repository.js";
import type { FeedCursor } from "../application/services/feed-cursor.js";
import {
  computeDiscoverPeopleScore,
  computeSuggestedFeedScore,
  discoverRankPoolSize,
  diversifyByAuthor,
  feedRankPoolSize,
  latestFeedCutoff,
  rankedAfterCursor,
  suggestedNewAuthorCutoff,
  trendingFreshCutoff,
} from "../application/services/feed-scoring.js";

export class PrismaFeedRepository implements FeedRepository {
  constructor(private readonly database: PrismaClient) {}

  getLatest(query: FeedQuery): Promise<FeedPostRecord[]> {
    const cursorWhere = chronologicalCursorWhere(query.cursor);
    return this.findPosts(query, {
      additionalPostWhere: {
        createdAt: { gte: latestFeedCutoff() },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursorWhere ? { cursorWhere } : {}),
    });
  }

  async getFollowing(
    query: FeedQuery & { viewerId: string },
  ): Promise<RankedFeedPost[]> {
    const poolLimit = feedRankPoolSize(query.limit);
    const rows = await this.findPosts(
      { ...query, limit: poolLimit },
      {
        additionalAuthorWhere: {
          followers: {
            some: {
              followerId: query.viewerId,
              status: FollowStatus.ACTIVE,
            },
          },
        },
        orderBy: [
          { trendingScore: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      },
    );

    const ranked = rows.map((post) => ({
      item: post,
      // Prefer hot posts, but keep recency visible when scores tie / are zero.
      score:
        post.trendingScore +
        Math.min(
          8,
          Math.max(
            0,
            8 -
              (Date.now() - post.createdAt.getTime()) /
                (1000 * 60 * 60 * 24 * 2),
          ),
        ),
      createdAt: post.createdAt,
      id: post.id,
    }));
    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const byTime = b.createdAt.getTime() - a.createdAt.getTime();
      if (byTime !== 0) return byTime;
      return b.id.localeCompare(a.id);
    });
    const afterCursor = rankedAfterCursor(
      ranked,
      query.cursor?.kind === "ranked" ? query.cursor : undefined,
    );
    const diversified = diversifyByAuthor(
      afterCursor,
      (entry) => entry.item.author.id,
      { limit: query.limit + 1 },
    );
    return diversified.map((entry) => ({
      post: entry.item,
      score: entry.score,
    }));
  }

  async getTrending(query: FeedQuery): Promise<RankedFeedPost[]> {
    const poolLimit = feedRankPoolSize(query.limit);
    const freshCutoff = trendingFreshCutoff();
    const rows = await this.findPosts(
      { ...query, limit: poolLimit },
      {
        additionalPostWhere: {
          OR: [
            { trendingScore: { gt: 0 } },
            { createdAt: { gte: freshCutoff } },
          ],
        },
        orderBy: [
          { trendingScore: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      },
    );

    const ranked = rows.map((post) => ({
      item: post,
      score: post.trendingScore,
      createdAt: post.createdAt,
      id: post.id,
    }));
    const afterCursor = rankedAfterCursor(
      ranked,
      query.cursor?.kind === "ranked" ? query.cursor : undefined,
    );
    const diversified = diversifyByAuthor(
      afterCursor,
      (entry) => entry.item.author.id,
      { limit: query.limit + 1 },
    );
    return diversified.map((entry) => ({
      post: entry.item,
      score: entry.score,
    }));
  }

  async getSuggested(
    query: FeedQuery & { viewerId: string },
  ): Promise<RankedFeedPost[]> {
    const poolLimit = feedRankPoolSize(query.limit);
    const viewerId = query.viewerId;

    const [viewer, viewerTagRows, likedAuthorRows] = await Promise.all([
      this.database.user.findUnique({
        where: { id: viewerId },
        select: { country: true },
      }),
      this.database.userInterest.findMany({
        where: { userId: viewerId, tag: { isActive: true } },
        select: { tagId: true, tag: { select: { slug: true } } },
      }),
      this.database.postLike.findMany({
        where: { userId: viewerId },
        orderBy: { createdAt: "desc" },
        take: 250,
        select: { post: { select: { authorId: true } } },
      }),
    ]);

    const viewerTagIds = viewerTagRows.map(({ tagId }) => tagId);
    const viewerInterestSlugs = new Set(
      viewerTagRows.map(({ tag }) => tag.slug.toLowerCase()),
    );
    const affinityAuthorIds = new Set(
      likedAuthorRows.map(({ post }) => post.authorId),
    );
    const newAuthorCutoff = suggestedNewAuthorCutoff();
    const viewerCountry = viewer?.country ?? null;

    const relevanceFilter =
      viewerTagIds.length > 0
        ? {
            OR: [
              {
                interests: {
                  some: {
                    tagId: { in: viewerTagIds },
                    tag: { isActive: true },
                  },
                },
              },
              { createdAt: { gte: newAuthorCutoff } },
              { followerCount: { gte: 25 } },
            ],
          }
        : {
            OR: [
              { createdAt: { gte: newAuthorCutoff } },
              { followerCount: { gte: 10 } },
            ],
          };

    const rows = await this.findPosts(
      { ...query, limit: poolLimit },
      {
        additionalAuthorWhere: {
          id: { not: viewerId },
          isPrivateAccount: false,
          passedByProfiles: {
            none: { viewerId },
          },
          followers: {
            none: {
              followerId: viewerId,
              status: FollowStatus.ACTIVE,
            },
          },
          AND: [relevanceFilter],
        },
        orderBy: [
          { trendingScore: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      },
    );

    if (rows.length === 0) return [];

    const postIds = rows.map((post) => post.id);
    const [seenRows, hashtagRows] = await Promise.all([
      this.database.postView.findMany({
        where: { viewerId, postId: { in: postIds } },
        select: { postId: true },
      }),
      this.database.postHashtag.findMany({
        where: { postId: { in: postIds } },
        select: {
          postId: true,
          hashtag: { select: { tag: true } },
        },
      }),
    ]);

    const seenPostIds = new Set(seenRows.map(({ postId }) => postId));
    const hashtagsByPost = new Map<string, string[]>();
    for (const row of hashtagRows) {
      const list = hashtagsByPost.get(row.postId) ?? [];
      list.push(row.hashtag.tag.toLowerCase());
      hashtagsByPost.set(row.postId, list);
    }

    const ranked = rows.map((post) => {
      const authorInterestSlugs = new Set(
        (post.author.interests ?? []).map((entry) =>
          entry.tag.slug.toLowerCase(),
        ),
      );
      const sharedInterestAuthor =
        viewerInterestSlugs.size > 0 &&
        [...viewerInterestSlugs].some((slug) => authorInterestSlugs.has(slug));
      const postTags = hashtagsByPost.get(post.id) ?? [];
      let hashtagInterestOverlap = 0;
      for (const tag of postTags) {
        if (viewerInterestSlugs.has(tag)) hashtagInterestOverlap += 1;
      }

      const score = computeSuggestedFeedScore({
        trendingScore: post.trendingScore,
        sameCountry: Boolean(
          viewerCountry && post.author.country === viewerCountry,
        ),
        sharedInterestAuthor,
        hashtagInterestOverlap,
        affinityAuthor: affinityAuthorIds.has(post.author.id),
        seenByViewer: seenPostIds.has(post.id),
        followerCount: post.author.followerCount ?? 0,
        createdAt: post.createdAt,
      });

      return {
        item: post,
        score,
        createdAt: post.createdAt,
        id: post.id,
      };
    });

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const byTime = b.createdAt.getTime() - a.createdAt.getTime();
      if (byTime !== 0) return byTime;
      return b.id.localeCompare(a.id);
    });

    const afterCursor = rankedAfterCursor(
      ranked,
      query.cursor?.kind === "ranked" ? query.cursor : undefined,
    );
    const diversified = diversifyByAuthor(
      afterCursor,
      (entry) => entry.item.author.id,
      { limit: query.limit + 1 },
    );

    return diversified.map((entry) => ({
      post: entry.item,
      score: entry.score,
    }));
  }

  async getDiscoverPeople(
    query: DiscoverPeopleQuery,
  ): Promise<RankedDiscoverPerson[]> {
    const poolLimit = discoverRankPoolSize(query.limit);
    const viewerId = query.viewerId;

    const [viewer, viewerTagRows] = await Promise.all([
      this.database.user.findUnique({
        where: { id: viewerId },
        select: { country: true },
      }),
      this.database.userInterest.findMany({
        where: { userId: viewerId, tag: { isActive: true } },
        select: { tag: { select: { slug: true } } },
      }),
    ]);

    const viewerInterestSlugs = new Set(
      viewerTagRows.map(({ tag }) => tag.slug.toLowerCase()),
    );
    const viewerCountry = viewer?.country ?? null;

    const rows = await this.database.user.findMany({
      where: {
        AND: [
          visibleUserCardWhere(viewerId),
          { id: { not: viewerId } },
          { isPrivateAccount: false },
          {
            passedByProfiles: {
              none: { viewerId },
            },
          },
          {
            interestsReceived: {
              none: {
                senderId: viewerId,
                status: {
                  in: [InterestStatus.PENDING, InterestStatus.ACCEPTED],
                },
              },
            },
          },
          {
            interestsSent: {
              none: {
                recipientId: viewerId,
                status: InterestStatus.PENDING,
              },
            },
          },
          {
            matchesAsUserA: {
              none: {
                userBId: viewerId,
                status: MatchStatus.ACTIVE,
              },
            },
          },
          {
            matchesAsUserB: {
              none: {
                userAId: viewerId,
                status: MatchStatus.ACTIVE,
              },
            },
          },
          ...(query.ageRanges?.length
            ? [{ ageRange: { in: query.ageRanges } }]
            : []),
          ...(query.genders?.length
            ? [{ gender: { in: query.genders } }]
            : []),
          ...(query.countries?.length
            ? [{ country: { in: query.countries } }]
            : []),
        ],
      },
      orderBy: [
        { discoverBoost: "desc" },
        { followerCount: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: poolLimit,
      select: {
        ...publicAuthorSelect(),
        discoverBoost: true,
        followers: {
          where: {
            followerId: viewerId,
            status: { in: [FollowStatus.ACTIVE, FollowStatus.PENDING] },
          },
          select: { status: true },
          take: 1,
        },
      },
    });

    const ranked = rows.map((row) => {
      const { discoverBoost, ...person } = row;
      const authorInterestSlugs = (person.interests ?? []).map((entry) =>
        entry.tag.slug.toLowerCase(),
      );
      let sharedInterestCount = 0;
      for (const slug of authorInterestSlugs) {
        if (viewerInterestSlugs.has(slug)) sharedInterestCount += 1;
      }

      const score = computeDiscoverPeopleScore({
        discoverBoost,
        sameCountry: Boolean(
          viewerCountry && person.country === viewerCountry,
        ),
        sharedInterestCount,
        followerCount: person.followerCount ?? 0,
        createdAt: person.createdAt,
      });

      return {
        item: person as PostAuthorViewRecord,
        score,
        createdAt: person.createdAt,
        id: person.id,
      };
    });

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const byTime = b.createdAt.getTime() - a.createdAt.getTime();
      if (byTime !== 0) return byTime;
      return b.id.localeCompare(a.id);
    });

    const afterCursor = rankedAfterCursor(
      ranked,
      query.cursor?.kind === "ranked" ? query.cursor : undefined,
    );

    return afterCursor.slice(0, query.limit + 1).map((entry) => ({
      person: entry.item,
      score: entry.score,
    }));
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
      additionalPostWhere?: Prisma.PostWhereInput;
      orderBy: Prisma.PostOrderByWithRelationInput[];
      cursorWhere?: Prisma.PostWhereInput;
    },
  ): Promise<FeedPostRecord[]> {
    const authorVisibility = visibleAuthorWhere(query.viewerId);
    const authorWhere: Prisma.UserWhereInput = options.additionalAuthorWhere
      ? { AND: [authorVisibility, options.additionalAuthorWhere] }
      : authorVisibility;

    const postFilters: Prisma.PostWhereInput[] = [
      {
        deletedAt: null,
        isHidden: false,
        author: { is: authorWhere },
      },
    ];
    if (options.additionalPostWhere) {
      postFilters.push(options.additionalPostWhere);
    }
    if (options.cursorWhere) {
      postFilters.push(options.cursorWhere);
    }

    return this.database.post.findMany({
      where: { AND: postFilters },
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
