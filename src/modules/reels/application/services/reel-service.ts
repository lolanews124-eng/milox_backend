import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import { viewerFollowStateFromStatus } from "../../../posts/application/post-view.js";
import type { FeedCursorCodec } from "../../../feed/application/services/feed-cursor.js";
import type { MediaService } from "../../../media/application/services/media-service.js";
import { REELS_PER_DAY, startOfIstDay } from "../reel-day.js";
import {
  REEL_HASHTAG_WINDOW_DAYS,
  REEL_RANK_POOL,
  REEL_RANK_WINDOW_DAYS,
  scoreReel,
  sliceRankedPage,
  spreadReelPages,
} from "../reel-ranking.js";
import type {
  ReelAuthorRecord,
  ReelCommentRecord,
  ReelRecord,
  ReelRepository,
} from "../ports/reel-repository.js";

function canSendReelInterest(author: ReelAuthorRecord): boolean {
  const alreadySent = (author.interestsReceived?.length ?? 0) > 0;
  const alreadyReceived = (author.interestsSent?.length ?? 0) > 0;
  const matched =
    (author.matchesAsUserA?.length ?? 0) > 0 ||
    (author.matchesAsUserB?.length ?? 0) > 0;
  return !alreadySent && !alreadyReceived && !matched;
}

export class ReelService {
  constructor(
    private readonly repository: ReelRepository,
    private readonly media: MediaService,
    private readonly cursors: FeedCursorCodec,
    private readonly config: AppConfig,
  ) {}

  async quota(authorId: string): Promise<{
    limit: number;
    used: number;
    remaining: number;
  }> {
    const used = await this.repository.countSince(authorId, startOfIstDay());
    return {
      limit: REELS_PER_DAY,
      used,
      remaining: Math.max(0, REELS_PER_DAY - used),
    };
  }

  async assertEnabled(): Promise<void> {
    const enabled = await this.repository.reelsEnabled();
    if (!enabled) {
      throw new AppError(
        "REELS_DISABLED",
        "Reels are turned off right now.",
        403,
      );
    }
  }

  async assertQuota(authorId: string): Promise<void> {
    const quota = await this.quota(authorId);
    if (quota.remaining <= 0) {
      throw new AppError(
        "LIMIT_REACHED",
        "You can post 2 reels a day. Try again tomorrow.",
        429,
      );
    }
  }

  async create(
    authorId: string,
    input: {
      tempPath: string;
      caption?: string | undefined;
      durationMs?: number | undefined;
      posterMediaId?: string | undefined;
    },
  ): Promise<object> {
    await this.assertEnabled();
    const posterMediaId = await this.checkedPoster(authorId, input.posterMediaId);
    let videoId: string | null = null;
    try {
      const uploaded = await this.media.uploadReelVideo(authorId, input.tempPath);
      videoId = uploaded.id;
      const reel = await this.repository.createWithinDailyLimit({
        authorId,
        mediaAssetId: uploaded.id,
        posterMediaId,
        caption: input.caption?.trim() ? input.caption.trim() : null,
        durationMs: input.durationMs ?? 0,
        dayStart: startOfIstDay(),
      });
      return this.present(reel);
    } catch (error: unknown) {
      if (videoId) await this.media.discardUpload(videoId, authorId);
      if (posterMediaId) await this.media.discardUpload(posterMediaId, authorId);
      throw error;
    }
  }

  async list(
    viewerId: string,
    input: {
      limit: number;
      cursor?: string | undefined;
      friendsOnly?: boolean | undefined;
      latest?: boolean | undefined;
    },
  ): Promise<{ items: object[]; nextCursor: string | null; hasMore: boolean }> {
    if (!input.friendsOnly && !input.latest) {
      return this.rankedPage(viewerId, input);
    }
    const decoded = input.cursor ? this.cursors.decode(input.cursor) : null;
    if (decoded && decoded.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "The pagination cursor is invalid or expired",
        400,
      );
    }
    const rows = await this.repository.list({
      viewerId,
      limit: input.limit + 1,
      friendsOnly: input.friendsOnly ?? false,
      ...(decoded
        ? {
            cursor: {
              id: decoded.id,
              createdAt: new Date(decoded.createdAt),
            },
          }
        : {}),
    });
    return this.page(rows, input.limit);
  }

  async listSaved(
    viewerId: string,
    input: { limit: number; cursor?: string | undefined },
  ): Promise<{ items: object[]; nextCursor: string | null; hasMore: boolean }> {
    const decoded = input.cursor ? this.cursors.decode(input.cursor) : null;
    if (decoded && decoded.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "The pagination cursor is invalid or expired",
        400,
      );
    }
    const rows = await this.repository.listSaved({
      viewerId,
      limit: input.limit + 1,
      ...(decoded
        ? { cursor: { id: decoded.id, createdAt: new Date(decoded.createdAt) } }
        : {}),
    });
    const hasMore = rows.length > input.limit;
    const items = hasMore ? rows.slice(0, input.limit) : rows;
    const last = items.at(-1);
    return {
      items: items.map((row) => this.present(row.reel)),
      hasMore,
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.reel.id,
              createdAt: last.savedAt.toISOString(),
            })
          : null,
    };
  }

  private async rankedPage(
    viewerId: string,
    input: { limit: number; cursor?: string | undefined; tag?: string | undefined },
  ): Promise<{ items: object[]; nextCursor: string | null; hasMore: boolean }> {
    const cursor = input.cursor ? this.cursors.decode(input.cursor) : null;
    if (cursor && cursor.kind !== "ranked") {
      throw new AppError(
        "INVALID_CURSOR",
        "The pagination cursor is invalid or expired",
        400,
      );
    }
    const windowDays = input.tag ? REEL_HASHTAG_WINDOW_DAYS : REEL_RANK_WINDOW_DAYS;
    const pool = await this.repository.loadRankPool({
      viewerId,
      since: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000),
      take: REEL_RANK_POOL,
      ...(input.tag ? { tag: input.tag } : {}),
    });
    const interest = new Set(pool.viewer.interestSlugs);
    const viewerCountry = pool.viewer.country.trim().toLowerCase();
    const ranked = pool.candidates.map((candidate) => {
      const authorCountry = candidate.country.trim().toLowerCase();
      return {
        reel: candidate.reel,
        id: candidate.reel.id,
        createdAt: candidate.reel.createdAt,
        authorId: candidate.reel.authorId,
        score: scoreReel({
          viewCount: candidate.reel.viewCount,
          likeCount: candidate.reel.likeCount,
          commentCount: candidate.reel.commentCount,
          shareCount: candidate.reel.shareCount,
          saveCount: candidate.saveCount,
          durationMs: candidate.reel.durationMs,
          avgWatchedMs: candidate.avgWatchedMs,
          measuredWatchCount: candidate.measuredWatchCount,
          followerCount: candidate.followerCount,
          createdAt: candidate.reel.createdAt,
          matched: candidate.matched,
          interestPending: candidate.interestPending,
          following: candidate.following,
          sharedProfileInterest: candidate.authorInterestSlugs.some((slug) =>
            interest.has(slug),
          ),
          sameCountry:
            viewerCountry.length > 0 && viewerCountry === authorCountry,
          hashtags: candidate.hashtags,
          viewerInterestHashtags: pool.viewer.interestSlugs,
          engagedHashtags: pool.viewer.engagedHashtags,
          seen: candidate.seenByViewer,
          own: candidate.reel.authorId === viewerId,
        }),
      };
    });
    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const byTime = b.createdAt.getTime() - a.createdAt.getTime();
      if (byTime !== 0) return byTime;
      return b.id.localeCompare(a.id);
    });
    const ordered = spreadReelPages(ranked, (item) => item.authorId, input.limit);
    const page = sliceRankedPage(
      ordered,
      cursor
        ? { id: cursor.id, score: cursor.score, createdAt: cursor.createdAt }
        : null,
      input.limit,
    );
    const hasMore = page.length > input.limit;
    const items = hasMore ? page.slice(0, input.limit) : page;
    const last = items.at(-1);
    return {
      items: items.map((row) => this.present(row.reel)),
      hasMore,
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "ranked",
              id: last.id,
              createdAt: last.createdAt.toISOString(),
              score: last.score,
            })
          : null,
    };
  }

  private page(
    rows: ReelRecord[],
    limit: number,
  ): { items: object[]; nextCursor: string | null; hasMore: boolean } {
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items: items.map((reel) => this.present(reel)),
      hasMore,
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.id,
              createdAt: last.createdAt.toISOString(),
            })
          : null,
    };
  }

  private async checkedPoster(
    authorId: string,
    posterMediaId: string | undefined,
  ): Promise<string | null> {
    if (!posterMediaId) return null;
    const owned = await this.repository.ownsPoster(authorId, posterMediaId);
    if (!owned) {
      throw new AppError("VALIDATION_ERROR", "Poster image is not valid", 422);
    }
    return posterMediaId;
  }

  async listByUsername(
    username: string,
    viewerId: string,
    input: { limit: number; cursor?: string | undefined },
  ): Promise<{ items: object[]; nextCursor: string | null; hasMore: boolean }> {
    const decoded = input.cursor ? this.cursors.decode(input.cursor) : null;
    if (decoded && decoded.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "The pagination cursor is invalid or expired",
        400,
      );
    }
    const rows = await this.repository.listByUsername({
      username,
      viewerId,
      limit: input.limit + 1,
      ...(decoded
        ? { cursor: { id: decoded.id, createdAt: new Date(decoded.createdAt) } }
        : {}),
    });
    if (!rows) {
      throw new AppError("NOT_FOUND", "User not found", 404);
    }
    return this.page(rows, input.limit);
  }

  async recordView(
    reelId: string,
    viewerId: string,
    watchedMs = 0,
  ): Promise<{ viewCount: number }> {
    const result = await this.repository.recordView(reelId, viewerId, watchedMs);
    if (!result) {
      throw new AppError("REEL_NOT_FOUND", "Reel not found", 404);
    }
    return result;
  }

  async toggleSave(reelId: string, userId: string): Promise<object> {
    const result = await this.repository.toggleSave(reelId, userId);
    if (!result) {
      throw new AppError("REEL_NOT_FOUND", "Reel not found", 404);
    }
    return result;
  }

  async publicPreview(reelId: string): Promise<object> {
    const reel = await this.repository.findPublicPreview(reelId);
    if (!reel) {
      throw new AppError("REEL_NOT_FOUND", "Reel not found", 404);
    }
    const caption = reel.caption?.replace(/\s+/g, " ").trim() ?? "";
    return {
      caption: caption.length > 160 ? `${caption.slice(0, 157)}...` : caption,
      posterUrl: reel.posterMediaId ? this.mediaUrl(reel.posterMediaId) : null,
      authorName: reel.authorName,
    };
  }

  async get(reelId: string, viewerId: string): Promise<object> {
    const reel = await this.repository.findVisible(reelId, viewerId);
    if (!reel) {
      throw new AppError("REEL_NOT_FOUND", "Reel not found", 404);
    }
    return this.present(reel);
  }

  async listByHashtag(
    tag: string,
    viewerId: string,
    input: { cursor?: string | undefined; limit: number },
  ): Promise<{ items: object[]; nextCursor: string | null; hasMore: boolean }> {
    return this.rankedPage(viewerId, { ...input, tag: tag.toLowerCase() });
  }

  async share(reelId: string, userId: string): Promise<{ shareCount: number }> {
    const result = await this.repository.share(reelId, userId);
    if (!result) {
      throw new AppError("REEL_NOT_FOUND", "Reel not found", 404);
    }
    return result;
  }

  async toggleLike(reelId: string, userId: string): Promise<object> {
    const result = await this.repository.toggleLike(reelId, userId);
    if (!result) {
      throw new AppError("REEL_NOT_FOUND", "Reel not found", 404);
    }
    return result;
  }

  async comments(
    reelId: string,
    viewerId: string,
    input: { cursor?: string | undefined; limit: number },
  ): Promise<{ items: object[]; nextCursor: string | null; hasMore: boolean }> {
    return this.commentPage(
      await this.repository.listComments({
        reelId,
        viewerId,
        limit: input.limit + 1,
        ...this.commentCursor(input.cursor),
      }),
      input.limit,
    );
  }

  async replies(
    commentId: string,
    viewerId: string,
    input: { cursor?: string | undefined; limit: number },
  ): Promise<{ items: object[]; nextCursor: string | null; hasMore: boolean }> {
    return this.commentPage(
      await this.repository.listReplies({
        commentId,
        viewerId,
        limit: input.limit + 1,
        ...this.commentCursor(input.cursor),
      }),
      input.limit,
    );
  }

  async addComment(
    reelId: string,
    authorId: string,
    body: string,
    parentId?: string,
  ): Promise<object> {
    const comment = await this.repository.addComment({
      reelId,
      authorId,
      body,
      ...(parentId ? { parentId } : {}),
    });
    if (!comment) {
      throw new AppError("REEL_NOT_FOUND", "Reel not found", 404);
    }
    return this.presentComment(comment);
  }

  async deleteComment(
    reelId: string,
    commentId: string,
    actorId: string,
  ): Promise<void> {
    const deleted = await this.repository.deleteComment(reelId, commentId, actorId);
    if (!deleted) {
      throw new AppError("REEL_NOT_FOUND", "Comment not found", 404);
    }
  }

  async toggleCommentLike(
    reelId: string,
    commentId: string,
    userId: string,
  ): Promise<{ likedByMe: boolean; likeCount: number }> {
    const result = await this.repository.toggleCommentLike(reelId, commentId, userId);
    if (!result) {
      throw new AppError("REEL_NOT_FOUND", "Comment not found", 404);
    }
    return result;
  }

  async remove(reelId: string, authorId: string): Promise<void> {
    const deleted = await this.repository.softDelete(reelId, authorId);
    if (!deleted) {
      throw new AppError("REEL_NOT_FOUND", "Reel not found", 404);
    }
  }

  private present(reel: ReelRecord): object {
    return {
      id: reel.id,
      caption: reel.caption,
      mediaUrl: this.mediaUrl(reel.mediaAssetId),
      posterUrl: reel.posterMediaId ? this.mediaUrl(reel.posterMediaId) : null,
      durationMs: reel.durationMs,
      likeCount: reel.likeCount,
      commentCount: reel.commentCount,
      shareCount: reel.shareCount,
      viewCount: reel.viewCount,
      reviewStatus: reel.status,
      rejectReason: reel.rejectReason,
      likedByMe: reel.likes.length > 0,
      savedByMe: reel.saves.length > 0,
      createdAt: reel.createdAt.toISOString(),
      author: this.presentAuthor(reel.author),
    };
  }

  private presentComment(comment: ReelCommentRecord): object {
    return {
      id: comment.id,
      body: comment.body,
      parentId: comment.parentId,
      likeCount: comment.likeCount,
      replyCount: comment.replyCount,
      depth: comment.depth,
      likedByMe: comment.likes.length > 0,
      createdAt: comment.createdAt.toISOString(),
      author: this.presentAuthor(comment.author),
    };
  }

  private commentCursor(cursor: string | undefined): {
    cursor?: { id: string; createdAt: Date };
  } {
    if (!cursor) return {};
    const decoded = this.cursors.decode(cursor);
    if (!decoded || decoded.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "The pagination cursor is invalid or expired",
        400,
      );
    }
    return { cursor: { id: decoded.id, createdAt: new Date(decoded.createdAt) } };
  }

  private commentPage(
    rows: ReelCommentRecord[] | null,
    limit: number,
  ): { items: object[]; nextCursor: string | null; hasMore: boolean } {
    if (!rows) {
      throw new AppError("REEL_NOT_FOUND", "Reel not found", 404);
    }
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items: items.map((comment) => this.presentComment(comment)),
      hasMore,
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.id,
              createdAt: last.createdAt.toISOString(),
            })
          : null,
    };
  }

  private presentAuthor(author: ReelRecord["author"]): object {
    return {
      id: author.id,
      username: author.username,
      displayName: author.displayName,
      profilePhotoUrl: author.profilePhoto
        ? this.mediaUrl(author.profilePhoto.id)
        : null,
      isVerifiedBadge: author.isVerifiedBadge,
      premiumTier: author.premiumTier,
      ...(author.followers
        ? {
            viewerFollowState: viewerFollowStateFromStatus(
              author.followers[0]?.status,
            ),
          }
        : {}),
      canSendInterest: canSendReelInterest(author),
    };
  }

  private mediaUrl(mediaId: string): string {
    return `${this.config.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/media/${mediaId}`;
  }
}
