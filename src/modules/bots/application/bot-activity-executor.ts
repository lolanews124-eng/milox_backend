import { AppError, isAppError } from "../../../shared/errors/app-error.js";
import type { CommentService } from "../../comments/application/services/comment-service.js";
import type { FollowService } from "../../follows/application/services/follow-service.js";
import type { PostService } from "../../posts/application/services/post-service.js";
import type { PrismaClient } from "@prisma/client";

import {
  assertBotDailyLimitAllows,
  type BotActivityLimitType,
} from "./bot-daily-limits.js";
import {
  evaluatePostTargetPolicy,
  evaluateUserTargetPolicy,
  type BotsTargetPolicy,
} from "./bot-target-policy.js";

function asLimitType(value: string): BotActivityLimitType | null {
  if (
    value === "LIKE_POST" ||
    value === "COMMENT_POST" ||
    value === "FOLLOW_USER"
  ) {
    return value;
  }
  return null;
}

export type BotJobExecutionResult =
  | { outcome: "processed"; detail?: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; error: string; retryable: boolean };

export interface BotActivityExecutorDeps {
  database: PrismaClient;
  posts: PostService;
  comments: CommentService;
  follows: FollowService;
  /** Effective policy from resolveBotsTargetPolicy — defaults to disabled. */
  targetPolicy?: BotsTargetPolicy;
}

/**
 * Executes one claimed job via existing domain services (never raw counters).
 */
export class BotActivityExecutor {
  private readonly targetPolicy: BotsTargetPolicy;

  constructor(private readonly deps: BotActivityExecutorDeps) {
    this.targetPolicy = deps.targetPolicy ?? "disabled";
  }

  async execute(job: {
    id: string;
    botAccountId: string;
    activityType: string;
    targetType: string;
    targetId: string;
    metadata: unknown;
  }): Promise<BotJobExecutionResult> {
    const bot = await this.deps.database.botAccount.findUnique({
      where: { id: job.botAccountId },
      include: {
        user: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
            isAutomatedAccount: true,
          },
        },
      },
    });
    if (!bot || !bot.user.isAutomatedAccount) {
      return { outcome: "failed", error: "bot_account_missing", retryable: false };
    }
    if (bot.status !== "ACTIVE") {
      return {
        outcome: "skipped",
        reason: `bot_status_${bot.status.toLowerCase()}`,
      };
    }
    if (bot.user.status !== "ACTIVE" || bot.user.deletedAt) {
      return { outcome: "skipped", reason: "bot_user_inactive" };
    }

    const limitType = asLimitType(job.activityType);
    if (limitType) {
      const allow = await assertBotDailyLimitAllows(this.deps.database, {
        botAccountId: job.botAccountId,
        botUserId: bot.user.id,
        activityType: limitType,
        permissions: bot.permissions,
        excludeJobId: job.id,
      });
      if (!allow.ok) {
        return { outcome: "skipped", reason: allow.reason };
      }
    }

    try {
      switch (job.activityType) {
        case "LIKE_POST":
          return await this.likePost(bot.user.id, job.targetId);
        case "COMMENT_POST":
          return await this.commentPost(bot.user.id, job.targetId, job.metadata);
        case "FOLLOW_USER":
          return await this.followUser(bot.user.id, job.targetId);
        case "VIEW_POST":
        case "VIEW_STORY":
        case "VIEW_REEL":
          return {
            outcome: "skipped",
            reason: "views_disabled",
          };
        default:
          return {
            outcome: "failed",
            error: `unknown_activity_${job.activityType}`,
            retryable: false,
          };
      }
    } catch (error: unknown) {
      return mapDomainError(error);
    }
  }

  private async likePost(
    botUserId: string,
    postId: string,
  ): Promise<BotJobExecutionResult> {
    const post = await this.deps.database.post.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        isHidden: false,
        author: {
          status: "ACTIVE",
          deletedAt: null,
          isAutomatedAccount: false,
        },
      },
      select: { id: true, body: true },
    });
    if (!post) {
      return { outcome: "skipped", reason: "post_ineligible" };
    }
    const policy = evaluatePostTargetPolicy(this.targetPolicy, post);
    if (!policy.ok) {
      return { outcome: "skipped", reason: policy.reason };
    }
    await this.deps.posts.like(postId, botUserId);
    return { outcome: "processed", detail: "liked" };
  }

  private async commentPost(
    botUserId: string,
    postId: string,
    metadata: unknown,
  ): Promise<BotJobExecutionResult> {
    const body =
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      typeof (metadata as { body?: unknown }).body === "string"
        ? String((metadata as { body: string }).body).trim()
        : "";
    if (!body) {
      return { outcome: "failed", error: "missing_comment_body", retryable: false };
    }
    const post = await this.deps.database.post.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        isHidden: false,
        author: {
          status: "ACTIVE",
          deletedAt: null,
          isAutomatedAccount: false,
        },
      },
      select: { id: true, body: true },
    });
    if (!post) {
      return { outcome: "skipped", reason: "post_ineligible" };
    }
    const policy = evaluatePostTargetPolicy(this.targetPolicy, post);
    if (!policy.ok) {
      return { outcome: "skipped", reason: policy.reason };
    }
    const existing = await this.deps.database.comment.findFirst({
      where: {
        postId,
        authorId: botUserId,
        deletedAt: null,
        body,
      },
      select: { id: true },
    });
    if (existing) {
      return { outcome: "skipped", reason: "duplicate_comment_body" };
    }
    await this.deps.comments.create(postId, botUserId, { body });
    return { outcome: "processed", detail: "commented" };
  }

  private async followUser(
    botUserId: string,
    targetUserId: string,
  ): Promise<BotJobExecutionResult> {
    const target = await this.deps.database.user.findFirst({
      where: {
        id: targetUserId,
        status: "ACTIVE",
        deletedAt: null,
        isAutomatedAccount: false,
        isSystemAccount: false,
        role: "USER",
      },
      select: {
        username: true,
        isPrivateAccount: true,
        bio: true,
        displayName: true,
      },
    });
    if (!target) {
      return { outcome: "skipped", reason: "target_ineligible" };
    }
    if (target.isPrivateAccount) {
      return { outcome: "skipped", reason: "private_account" };
    }
    const policy = evaluateUserTargetPolicy(this.targetPolicy, target);
    if (!policy.ok) {
      return { outcome: "skipped", reason: policy.reason };
    }
    await this.deps.follows.follow(target.username, botUserId);
    return { outcome: "processed", detail: "followed" };
  }
}

function mapDomainError(error: unknown): BotJobExecutionResult {
  if (isAppError(error)) {
    const skipCodes = new Set([
      "ALREADY_LIKED",
      "ALREADY_FOLLOWING",
      "FOLLOW_REQUEST_PENDING",
      "CANNOT_FOLLOW_SELF",
    ]);
    if (skipCodes.has(error.code)) {
      return { outcome: "skipped", reason: error.code.toLowerCase() };
    }
    const retryable = error.statusCode >= 500 || error.statusCode === 429;
    return {
      outcome: "failed",
      error: `${error.code}:${error.message}`.slice(0, 500),
      retryable,
    };
  }
  if (error instanceof AppError) {
    return {
      outcome: "failed",
      error: error.message.slice(0, 500),
      retryable: false,
    };
  }
  const message = error instanceof Error ? error.message : "unknown_error";
  return { outcome: "failed", error: message.slice(0, 500), retryable: true };
}
