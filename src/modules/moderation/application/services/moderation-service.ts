import type { ReportTargetType } from "@prisma/client";

import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type { FeedCursorCodec } from "../../../feed/application/services/feed-cursor.js";
import { presentPublicAuthor } from "../../../posts/application/post-view.js";
import type { ModerationRepository } from "../ports/moderation-repository.js";
import {
  BlockConflictError,
  CannotBlockSelfError,
  ReportConflictError,
  ReportTargetInvalidError,
} from "../ports/moderation-repository.js";

export class ModerationService {
  constructor(
    private readonly repository: ModerationRepository,
    private readonly cursors: FeedCursorCodec,
    private readonly config: AppConfig,
  ) {}

  async block(username: string, blockerId: string): Promise<void> {
    try {
      const blocked = await this.repository.block(
        normalizeUsername(username),
        blockerId,
      );
      if (!blocked) throw notFound();
    } catch (error) {
      mapBlockError(error);
    }
  }

  async unblock(username: string, blockerId: string): Promise<void> {
    try {
      const unblocked = await this.repository.unblock(
        normalizeUsername(username),
        blockerId,
      );
      if (!unblocked) throw notFound();
    } catch (error) {
      mapBlockError(error);
    }
  }

  async listBlocks(
    blockerId: string,
    options: { cursor?: string; limit: number },
  ): Promise<{ items: object[]; nextCursor: string | null; hasMore: boolean }> {
    const cursor = options.cursor
      ? this.cursors.decode(options.cursor)
      : undefined;
    if (cursor && cursor.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "This cursor cannot be used for blocked users",
        400,
      );
    }
    const rows = await this.repository.listBlocks({
      blockerId,
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
      items: pageRows.map((row) => presentPublicAuthor(row.user, this.config)),
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

  async createReport(
    reporterId: string,
    input: {
      targetType: ReportTargetType;
      reportedUserId?: string | null;
      postId?: string | null;
      commentId?: string | null;
      messageId?: string | null;
      reasonCode: string;
      details?: string | null;
    },
  ): Promise<object> {
    assertTargetShape(input);
    try {
      const report = await this.repository.createReport({
        reporterId,
        targetType: input.targetType,
        reportedUserId: input.reportedUserId ?? null,
        postId: input.postId ?? null,
        commentId: input.commentId ?? null,
        messageId: input.messageId ?? null,
        reasonCode: input.reasonCode,
        details: input.details?.trim() || null,
      });
      if (!report) {
        throw new AppError("NOT_FOUND", "Report target not found", 404);
      }
      return { message: "Report submitted" };
    } catch (error) {
      if (error instanceof ReportConflictError) {
        if (error.reason === "self_report") {
          throw new AppError(
            "FORBIDDEN",
            "You cannot report your own content",
            403,
          );
        }
        throw new AppError(
          "ALREADY_REPORTED",
          "You already have an open report for this target",
          409,
        );
      }
      if (error instanceof ReportTargetInvalidError) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Report target fields do not match the target type",
          400,
        );
      }
      throw error;
    }
  }
}

function assertTargetShape(input: {
  targetType: ReportTargetType;
  reportedUserId?: string | null;
  postId?: string | null;
  commentId?: string | null;
  messageId?: string | null;
}): void {
  const ids = {
    reportedUserId: Boolean(input.reportedUserId),
    postId: Boolean(input.postId),
    commentId: Boolean(input.commentId),
    messageId: Boolean(input.messageId),
  };
  const valid =
    (input.targetType === "USER" &&
      ids.reportedUserId &&
      !ids.postId &&
      !ids.commentId &&
      !ids.messageId) ||
    (input.targetType === "POST" &&
      ids.postId &&
      !ids.reportedUserId &&
      !ids.commentId &&
      !ids.messageId) ||
    (input.targetType === "COMMENT" &&
      ids.commentId &&
      !ids.reportedUserId &&
      !ids.postId &&
      !ids.messageId) ||
    (input.targetType === "MESSAGE" &&
      ids.messageId &&
      !ids.reportedUserId &&
      !ids.postId &&
      !ids.commentId);

  if (!valid) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Provide exactly one target ID matching the target type",
      400,
    );
  }
}

function mapBlockError(error: unknown): never {
  if (error instanceof CannotBlockSelfError) {
    throw new AppError(
      "CANNOT_BLOCK_SELF",
      "You cannot block yourself",
      422,
    );
  }
  if (error instanceof BlockConflictError) {
    throw new AppError(
      error.reason === "already_blocked"
        ? "ALREADY_BLOCKED"
        : "NOT_BLOCKED",
      error.reason === "already_blocked"
        ? "User is already blocked"
        : "User is not blocked",
      409,
    );
  }
  throw error;
}

function notFound(): AppError {
  return new AppError("NOT_FOUND", "User not found", 404);
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
