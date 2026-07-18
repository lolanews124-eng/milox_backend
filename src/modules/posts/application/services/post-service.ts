import { createHash } from "node:crypto";

import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type {
  PostRepository,
  ReportRecord,
} from "../ports/post-repository.js";
import {
  IdempotencyConflictError,
  PostActionConflictError,
  PostMediaOwnershipError,
} from "../ports/post-repository.js";
import { presentPost } from "../post-view.js";
import type { FeedCursorCodec } from "../../../feed/application/services/feed-cursor.js";

export interface PostPage {
  items: object[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class PostService {
  constructor(
    private readonly repository: PostRepository,
    private readonly cursors: FeedCursorCodec,
    private readonly config: AppConfig,
  ) {}

  async create(
    authorId: string,
    input: { body?: string | undefined; mediaIds: string[] },
    idempotencyKey?: string,
  ): Promise<{ item: object; replayed: boolean }> {
    const body = normalizeBody(input.body);
    if (!body && input.mediaIds.length === 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        "A post requires text or at least one image",
        400,
      );
    }
    const mediaIds = [...new Set(input.mediaIds)];
    if (mediaIds.length !== input.mediaIds.length) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Media IDs must be unique",
        400,
      );
    }

    try {
      const created = await this.repository.create({
        authorId,
        body,
        mediaIds,
        ...(idempotencyKey
          ? {
              idempotencyKey,
              requestHash: hashRequest({ body, mediaIds }),
            }
          : {}),
      });
      return {
        item: presentPost(created.post, this.config),
        replayed: created.replayed,
      };
    } catch (error) {
      if (error instanceof PostMediaOwnershipError) {
        throw new AppError(
          "MEDIA_NOT_OWNED",
          "Every image must be an unused post image owned by you",
          403,
        );
      }
      if (error instanceof IdempotencyConflictError) {
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "This idempotency key was used with a different request",
          409,
        );
      }
      throw error;
    }
  }

  async get(postId: string, viewerId?: string): Promise<object> {
    const post = await this.repository.findVisible(postId, viewerId);
    if (!post) throw postNotFound();
    return presentPost(post, this.config);
  }

  async listByUsername(
    username: string,
    options: { viewerId?: string; cursor?: string; limit: number },
  ): Promise<PostPage> {
    const cursor = options.cursor
      ? this.cursors.decode(options.cursor)
      : undefined;
    if (cursor && cursor.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "This cursor cannot be used for user posts",
        400,
      );
    }
    const rows = await this.repository.listByUsername({
      username,
      limit: options.limit,
      ...(options.viewerId ? { viewerId: options.viewerId } : {}),
      ...(cursor
        ? {
            before: {
              id: cursor.id,
              createdAt: new Date(cursor.createdAt),
            },
          }
        : {}),
    });
    if (!rows) throw new AppError("NOT_FOUND", "User not found", 404);

    const hasMore = rows.length > options.limit;
    const pageRows = rows.slice(0, options.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((post) => presentPost(post, this.config)),
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.id,
              createdAt: last.createdAt.toISOString(),
            })
          : null,
      hasMore,
    };
  }

  async listSaved(
    viewerId: string,
    options: { cursor?: string; limit: number },
  ): Promise<PostPage> {
    const cursor = options.cursor
      ? this.cursors.decode(options.cursor)
      : undefined;
    if (cursor && cursor.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "This cursor cannot be used for saved posts",
        400,
      );
    }
    const rows = await this.repository.listSaved({
      viewerId,
      limit: options.limit,
      ...(cursor
        ? {
            before: {
              id: cursor.id,
              createdAt: new Date(cursor.createdAt),
            },
          }
        : {}),
    });

    const hasMore = rows.length > options.limit;
    const pageRows = rows.slice(0, options.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => presentPost(row.post, this.config)),
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.post.id,
              createdAt: last.savedAt.toISOString(),
            })
          : null,
      hasMore,
    };
  }

  async listTrendingHashtags(
    limit: number,
  ): Promise<{ tag: string; postCount: number }[]> {
    return this.repository.listTrendingHashtags(limit);
  }

  async searchHashtags(
    term: string,
    limit: number,
  ): Promise<{ tag: string; postCount: number }[]> {
    return this.repository.searchHashtags(term.trim().replace(/^#/, ""), limit);
  }

  async getHashtag(
    tag: string,
  ): Promise<{ tag: string; postCount: number }> {
    const record = await this.repository.findHashtag(tag.toLowerCase());
    return record ?? { tag: tag.toLowerCase(), postCount: 0 };
  }

  async listByHashtag(
    tag: string,
    options: { viewerId?: string; cursor?: string; limit: number },
  ): Promise<PostPage> {
    const cursor = options.cursor
      ? this.cursors.decode(options.cursor)
      : undefined;
    if (cursor && cursor.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "This cursor cannot be used for hashtag posts",
        400,
      );
    }
    const rows = await this.repository.listByHashtag({
      tag: tag.toLowerCase(),
      limit: options.limit,
      ...(options.viewerId ? { viewerId: options.viewerId } : {}),
      ...(cursor
        ? {
            before: {
              id: cursor.id,
              createdAt: new Date(cursor.createdAt),
            },
          }
        : {}),
    });

    const hasMore = rows.length > options.limit;
    const pageRows = rows.slice(0, options.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((post) => presentPost(post, this.config)),
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.id,
              createdAt: last.createdAt.toISOString(),
            })
          : null,
      hasMore,
    };
  }

  async update(
    postId: string,
    authorId: string,
    input: { body: string | null },
  ): Promise<object> {
    const current = await this.repository.findVisible(postId, authorId);
    if (!current || current.author.id !== authorId) throw postNotFound();
    const body = normalizeBody(input.body ?? undefined);
    if (!body && current.media.length === 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        "A post requires text or at least one image",
        400,
      );
    }
    const updated = await this.repository.update(postId, authorId, body);
    if (!updated) throw postNotFound();
    return presentPost(updated, this.config);
  }

  async delete(postId: string, authorId: string): Promise<void> {
    if (!(await this.repository.softDelete(postId, authorId))) {
      throw postNotFound();
    }
  }

  like(postId: string, userId: string): Promise<object> {
    return this.mutate(postId, userId, "like");
  }

  unlike(postId: string, userId: string): Promise<object> {
    return this.mutate(postId, userId, "unlike");
  }

  save(postId: string, userId: string): Promise<object> {
    return this.mutate(postId, userId, "save");
  }

  unsave(postId: string, userId: string): Promise<object> {
    return this.mutate(postId, userId, "unsave");
  }

  share(postId: string, userId: string): Promise<object> {
    return this.mutate(postId, userId, "share");
  }

  async report(
    postId: string,
    reporterId: string,
    input: { reasonCode: string; details?: string | undefined },
  ): Promise<object> {
    const visible = await this.repository.findVisible(postId, reporterId);
    if (!visible) throw postNotFound();
    if (visible.author.id === reporterId) {
      throw new AppError("FORBIDDEN", "You cannot report your own post", 403);
    }
    try {
      const report = await this.repository.report(
        postId,
        reporterId,
        input.reasonCode,
        input.details,
      );
      if (!report) throw postNotFound();
      return mapReport(report);
    } catch (error) {
      if (
        error instanceof PostActionConflictError &&
        error.message === "already_reported"
      ) {
        throw new AppError(
          "ALREADY_REPORTED",
          "You already have an open report for this post",
          409,
        );
      }
      throw error;
    }
  }

  private async mutate(
    postId: string,
    userId: string,
    action: "like" | "unlike" | "save" | "unsave" | "share",
  ): Promise<object> {
    try {
      const post = await this.repository[action](postId, userId);
      if (!post) throw postNotFound();
      return presentPost(post, this.config);
    } catch (error) {
      if (error instanceof PostActionConflictError) {
        const codeByReason: Record<string, string> = {
          already_liked: "ALREADY_LIKED",
          not_liked: "NOT_LIKED",
          already_saved: "ALREADY_SAVED",
          not_saved: "NOT_SAVED",
        };
        throw new AppError(
          codeByReason[error.message] ?? "CONFLICT",
          "The post action conflicts with its current state",
          409,
        );
      }
      throw error;
    }
  }
}

function normalizeBody(body: string | undefined): string | null {
  const normalized = body?.trim();
  return normalized ? normalized : null;
}

function hashRequest(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mapReport(report: ReportRecord): object {
  return {
    id: report.id,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
  };
}

function postNotFound(): AppError {
  return new AppError("POST_NOT_FOUND", "Post not found", 404);
}
