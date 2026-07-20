import {
  MediaKind,
  OutboxStatus,
  PostKind,
  Prisma,
  ReportStatus,
  ReportTargetType,
  type PrismaClient,
} from "@prisma/client";

import type {
  CreatePostData,
  CreateProfileUpdatePostData,
  CreatedPost,
  HashtagPageQuery,
  HashtagRecord,
  PostPageQuery,
  PostRepository,
  ReportRecord,
  SavedPageQuery,
  SavedPostRecord,
} from "../application/ports/post-repository.js";
import {
  IdempotencyConflictError,
  PostActionConflictError,
  PostMediaOwnershipError,
} from "../application/ports/post-repository.js";
import type { PostViewRecord } from "../application/post-view.js";
import type { RewardsRepository } from "../../rewards/application/ports/rewards-repository.js";
import { extractHashtags } from "../../../shared/hashtags.js";
import {
  postViewSelect,
  visibleAuthorWhere,
  visiblePostWhere,
} from "./post-query-policy.js";

const CREATE_SCOPE = "posts.create";

export class PrismaPostRepository implements PostRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly rewards?: RewardsRepository,
  ) {}

  async create(data: CreatePostData): Promise<CreatedPost> {
    const replay = await this.findReplay(data);
    if (replay) return replay;

    try {
      const post = await this.database.$transaction(async (transaction) => {
        if (data.mediaIds.length > 0) {
          const media = await transaction.mediaAsset.findMany({
            where: {
              id: { in: data.mediaIds },
              ownerUserId: data.authorId,
              kind: MediaKind.POST_IMAGE,
              deletedAt: null,
              postMedia: { none: {} },
            },
            select: { id: true },
          });
          if (media.length !== data.mediaIds.length) {
            throw new PostMediaOwnershipError();
          }
        }

        const created = await transaction.post.create({
          data: {
            authorId: data.authorId,
            body: data.body,
            ...(data.mediaIds.length > 0
              ? {
                  media: {
                    create: data.mediaIds.map((mediaAssetId, sortOrder) => ({
                      mediaAssetId,
                      sortOrder,
                    })),
                  },
                }
              : {}),
          },
          select: { id: true },
        });

        await syncPostHashtags(transaction, created.id, data.body);

        await transaction.user.update({
          where: { id: data.authorId },
          data: { postCount: { increment: 1 } },
        });
        await transaction.outboxEvent.create({
          data: {
            eventType: "post.created",
            aggregateType: "post",
            aggregateId: created.id,
            payload: { postId: created.id, authorId: data.authorId },
            status: OutboxStatus.PENDING,
          },
        });

        if (data.idempotencyKey && data.requestHash) {
          await transaction.idempotencyRecord.create({
            data: {
              userId: data.authorId,
              scope: CREATE_SCOPE,
              key: data.idempotencyKey,
              requestHash: data.requestHash,
              resourceType: "post",
              resourceId: created.id,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
        }

        if (this.rewards) {
          await this.rewards.creditForPost(transaction, {
            userId: data.authorId,
            postId: created.id,
          });
        }

        return transaction.post.findUniqueOrThrow({
          where: { id: created.id },
          select: postViewSelect(data.authorId),
        });
      });
      return { post, replayed: false };
    } catch (error) {
      if (
        data.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrentReplay = await this.findReplay(data);
        if (concurrentReplay) return concurrentReplay;
      }
      throw error;
    }
  }

  async createProfileUpdatePost(
    data: CreateProfileUpdatePostData,
  ): Promise<void> {
    const expectedMediaKind =
      data.kind === PostKind.PROFILE_PHOTO_UPDATE
        ? MediaKind.PROFILE_PHOTO
        : MediaKind.COVER_PHOTO;

    await this.database.$transaction(async (transaction) => {
      const media = await transaction.mediaAsset.findFirst({
        where: {
          id: data.mediaAssetId,
          ownerUserId: data.authorId,
          kind: expectedMediaKind,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!media) return;

      const created = await transaction.post.create({
        data: {
          authorId: data.authorId,
          kind: data.kind,
          body: null,
          media: {
            create: [{ mediaAssetId: data.mediaAssetId, sortOrder: 0 }],
          },
        },
        select: { id: true },
      });

      await transaction.user.update({
        where: { id: data.authorId },
        data: { postCount: { increment: 1 } },
      });

      await transaction.outboxEvent.create({
        data: {
          eventType: "post.created",
          aggregateType: "post",
          aggregateId: created.id,
          payload: { postId: created.id, authorId: data.authorId },
          status: OutboxStatus.PENDING,
        },
      });
    });
  }

  findVisible(
    postId: string,
    viewerId?: string,
  ): Promise<PostViewRecord | null> {
    return this.database.post.findFirst({
      where: {
        ...visiblePostWhere(postId, viewerId),
      },
      select: postViewSelect(viewerId),
    });
  }

  async listByUsername(
    query: PostPageQuery,
  ): Promise<PostViewRecord[] | null> {
    const author = await this.database.user.findFirst({
      where: {
        usernameNormalized: query.username.toLowerCase(),
        ...visibleAuthorWhere(query.viewerId),
      },
      select: { id: true },
    });
    if (!author) return null;

    return this.database.post.findMany({
      where: {
        authorId: author.id,
        deletedAt: null,
        isHidden: false,
        ...(query.before
          ? {
              OR: [
                { createdAt: { lt: query.before.createdAt } },
                {
                  createdAt: query.before.createdAt,
                  id: { lt: query.before.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: postViewSelect(query.viewerId),
    });
  }

  async listSaved(query: SavedPageQuery): Promise<SavedPostRecord[]> {
    const rows = await this.database.postSave.findMany({
      where: {
        userId: query.viewerId,
        post: {
          deletedAt: null,
          isHidden: false,
          author: { is: visibleAuthorWhere(query.viewerId) },
        },
        ...(query.before
          ? {
              OR: [
                { createdAt: { lt: query.before.createdAt } },
                {
                  createdAt: query.before.createdAt,
                  postId: { lt: query.before.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { postId: "desc" }],
      take: query.limit + 1,
      select: {
        createdAt: true,
        post: { select: postViewSelect(query.viewerId) },
      },
    });
    return rows.map((row) => ({ post: row.post, savedAt: row.createdAt }));
  }

  async listTrendingHashtags(limit: number): Promise<HashtagRecord[]> {
    const rows = await this.database.hashtag.findMany({
      where: { postCount: { gt: 0 } },
      orderBy: [{ postCount: "desc" }, { lastUsedAt: "desc" }],
      take: limit,
      select: { tag: true, postCount: true },
    });
    return rows;
  }

  async searchHashtags(
    term: string,
    limit: number,
  ): Promise<HashtagRecord[]> {
    const rows = await this.database.hashtag.findMany({
      where: {
        postCount: { gt: 0 },
        tag: { contains: term.toLowerCase() },
      },
      orderBy: [{ postCount: "desc" }, { lastUsedAt: "desc" }],
      take: limit,
      select: { tag: true, postCount: true },
    });
    return rows;
  }

  findHashtag(tag: string): Promise<HashtagRecord | null> {
    return this.database.hashtag.findUnique({
      where: { tag },
      select: { tag: true, postCount: true },
    });
  }

  async listByHashtag(query: HashtagPageQuery): Promise<PostViewRecord[]> {
    return this.database.post.findMany({
      where: {
        deletedAt: null,
        isHidden: false,
        hashtags: { some: { hashtag: { tag: query.tag } } },
        author: { is: visibleAuthorWhere(query.viewerId) },
        ...(query.before
          ? {
              OR: [
                { createdAt: { lt: query.before.createdAt } },
                {
                  createdAt: query.before.createdAt,
                  id: { lt: query.before.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      select: postViewSelect(query.viewerId),
    });
  }

  async update(
    postId: string,
    authorId: string,
    body: string | null,
  ): Promise<PostViewRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const result = await transaction.post.updateMany({
        where: { id: postId, authorId, deletedAt: null, isHidden: false },
        data: { body },
      });
      if (result.count === 0) return null;
      await syncPostHashtags(transaction, postId, body);
      return transaction.post.findUnique({
        where: { id: postId },
        select: postViewSelect(authorId),
      });
    });
  }

  async softDelete(postId: string, authorId: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const post = await transaction.post.findFirst({
        where: { id: postId, authorId, deletedAt: null },
        select: {
          id: true,
          media: { select: { mediaAssetId: true } },
        },
      });
      if (!post) return false;

      const deletedAt = new Date();
      await transaction.post.update({
        where: { id: post.id },
        data: { deletedAt, isHidden: true },
      });
      await syncPostHashtags(transaction, post.id, null);
      if (post.media.length > 0) {
        await transaction.mediaAsset.updateMany({
          where: {
            id: { in: post.media.map(({ mediaAssetId }) => mediaAssetId) },
            ownerUserId: authorId,
          },
          data: { deletedAt },
        });
      }
      await transaction.user.updateMany({
        where: { id: authorId, postCount: { gt: 0 } },
        data: { postCount: { decrement: 1 } },
      });
      await transaction.outboxEvent.create({
        data: {
          eventType: "post.deleted",
          aggregateType: "post",
          aggregateId: post.id,
          payload: { postId: post.id, authorId },
        },
      });
      return true;
    });
  }

  like(postId: string, userId: string): Promise<PostViewRecord | null> {
    return this.addPostRelation(postId, userId, "like");
  }

  unlike(postId: string, userId: string): Promise<PostViewRecord | null> {
    return this.removePostRelation(postId, userId, "like");
  }

  save(postId: string, userId: string): Promise<PostViewRecord | null> {
    return this.addPostRelation(postId, userId, "save");
  }

  unsave(postId: string, userId: string): Promise<PostViewRecord | null> {
    return this.removePostRelation(postId, userId, "save");
  }

  async share(
    postId: string,
    userId: string,
  ): Promise<PostViewRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const post = await findVisibleForAction(transaction, postId, userId);
      if (!post) return null;

      await transaction.postShare.create({
        data: { postId, userId },
      });
      await transaction.post.update({
        where: { id: postId },
        data: { shareCount: { increment: 1 } },
      });
      if (post.authorId !== userId) {
        await transaction.outboxEvent.create({
          data: {
            eventType: "post.shared",
            aggregateType: "post",
            aggregateId: postId,
            payload: {
              postId,
              actorId: userId,
              recipientId: post.authorId,
            },
          },
        });
      }
      return transaction.post.findUnique({
        where: { id: postId },
        select: postViewSelect(userId),
      });
    });
  }

  async report(
    postId: string,
    reporterId: string,
    reasonCode: string,
    details?: string,
  ): Promise<ReportRecord | null> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const post = await findVisibleForAction(
          transaction,
          postId,
          reporterId,
        );
        if (!post) return null;
        const existing = await transaction.report.findFirst({
          where: {
            reporterId,
            postId,
            targetType: ReportTargetType.POST,
            status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] },
          },
          select: { id: true },
        });
        if (existing) throw new PostActionConflictError("already_reported");

        return transaction.report.create({
          data: {
            reporterId,
            reportedUserId: post.authorId,
            postId,
            targetType: ReportTargetType.POST,
            reasonCode,
            ...(details ? { details } : {}),
          },
          select: { id: true, status: true, createdAt: true },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new PostActionConflictError("already_reported");
      }
      throw error;
    }
  }

  private async findReplay(
    data: CreatePostData,
  ): Promise<CreatedPost | null> {
    if (!data.idempotencyKey || !data.requestHash) return null;
    const record = await this.database.idempotencyRecord.findUnique({
      where: {
        userId_scope_key: {
          userId: data.authorId,
          scope: CREATE_SCOPE,
          key: data.idempotencyKey,
        },
      },
      select: { requestHash: true, resourceId: true },
    });
    if (!record) return null;
    if (record.requestHash !== data.requestHash) {
      throw new IdempotencyConflictError();
    }
    if (!record.resourceId) throw new IdempotencyConflictError();
    const post = await this.database.post.findUnique({
      where: { id: record.resourceId },
      select: postViewSelect(data.authorId),
    });
    if (!post) throw new IdempotencyConflictError();
    return { post, replayed: true };
  }

  private async addPostRelation(
    postId: string,
    userId: string,
    relation: "like" | "save",
  ): Promise<PostViewRecord | null> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const post = await findVisibleForAction(transaction, postId, userId);
        if (!post) return null;
        if (relation === "like") {
          await transaction.postLike.create({ data: { postId, userId } });
          await transaction.post.update({
            where: { id: postId },
            data: { likeCount: { increment: 1 } },
          });
          if (post.authorId !== userId) {
            await transaction.outboxEvent.create({
              data: {
                eventType: "post.liked",
                aggregateType: "post",
                aggregateId: postId,
                payload: {
                  postId,
                  actorId: userId,
                  recipientId: post.authorId,
                },
              },
            });
          }
        } else {
          await transaction.postSave.create({ data: { postId, userId } });
          await transaction.post.update({
            where: { id: postId },
            data: { saveCount: { increment: 1 } },
          });
        }
        return transaction.post.findUnique({
          where: { id: postId },
          select: postViewSelect(userId),
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new PostActionConflictError(`already_${relation}d`);
      }
      throw error;
    }
  }

  private removePostRelation(
    postId: string,
    userId: string,
    relation: "like" | "save",
  ): Promise<PostViewRecord | null> {
    return this.database.$transaction(async (transaction) => {
      const post = await findVisibleForAction(transaction, postId, userId);
      if (!post) return null;
      const removed =
        relation === "like"
          ? await transaction.postLike.deleteMany({
              where: { postId, userId },
            })
          : await transaction.postSave.deleteMany({
              where: { postId, userId },
            });
      if (removed.count === 0) {
        throw new PostActionConflictError(`not_${relation}d`);
      }
      await transaction.post.updateMany({
        where:
          relation === "like"
            ? { id: postId, likeCount: { gt: 0 } }
            : { id: postId, saveCount: { gt: 0 } },
        data:
          relation === "like"
            ? { likeCount: { decrement: 1 } }
            : { saveCount: { decrement: 1 } },
      });
      return transaction.post.findUnique({
        where: { id: postId },
        select: postViewSelect(userId),
      });
    });
  }
}

type Transaction = Prisma.TransactionClient;

/** Reconciles a post's hashtag links and counters with its current body. */
export async function syncPostHashtags(
  transaction: Transaction,
  postId: string,
  body: string | null | undefined,
): Promise<void> {
  const nextTags = extractHashtags(body);
  const existing = await transaction.postHashtag.findMany({
    where: { postId },
    select: { hashtagId: true, hashtag: { select: { tag: true } } },
  });
  const existingTags = new Set(existing.map((link) => link.hashtag.tag));
  const now = new Date();

  const removed = existing.filter(
    (link) => !nextTags.includes(link.hashtag.tag),
  );
  if (removed.length > 0) {
    await transaction.postHashtag.deleteMany({
      where: { postId, hashtagId: { in: removed.map((r) => r.hashtagId) } },
    });
    await transaction.hashtag.updateMany({
      where: {
        id: { in: removed.map((r) => r.hashtagId) },
        postCount: { gt: 0 },
      },
      data: { postCount: { decrement: 1 } },
    });
  }

  for (const tag of nextTags) {
    if (existingTags.has(tag)) continue;
    const hashtag = await transaction.hashtag.upsert({
      where: { tag },
      create: { tag, postCount: 1, lastUsedAt: now },
      update: { postCount: { increment: 1 }, lastUsedAt: now },
      select: { id: true },
    });
    await transaction.postHashtag.create({
      data: { postId, hashtagId: hashtag.id },
    });
  }
}

function findVisibleForAction(
  transaction: Transaction,
  postId: string,
  viewerId: string,
): Promise<{ authorId: string } | null> {
  return transaction.post.findFirst({
    where: {
      ...visiblePostWhere(postId, viewerId),
    },
    select: { authorId: true },
  });
}
