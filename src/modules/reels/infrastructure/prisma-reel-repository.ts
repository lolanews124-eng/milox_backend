import {
  FollowStatus,
  MediaKind,
  OutboxStatus,
  ReelReviewStatus,
  UserStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { AppError } from "../../../shared/errors/app-error.js";
import { extractHashtags } from "../../../shared/hashtags.js";
import { extractMentions } from "../../../shared/mentions.js";
import {
  visibleAuthorWhere,
  visibleUserCardWhere,
} from "../../posts/infrastructure/post-query-policy.js";
import { REELS_PER_DAY } from "../application/reel-day.js";
import type {
  ReelCommentRecord,
  ReelPageCursor,
  ReelRecord,
  ReelRepository,
} from "../application/ports/reel-repository.js";

const authorSelect = {
  id: true,
  username: true,
  displayName: true,
  isVerifiedBadge: true,
  premiumTier: true,
  profilePhoto: { select: { id: true } },
} as const;

export class PrismaReelRepository implements ReelRepository {
  constructor(private readonly database: PrismaClient) {}

  countSince(authorId: string, since: Date): Promise<number> {
    return this.database.reel.count({
      where: { authorId, createdAt: { gte: since } },
    });
  }

  async reelsEnabled(): Promise<boolean> {
    const config = await this.database.mobileAppConfig.findUnique({
      where: { id: "default" },
      select: { reelsEnabled: true },
    });
    return config?.reelsEnabled ?? true;
  }

  async createWithinDailyLimit(input: {
    authorId: string;
    mediaAssetId: string;
    posterMediaId: string | null;
    caption: string | null;
    durationMs: number;
    dayStart: Date;
  }): Promise<ReelRecord> {
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reel:${input.authorId}`}))`;
      const used = await tx.reel.count({
        where: { authorId: input.authorId, createdAt: { gte: input.dayStart } },
      });
      if (used >= REELS_PER_DAY) {
        throw new AppError(
          "LIMIT_REACHED",
          "You can post 2 reels a day. Try again tomorrow.",
          429,
        );
      }
      const reel = await tx.reel.create({
        data: {
          authorId: input.authorId,
          mediaAssetId: input.mediaAssetId,
          posterMediaId: input.posterMediaId,
          caption: input.caption,
          durationMs: input.durationMs,
          status: ReelReviewStatus.PENDING,
        },
        select: reelSelect(input.authorId),
      });
      await syncReelHashtags(tx, reel.id, input.caption);
      return reel;
    });
  }

  list(input: {
    viewerId: string;
    limit: number;
    cursor?: ReelPageCursor | undefined;
    friendsOnly?: boolean | undefined;
  }): Promise<ReelRecord[]> {
    const cursorWhere: Prisma.ReelWhereInput | undefined = input.cursor
      ? {
          OR: [
            { createdAt: { lt: input.cursor.createdAt } },
            {
              AND: [
                { createdAt: input.cursor.createdAt },
                { id: { lt: input.cursor.id } },
              ],
            },
          ],
        }
      : undefined;
    const author: Prisma.UserWhereInput = input.friendsOnly
      ? {
          AND: [
            visibleAuthorWhere(input.viewerId),
            {
              followers: {
                some: {
                  followerId: input.viewerId,
                  status: FollowStatus.ACTIVE,
                },
              },
            },
          ],
        }
      : visibleAuthorWhere(input.viewerId);
    return this.database.reel.findMany({
      where: {
        deletedAt: null,
        status: ReelReviewStatus.APPROVED,
        author: { is: author },
        ...cursorWhere,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
      select: reelSelect(input.viewerId),
    });
  }

  async toggleLike(
    reelId: string,
    userId: string,
  ): Promise<{ likedByMe: boolean; likeCount: number } | null> {
    return this.database.$transaction(async (tx) => {
      const reel = await tx.reel.findFirst({
        where: {
          id: reelId,
          deletedAt: null,
          status: ReelReviewStatus.APPROVED,
          author: { is: visibleAuthorWhere(userId) },
        },
        select: { id: true, authorId: true, likeCount: true },
      });
      if (!reel) return null;
      const existing = await tx.reelLike.findUnique({
        where: { reelId_userId: { reelId, userId } },
        select: { reelId: true },
      });
      if (existing) {
        await tx.reelLike.delete({
          where: { reelId_userId: { reelId, userId } },
        });
        const updated = await tx.reel.update({
          where: { id: reelId },
          data: { likeCount: { decrement: 1 } },
          select: { likeCount: true },
        });
        return {
          likedByMe: false,
          likeCount: Math.max(0, updated.likeCount),
        };
      }
      await tx.reelLike.create({ data: { reelId, userId } });
      const updated = await tx.reel.update({
        where: { id: reelId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
      if (reel.authorId !== userId) {
        await tx.outboxEvent.create({
          data: {
            eventType: "reel.liked",
            aggregateType: "reel",
            aggregateId: reelId,
            payload: { reelId, actorId: userId, recipientId: reel.authorId },
            status: OutboxStatus.PENDING,
          },
        });
      }
      return { likedByMe: true, likeCount: updated.likeCount };
    });
  }

  async toggleSave(
    reelId: string,
    userId: string,
  ): Promise<{ savedByMe: boolean } | null> {
    return this.database.$transaction(async (tx) => {
      const reel = await tx.reel.findFirst({
        where: {
          id: reelId,
          deletedAt: null,
          status: ReelReviewStatus.APPROVED,
          author: { is: visibleAuthorWhere(userId) },
        },
        select: { id: true },
      });
      if (!reel) return null;
      const existing = await tx.reelSave.findUnique({
        where: { reelId_userId: { reelId, userId } },
        select: { reelId: true },
      });
      if (existing) {
        await tx.reelSave.delete({
          where: { reelId_userId: { reelId, userId } },
        });
        return { savedByMe: false };
      }
      await tx.reelSave.create({ data: { reelId, userId } });
      return { savedByMe: true };
    });
  }

  async share(
    reelId: string,
    userId: string,
  ): Promise<{ shareCount: number } | null> {
    return this.database.$transaction(async (tx) => {
      const reel = await tx.reel.findFirst({
        where: approvedReelWhere(reelId, userId),
        select: { id: true, authorId: true },
      });
      if (!reel) return null;
      await tx.reelShare.create({ data: { reelId, userId } });
      const updated = await tx.reel.update({
        where: { id: reelId },
        data: { shareCount: { increment: 1 } },
        select: { shareCount: true },
      });
      if (reel.authorId !== userId) {
        await tx.outboxEvent.create({
          data: {
            eventType: "reel.shared",
            aggregateType: "reel",
            aggregateId: reelId,
            payload: { reelId, actorId: userId, recipientId: reel.authorId },
            status: OutboxStatus.PENDING,
          },
        });
      }
      return { shareCount: updated.shareCount };
    });
  }

  findVisible(reelId: string, viewerId: string): Promise<ReelRecord | null> {
    return this.database.reel.findFirst({
      where: {
        id: reelId,
        deletedAt: null,
        author: { is: visibleAuthorWhere(viewerId) },
        OR: [
          { status: ReelReviewStatus.APPROVED },
          { authorId: viewerId },
        ],
      },
      select: reelSelect(viewerId),
    });
  }

  listByHashtag(input: {
    tag: string;
    viewerId: string;
    limit: number;
    cursor?: ReelPageCursor | undefined;
  }): Promise<ReelRecord[]> {
    return this.database.reel.findMany({
      where: {
        deletedAt: null,
        status: ReelReviewStatus.APPROVED,
        author: { is: visibleAuthorWhere(input.viewerId) },
        hashtags: { some: { hashtag: { tag: input.tag } } },
        ...reelCursorWhere(input.cursor),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
      select: reelSelect(input.viewerId),
    });
  }

  listComments(input: {
    reelId: string;
    viewerId: string;
    limit: number;
    cursor?: ReelPageCursor | undefined;
  }): Promise<ReelCommentRecord[] | null> {
    return this.database.$transaction(async (tx) => {
      const reel = await tx.reel.findFirst({
        where: approvedReelWhere(input.reelId, input.viewerId),
        select: { id: true },
      });
      if (!reel) return null;
      return tx.reelComment.findMany({
        where: {
          reelId: input.reelId,
          depth: 0,
          parentId: null,
          deletedAt: null,
          author: { is: visibleUserCardWhere(input.viewerId) },
          ...commentCursorWhere(input.cursor),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit,
        select: commentSelect(input.viewerId),
      });
    });
  }

  listReplies(input: {
    commentId: string;
    viewerId: string;
    limit: number;
    cursor?: ReelPageCursor | undefined;
  }): Promise<ReelCommentRecord[] | null> {
    return this.database.$transaction(async (tx) => {
      const parent = await tx.reelComment.findFirst({
        where: {
          id: input.commentId,
          depth: 0,
          deletedAt: null,
          reel: {
            deletedAt: null,
            status: ReelReviewStatus.APPROVED,
            author: { is: visibleAuthorWhere(input.viewerId) },
          },
        },
        select: { id: true },
      });
      if (!parent) return null;
      return tx.reelComment.findMany({
        where: {
          parentId: parent.id,
          depth: 1,
          deletedAt: null,
          author: { is: visibleUserCardWhere(input.viewerId) },
          ...commentCursorWhere(input.cursor),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit,
        select: commentSelect(input.viewerId),
      });
    });
  }

  async addComment(input: {
    reelId: string;
    authorId: string;
    body: string;
    parentId?: string | undefined;
  }): Promise<ReelCommentRecord | null> {
    return this.database.$transaction(async (tx) => {
      const reel = await tx.reel.findFirst({
        where: approvedReelWhere(input.reelId, input.authorId),
        select: { id: true, authorId: true },
      });
      if (!reel) return null;
      let parent: { id: string; authorId: string } | null = null;
      if (input.parentId) {
        parent = await tx.reelComment.findFirst({
          where: {
            id: input.parentId,
            reelId: input.reelId,
            depth: 0,
            deletedAt: null,
            author: { is: visibleUserCardWhere(input.authorId) },
          },
          select: { id: true, authorId: true },
        });
        if (!parent) return null;
      }
      const created = await tx.reelComment.create({
        data: {
          reelId: input.reelId,
          authorId: input.authorId,
          body: input.body,
          depth: parent ? 1 : 0,
          ...(parent ? { parentId: parent.id } : {}),
        },
        select: { id: true },
      });
      await tx.reel.update({
        where: { id: input.reelId },
        data: { commentCount: { increment: 1 } },
      });
      if (parent) {
        await tx.reelComment.update({
          where: { id: parent.id },
          data: { replyCount: { increment: 1 } },
        });
      }
      const replyRecipient =
        parent && parent.authorId !== input.authorId ? parent.authorId : null;
      const reelRecipient =
        !replyRecipient && reel.authorId !== input.authorId
          ? reel.authorId
          : null;
      const recipientId = replyRecipient ?? reelRecipient;
      if (recipientId) {
        await tx.outboxEvent.create({
          data: {
            eventType: replyRecipient ? "reel.comment.replied" : "reel.commented",
            aggregateType: "reel_comment",
            aggregateId: created.id,
            payload: {
              reelId: input.reelId,
              commentId: created.id,
              actorId: input.authorId,
              recipientId,
              ...(parent ? { parentId: parent.id } : {}),
            },
            status: OutboxStatus.PENDING,
          },
        });
      }
      await enqueueReelCommentMentions(tx, {
        reelId: input.reelId,
        commentId: created.id,
        authorId: input.authorId,
        body: input.body,
        skipUserIds: recipientId ? [recipientId] : [],
      });
      return tx.reelComment.findUniqueOrThrow({
        where: { id: created.id },
        select: commentSelect(input.authorId),
      });
    });
  }

  deleteComment(
    reelId: string,
    commentId: string,
    actorId: string,
  ): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      const comment = await tx.reelComment.findFirst({
        where: {
          id: commentId,
          reelId,
          deletedAt: null,
          reel: {
            deletedAt: null,
            status: ReelReviewStatus.APPROVED,
            author: { is: visibleAuthorWhere(actorId) },
          },
        },
        select: {
          id: true,
          authorId: true,
          parentId: true,
          depth: true,
          reel: { select: { authorId: true } },
        },
      });
      if (
        !comment ||
        (comment.authorId !== actorId && comment.reel.authorId !== actorId)
      ) {
        return false;
      }
      const deletedAt = new Date();
      const deleted =
        comment.depth === 0
          ? await tx.reelComment.updateMany({
              where: {
                OR: [{ id: comment.id }, { parentId: comment.id }],
                deletedAt: null,
              },
              data: { deletedAt },
            })
          : await tx.reelComment.updateMany({
              where: { id: comment.id, deletedAt: null },
              data: { deletedAt },
            });
      await tx.reel.updateMany({
        where: { id: reelId, commentCount: { gte: deleted.count } },
        data: { commentCount: { decrement: deleted.count } },
      });
      if (comment.parentId) {
        await tx.reelComment.updateMany({
          where: { id: comment.parentId, replyCount: { gt: 0 }, deletedAt: null },
          data: { replyCount: { decrement: 1 } },
        });
      }
      return true;
    });
  }

  async toggleCommentLike(
    reelId: string,
    commentId: string,
    userId: string,
  ): Promise<{ likedByMe: boolean; likeCount: number } | null> {
    return this.database.$transaction(async (tx) => {
      const comment = await tx.reelComment.findFirst({
        where: {
          id: commentId,
          reelId,
          deletedAt: null,
          reel: {
            deletedAt: null,
            status: ReelReviewStatus.APPROVED,
            author: { is: visibleAuthorWhere(userId) },
          },
          author: { is: visibleUserCardWhere(userId) },
        },
        select: { id: true, authorId: true, likeCount: true },
      });
      if (!comment) return null;
      const existing = await tx.reelCommentLike.findUnique({
        where: { commentId_userId: { commentId, userId } },
        select: { commentId: true },
      });
      if (existing) {
        await tx.reelCommentLike.delete({
          where: { commentId_userId: { commentId, userId } },
        });
        const updated = await tx.reelComment.update({
          where: { id: commentId },
          data: { likeCount: { decrement: 1 } },
          select: { likeCount: true },
        });
        return { likedByMe: false, likeCount: Math.max(0, updated.likeCount) };
      }
      await tx.reelCommentLike.create({ data: { commentId, userId } });
      const updated = await tx.reelComment.update({
        where: { id: commentId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
      if (comment.authorId !== userId) {
        await tx.outboxEvent.create({
          data: {
            eventType: "reel.comment.liked",
            aggregateType: "reel_comment",
            aggregateId: commentId,
            payload: {
              reelId,
              commentId,
              actorId: userId,
              recipientId: comment.authorId,
            },
            status: OutboxStatus.PENDING,
          },
        });
      }
      return { likedByMe: true, likeCount: updated.likeCount };
    });
  }

  ownsPoster(authorId: string, mediaId: string): Promise<boolean> {
    return this.database.mediaAsset
      .findFirst({
        where: {
          id: mediaId,
          ownerUserId: authorId,
          deletedAt: null,
          visibility: "PUBLIC",
          kind: {
            in: [
              MediaKind.POST_IMAGE,
              MediaKind.STORY_IMAGE,
              MediaKind.PROFILE_PHOTO,
            ],
          },
        },
        select: { id: true },
      })
      .then((row) => row != null);
  }

  async listByUsername(input: {
    username: string;
    viewerId: string;
    limit: number;
    cursor?: ReelPageCursor | undefined;
  }): Promise<ReelRecord[] | null> {
    const author = await this.database.user.findFirst({
      where: {
        username: { equals: input.username, mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!author) return null;
    const cursorWhere: Prisma.ReelWhereInput | undefined = input.cursor
      ? {
          OR: [
            { createdAt: { lt: input.cursor.createdAt } },
            {
              AND: [
                { createdAt: input.cursor.createdAt },
                { id: { lt: input.cursor.id } },
              ],
            },
          ],
        }
      : undefined;
    const ownProfile = author.id === input.viewerId;
    return this.database.reel.findMany({
      where: {
        deletedAt: null,
        authorId: author.id,
        status: ownProfile
          ? {
              in: [
                ReelReviewStatus.PENDING,
                ReelReviewStatus.APPROVED,
                ReelReviewStatus.REJECTED,
              ],
            }
          : ReelReviewStatus.APPROVED,
        author: { is: visibleAuthorWhere(input.viewerId) },
        ...cursorWhere,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
      select: reelSelect(input.viewerId),
    });
  }

  async recordView(
    reelId: string,
    viewerId: string,
  ): Promise<{ viewCount: number } | null> {
    return this.database.$transaction(async (tx) => {
      const reel = await tx.reel.findFirst({
        where: {
          id: reelId,
          deletedAt: null,
          status: ReelReviewStatus.APPROVED,
          author: { is: visibleAuthorWhere(viewerId) },
        },
        select: { id: true, authorId: true, viewCount: true },
      });
      if (!reel) return null;
      if (reel.authorId === viewerId) return { viewCount: reel.viewCount };

      const created = await tx.reelView.createMany({
        data: [{ reelId, viewerId }],
        skipDuplicates: true,
      });
      if (created.count === 0) return { viewCount: reel.viewCount };

      const updated = await tx.reel.update({
        where: { id: reelId },
        data: { viewCount: { increment: 1 } },
        select: { viewCount: true },
      });
      return { viewCount: updated.viewCount };
    });
  }

  async softDelete(reelId: string, authorId: string): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      const result = await tx.reel.updateMany({
        where: { id: reelId, authorId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) return false;
      const links = await tx.reelHashtag.findMany({
        where: { reelId },
        select: { hashtagId: true },
      });
      if (links.length > 0) {
        await tx.hashtag.updateMany({
          where: {
            id: { in: links.map((link) => link.hashtagId) },
            reelCount: { gt: 0 },
          },
          data: { reelCount: { decrement: 1 } },
        });
      }
      return true;
    });
  }
}

function reelSelect(viewerId: string) {
  return {
    id: true,
    authorId: true,
    mediaAssetId: true,
    posterMediaId: true,
    caption: true,
    durationMs: true,
    likeCount: true,
    commentCount: true,
    shareCount: true,
    viewCount: true,
    status: true,
    rejectReason: true,
    createdAt: true,
    author: { select: reelAuthorSelect(viewerId) },
    likes: {
      where: { userId: viewerId },
      select: { userId: true },
      take: 1,
    },
    saves: {
      where: { userId: viewerId },
      select: { userId: true },
      take: 1,
    },
  } satisfies Prisma.ReelSelect;
}

function reelAuthorSelect(viewerId: string) {
  return {
    ...authorSelect,
    followers: {
      where: { followerId: viewerId },
      select: { status: true },
      take: 1,
    },
  };
}

async function syncReelHashtags(
  tx: Prisma.TransactionClient,
  reelId: string,
  caption: string | null,
): Promise<void> {
  const tags = extractHashtags(caption);
  for (const tag of tags) {
    const hashtag = await tx.hashtag.upsert({
      where: { tag },
      create: { tag, postCount: 0, reelCount: 1 },
      update: { reelCount: { increment: 1 }, lastUsedAt: new Date() },
      select: { id: true },
    });
    await tx.reelHashtag.create({
      data: { reelId, hashtagId: hashtag.id },
    });
  }
}

async function enqueueReelCommentMentions(
  tx: Prisma.TransactionClient,
  input: {
    reelId: string;
    commentId: string;
    authorId: string;
    body: string;
    skipUserIds: string[];
  },
): Promise<void> {
  const usernames = extractMentions(input.body);
  if (usernames.length === 0) return;
  const users = await tx.user.findMany({
    where: {
      usernameNormalized: { in: usernames },
      status: UserStatus.ACTIVE,
      deletedAt: null,
    },
    select: { id: true },
  });
  const skip = new Set([input.authorId, ...input.skipUserIds]);
  const candidateIds = users.map((user) => user.id).filter((id) => !skip.has(id));
  if (candidateIds.length === 0) return;
  const blocks = await tx.block.findMany({
    where: {
      OR: [
        { blockerId: input.authorId, blockedId: { in: candidateIds } },
        { blockerId: { in: candidateIds }, blockedId: input.authorId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  const blocked = new Set<string>();
  for (const block of blocks) {
    if (block.blockerId === input.authorId) blocked.add(block.blockedId);
    if (block.blockedId === input.authorId) blocked.add(block.blockerId);
  }
  const recipientIds = candidateIds.filter((id) => !blocked.has(id));
  if (recipientIds.length === 0) return;
  await tx.outboxEvent.createMany({
    data: recipientIds.map((recipientId) => ({
      eventType: "reel.comment.mentioned",
      aggregateType: "reel_comment",
      aggregateId: input.commentId,
      payload: {
        reelId: input.reelId,
        commentId: input.commentId,
        actorId: input.authorId,
        recipientId,
      },
      status: OutboxStatus.PENDING,
    })),
  });
}

export async function enqueueReelMentions(
  tx: Prisma.TransactionClient,
  reelId: string,
  authorId: string,
  caption: string | null,
): Promise<void> {
  const usernames = extractMentions(caption);
  if (usernames.length === 0) return;
  const users = await tx.user.findMany({
    where: {
      usernameNormalized: { in: usernames },
      status: UserStatus.ACTIVE,
      deletedAt: null,
    },
    select: { id: true },
  });
  const candidateIds = users.map((user) => user.id).filter((id) => id !== authorId);
  if (candidateIds.length === 0) return;
  const blocks = await tx.block.findMany({
    where: {
      OR: [
        { blockerId: authorId, blockedId: { in: candidateIds } },
        { blockerId: { in: candidateIds }, blockedId: authorId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  const blocked = new Set<string>();
  for (const block of blocks) {
    if (block.blockerId === authorId) blocked.add(block.blockedId);
    if (block.blockedId === authorId) blocked.add(block.blockerId);
  }
  const recipientIds = candidateIds.filter((id) => !blocked.has(id));
  if (recipientIds.length === 0) return;
  await tx.outboxEvent.createMany({
    data: recipientIds.map((recipientId) => ({
      eventType: "reel.mentioned",
      aggregateType: "reel",
      aggregateId: reelId,
      payload: { reelId, actorId: authorId, recipientId },
      status: OutboxStatus.PENDING,
    })),
  });
}

function approvedReelWhere(reelId: string, viewerId: string): Prisma.ReelWhereInput {
  return {
    id: reelId,
    deletedAt: null,
    status: ReelReviewStatus.APPROVED,
    author: { is: visibleAuthorWhere(viewerId) },
  };
}

function reelCursorWhere(
  cursor: { id: string; createdAt: Date } | undefined,
): Prisma.ReelWhereInput | undefined {
  if (!cursor) return undefined;
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
    ],
  };
}

function commentCursorWhere(
  cursor: { id: string; createdAt: Date } | undefined,
): Prisma.ReelCommentWhereInput | undefined {
  if (!cursor) return undefined;
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
    ],
  };
}

function commentSelect(viewerId: string) {
  return {
    id: true,
    body: true,
    parentId: true,
    likeCount: true,
    replyCount: true,
    depth: true,
    createdAt: true,
    author: { select: authorSelect },
    likes: {
      where: { userId: viewerId },
      select: { userId: true },
      take: 1,
    },
  } satisfies Prisma.ReelCommentSelect;
}
