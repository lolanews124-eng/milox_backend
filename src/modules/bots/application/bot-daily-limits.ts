import type { PrismaClient } from "@prisma/client";

import { DEFAULT_BOT_PERMISSIONS } from "./bot-username.js";

/**
 * Day boundary for per-bot action quotas.
 * All daily limit windows use Coordinated Universal Time (UTC):
 * start = 00:00:00.000Z of the current UTC calendar day.
 */
export const BOT_DAILY_LIMIT_TIMEZONE = "UTC" as const;

export type BotActivityLimitType = "LIKE_POST" | "COMMENT_POST" | "FOLLOW_USER";

export type BotPermissions = {
  likesEnabled: boolean;
  commentsEnabled: boolean;
  followsEnabled: boolean;
  viewsEnabled: boolean;
  maxLikesPerDay: number;
  maxCommentsPerDay: number;
  maxFollowsPerDay: number;
};

export function startOfUtcDay(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function readBotPermissions(raw: unknown): BotPermissions {
  const base: BotPermissions = {
    likesEnabled: DEFAULT_BOT_PERMISSIONS.likesEnabled,
    commentsEnabled: DEFAULT_BOT_PERMISSIONS.commentsEnabled,
    followsEnabled: DEFAULT_BOT_PERMISSIONS.followsEnabled,
    viewsEnabled: DEFAULT_BOT_PERMISSIONS.viewsEnabled,
    maxLikesPerDay: DEFAULT_BOT_PERMISSIONS.maxLikesPerDay,
    maxCommentsPerDay: DEFAULT_BOT_PERMISSIONS.maxCommentsPerDay,
    maxFollowsPerDay: DEFAULT_BOT_PERMISSIONS.maxFollowsPerDay,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const row = raw as Record<string, unknown>;
  return {
    likesEnabled: row.likesEnabled !== false,
    commentsEnabled: row.commentsEnabled !== false,
    followsEnabled: row.followsEnabled !== false,
    viewsEnabled: row.viewsEnabled === true,
    maxLikesPerDay: nonNegInt(row.maxLikesPerDay, base.maxLikesPerDay),
    maxCommentsPerDay: nonNegInt(row.maxCommentsPerDay, base.maxCommentsPerDay),
    maxFollowsPerDay: nonNegInt(row.maxFollowsPerDay, base.maxFollowsPerDay),
  };
}

function nonNegInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function dailyCapFor(
  permissions: BotPermissions,
  activityType: BotActivityLimitType,
): number {
  switch (activityType) {
    case "LIKE_POST":
      return permissions.maxLikesPerDay;
    case "COMMENT_POST":
      return permissions.maxCommentsPerDay;
    case "FOLLOW_USER":
      return permissions.maxFollowsPerDay;
  }
}

/**
 * Authoritative successful actions for the UTC day from domain tables
 * (post_likes / comments / follows). Retries of the same successful action
 * do not create a second domain row, so they are not double-counted.
 */
export async function countSuccessfulBotActionsToday(
  database: PrismaClient,
  botUserId: string,
  activityType: BotActivityLimitType,
  now = new Date(),
): Promise<number> {
  const since = startOfUtcDay(now);
  switch (activityType) {
    case "LIKE_POST":
      return database.postLike.count({
        where: { userId: botUserId, createdAt: { gte: since } },
      });
    case "COMMENT_POST":
      return database.comment.count({
        where: {
          authorId: botUserId,
          deletedAt: null,
          createdAt: { gte: since },
        },
      });
    case "FOLLOW_USER":
      return database.follow.count({
        where: {
          followerId: botUserId,
          createdAt: { gte: since },
        },
      });
  }
}

/**
 * In-flight jobs reserve budget so concurrent planners/workers cannot exceed
 * the daily cap before domain rows exist.
 */
export async function countInFlightBotJobsToday(
  database: PrismaClient,
  botAccountId: string,
  activityType: BotActivityLimitType,
  now = new Date(),
  excludeJobId?: string,
): Promise<number> {
  const since = startOfUtcDay(now);
  return database.botActivityJob.count({
    where: {
      botAccountId,
      activityType,
      status: { in: ["PENDING", "PROCESSING"] },
      createdAt: { gte: since },
      ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
    },
  });
}

export async function getBotDailyUsage(
  database: PrismaClient,
  input: {
    botAccountId: string;
    botUserId: string;
    activityType: BotActivityLimitType;
    permissions: BotPermissions;
    now?: Date;
    /** When checking mid-execution, exclude this claimed job from in-flight. */
    excludeJobId?: string;
  },
): Promise<{
  cap: number;
  successful: number;
  inFlight: number;
  used: number;
  remaining: number;
  timezone: typeof BOT_DAILY_LIMIT_TIMEZONE;
}> {
  const now = input.now ?? new Date();
  const cap = dailyCapFor(input.permissions, input.activityType);
  const [successful, inFlight] = await Promise.all([
    countSuccessfulBotActionsToday(
      database,
      input.botUserId,
      input.activityType,
      now,
    ),
    countInFlightBotJobsToday(
      database,
      input.botAccountId,
      input.activityType,
      now,
      input.excludeJobId,
    ),
  ]);
  const used = successful + inFlight;
  return {
    cap,
    successful,
    inFlight,
    used,
    remaining: Math.max(0, cap - used),
    timezone: BOT_DAILY_LIMIT_TIMEZONE,
  };
}

export async function assertBotDailyLimitAllows(
  database: PrismaClient,
  input: {
    botAccountId: string;
    botUserId: string;
    activityType: BotActivityLimitType;
    permissions: unknown;
    now?: Date;
    excludeJobId?: string;
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const permissions = readBotPermissions(input.permissions);
  if (
    input.activityType === "LIKE_POST" &&
    permissions.likesEnabled === false
  ) {
    return { ok: false, reason: "likes_disabled" };
  }
  if (
    input.activityType === "COMMENT_POST" &&
    permissions.commentsEnabled === false
  ) {
    return { ok: false, reason: "comments_disabled" };
  }
  if (
    input.activityType === "FOLLOW_USER" &&
    permissions.followsEnabled === false
  ) {
    return { ok: false, reason: "follows_disabled" };
  }
  const usage = await getBotDailyUsage(database, {
    botAccountId: input.botAccountId,
    botUserId: input.botUserId,
    activityType: input.activityType,
    permissions,
    ...(input.now !== undefined ? { now: input.now } : {}),
    ...(input.excludeJobId !== undefined
      ? { excludeJobId: input.excludeJobId }
      : {}),
  });
  if (usage.remaining <= 0) {
    return {
      ok: false,
      reason: `daily_limit_${input.activityType.toLowerCase()}`,
    };
  }
  return { ok: true };
}
