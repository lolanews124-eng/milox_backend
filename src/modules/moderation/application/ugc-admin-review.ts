import {
  UgcModerationState,
  type PrismaClient,
} from "@prisma/client";

import { AppError } from "../../../shared/errors/app-error.js";

export async function listPendingUgc(
  database: PrismaClient,
  input: { limit?: number; offset?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const [posts, comments, bios, postTotal, commentTotal, bioTotal] =
    await Promise.all([
      database.post.findMany({
        where: {
          moderationState: UgcModerationState.PENDING,
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          body: true,
          moderationReason: true,
          moderatedAt: true,
          createdAt: true,
          author: { select: { id: true, username: true } },
        },
      }),
      database.comment.findMany({
        where: {
          moderationState: UgcModerationState.PENDING,
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          body: true,
          postId: true,
          moderationReason: true,
          moderatedAt: true,
          createdAt: true,
          author: { select: { id: true, username: true } },
        },
      }),
      database.user.findMany({
        where: {
          bioModerationState: UgcModerationState.PENDING,
          deletedAt: null,
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          username: true,
          bio: true,
          websiteUrl: true,
          bioModerationReason: true,
          bioModeratedAt: true,
          updatedAt: true,
        },
      }),
      database.post.count({
        where: { moderationState: UgcModerationState.PENDING, deletedAt: null },
      }),
      database.comment.count({
        where: {
          moderationState: UgcModerationState.PENDING,
          deletedAt: null,
        },
      }),
      database.user.count({
        where: {
          bioModerationState: UgcModerationState.PENDING,
          deletedAt: null,
        },
      }),
    ]);

  return {
    totals: { posts: postTotal, comments: commentTotal, bios: bioTotal },
    posts,
    comments,
    bios,
    limit,
    offset,
  };
}

export async function resolveUgcReview(
  database: PrismaClient,
  input: {
    actorUserId: string;
    resourceType: "post" | "comment" | "bio";
    resourceId: string;
    action: "approve" | "reject" | "remove";
  },
) {
  const now = new Date();
  if (input.resourceType === "post") {
    const state =
      input.action === "approve"
        ? UgcModerationState.APPROVED
        : input.action === "reject"
          ? UgcModerationState.REJECTED
          : UgcModerationState.REMOVED;
    const updated = await database.post.updateMany({
      where: { id: input.resourceId, deletedAt: null },
      data: {
        moderationState: state,
        moderatedAt: now,
        isHidden: state !== UgcModerationState.APPROVED,
        ...(input.action === "remove" ? { deletedAt: now } : {}),
        moderationReason:
          input.action === "approve" ? null : `admin:${input.action}`,
      },
    });
    if (updated.count === 0) {
      throw new AppError("NOT_FOUND", "Post not found", 404);
    }
    await database.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorUserId: input.actorUserId,
        action: `ugc.post.${input.action}`,
        resourceType: "post",
        resourceId: input.resourceId,
        metadata: { state },
      },
    });
    return { ok: true as const, state };
  }

  if (input.resourceType === "comment") {
    const state =
      input.action === "approve"
        ? UgcModerationState.APPROVED
        : input.action === "reject"
          ? UgcModerationState.REJECTED
          : UgcModerationState.REMOVED;
    const updated = await database.comment.updateMany({
      where: { id: input.resourceId, deletedAt: null },
      data: {
        moderationState: state,
        moderatedAt: now,
        isHidden: state !== UgcModerationState.APPROVED,
        ...(input.action === "remove" ? { deletedAt: now, isHidden: true } : {}),
        moderationReason:
          input.action === "approve" ? null : `admin:${input.action}`,
      },
    });
    if (updated.count === 0) {
      throw new AppError("NOT_FOUND", "Comment not found", 404);
    }
    await database.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorUserId: input.actorUserId,
        action: `ugc.comment.${input.action}`,
        resourceType: "comment",
        resourceId: input.resourceId,
        metadata: { state },
      },
    });
    return { ok: true as const, state };
  }

  const state =
    input.action === "approve"
      ? UgcModerationState.APPROVED
      : input.action === "reject"
        ? UgcModerationState.REJECTED
        : UgcModerationState.REMOVED;
  const updated = await database.user.updateMany({
    where: { id: input.resourceId, deletedAt: null },
    data: {
      bioModerationState: state,
      bioModeratedAt: now,
      bioModerationReason:
        input.action === "approve" ? null : `admin:${input.action}`,
      ...(input.action === "remove" ? { bio: null, websiteUrl: null } : {}),
    },
  });
  if (updated.count === 0) {
    throw new AppError("NOT_FOUND", "User not found", 404);
  }
  await database.auditLog.create({
    data: {
      actorType: "ADMIN",
      actorUserId: input.actorUserId,
      action: `ugc.bio.${input.action}`,
      resourceType: "user",
      resourceId: input.resourceId,
      metadata: { state },
    },
  });
  return { ok: true as const, state };
}
