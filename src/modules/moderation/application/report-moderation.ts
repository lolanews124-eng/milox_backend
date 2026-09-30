import {
  AuditActorType,
  OutboxStatus,
  Prisma,
  ReelReviewStatus,
  ReportStatus,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";

import {
  AdminStateConflictError,
} from "../../admin/application/ports/admin-repository.js";
import { removeOwnedPhoto } from "../../admin/application/remove-user-photo.js";
import {
  computeProfileHealth,
  hidesContent,
  moderationMessage,
  moderationSuggestion,
  restrictUntilFor,
  scoreDeltaFor,
  targetLabel,
  warningKindFor,
  type ModerateAction,
} from "./profile-health.js";

export class ReportModerationError extends Error {
  constructor(readonly code: "NOTHING_TO_REMOVE" | "NO_TARGET_USER") {
    super(code);
  }
}

const reportDetailSelect = {
  id: true,
  reporterId: true,
  targetType: true,
  reportedUserId: true,
  postId: true,
  commentId: true,
  messageId: true,
  storyId: true,
  reelId: true,
  reasonCode: true,
  details: true,
  status: true,
  resolverNote: true,
  createdAt: true,
  reporter: { select: { username: true, displayName: true } },
  reportedUser: {
    select: {
      username: true,
      displayName: true,
      profilePhotoMediaId: true,
      coverPhotoMediaId: true,
    },
  },
  post: {
    select: {
      body: true,
      isHidden: true,
      deletedAt: true,
      media: {
        orderBy: { sortOrder: "asc" as const },
        take: 4,
        select: { mediaAsset: { select: { id: true, mimeType: true } } },
      },
    },
  },
  story: {
    select: {
      caption: true,
      deletedAt: true,
      mediaAsset: { select: { id: true, mimeType: true } },
    },
  },
  reel: {
    select: {
      caption: true,
      deletedAt: true,
      status: true,
      posterAsset: { select: { id: true, mimeType: true } },
    },
  },
  comment: { select: { body: true, isHidden: true, deletedAt: true } },
  message: { select: { body: true, deletedForEveryoneAt: true } },
} satisfies Prisma.ReportSelect;

type ReportDetailRow = Prisma.ReportGetPayload<{ select: typeof reportDetailSelect }>;

const warningSelect = {
  id: true,
  kind: true,
  reasonCode: true,
  message: true,
  scoreDelta: true,
  restrictUntil: true,
  createdAt: true,
} satisfies Prisma.ProfileWarningSelect;

type WarningRow = Prisma.ProfileWarningGetPayload<{ select: typeof warningSelect }>;

function hasContent(report: {
  postId: string | null;
  storyId: string | null;
  reelId: string | null;
  commentId: string | null;
  messageId: string | null;
}): boolean {
  return Boolean(
    report.postId ||
      report.storyId ||
      report.reelId ||
      report.commentId ||
      report.messageId,
  );
}

function presentContent(report: ReportDetailRow) {
  const media: Array<{ id: string; mimeType: string }> = [];
  if (report.post) {
    for (const item of report.post.media) {
      media.push({
        id: item.mediaAsset.id,
        mimeType: item.mediaAsset.mimeType,
      });
    }
  }
  if (report.story?.mediaAsset) {
    media.push({
      id: report.story.mediaAsset.id,
      mimeType: report.story.mediaAsset.mimeType,
    });
  }
  if (report.reel?.posterAsset) {
    media.push({
      id: report.reel.posterAsset.id,
      mimeType: report.reel.posterAsset.mimeType,
    });
  }
  const text =
    report.post?.body ??
    report.story?.caption ??
    report.reel?.caption ??
    report.comment?.body ??
    report.message?.body ??
    null;
  const removed = Boolean(
    report.post?.isHidden ||
      report.post?.deletedAt ||
      report.story?.deletedAt ||
      report.reel?.deletedAt ||
      report.comment?.isHidden ||
      report.comment?.deletedAt ||
      report.message?.deletedForEveryoneAt,
  );
  const profileId = report.reportedUser?.profilePhotoMediaId ?? null;
  const coverId = report.reportedUser?.coverPhotoMediaId ?? null;
  return {
    label: targetLabel(report.targetType),
    text,
    media,
    removed,
    isCurrentProfile: media.some((item) => item.id === profileId),
    isCurrentCover: media.some((item) => item.id === coverId),
  };
}

function presentDetail(report: ReportDetailRow, warnings: WarningRow[], now: Date) {
  const health = computeProfileHealth(warnings, now);
  return {
    id: report.id,
    status: report.status,
    targetType: report.targetType,
    reasonCode: report.reasonCode,
    details: report.details,
    resolverNote: report.resolverNote,
    createdAt: report.createdAt.toISOString(),
    reporterUsername: report.reporter.username,
    reportedUserId: report.reportedUserId,
    reportedUsername: report.reportedUser?.username ?? null,
    content: presentContent(report),
    health: report.reportedUserId
      ? {
          score: health.score,
          band: health.band,
          bandLabel: health.bandLabel,
          seriousStrikes90d: health.seriousStrikes90d,
          restrictedUntil: health.restrictedUntil?.toISOString() ?? null,
          warnings: [...warnings]
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
            .slice(0, 8)
            .map((warning) => ({
              id: warning.id,
              kind: warning.kind,
              reasonCode: warning.reasonCode,
              message: warning.message,
              scoreDelta: warning.scoreDelta,
              createdAt: warning.createdAt.toISOString(),
            })),
        }
      : null,
    suggestion: moderationSuggestion(
      health.seriousStrikes90d,
      report.reasonCode,
    ),
  };
}

async function loadWarnings(
  database: Prisma.TransactionClient | PrismaClient,
  userId: string | null,
): Promise<WarningRow[]> {
  if (!userId) return [];
  return database.profileWarning.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: warningSelect,
  });
}

export async function warnUserDirectly(
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string;
    userId: string;
    reasonCode: string;
    note: string | null;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const user = await transaction.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: { id: true },
  });
  if (!user) return null;
  const message = moderationMessage({
    action: "WARN",
    reasonCode: input.reasonCode,
    targetType: "USER",
  });
  const warning = await transaction.profileWarning.create({
    data: {
      userId: user.id,
      actorId: input.actorId,
      kind: warningKindFor("WARN"),
      reasonCode: input.reasonCode,
      message,
      scoreDelta: scoreDeltaFor("WARN", input.reasonCode),
    },
    select: { id: true },
  });
  await transaction.outboxEvent.create({
    data: {
      eventType: "profile.warned",
      aggregateType: "profile_warning",
      aggregateId: warning.id,
      payload: {
        recipientId: user.id,
        warningId: warning.id,
        message,
      },
      status: OutboxStatus.PENDING,
    },
  });
  await transaction.moderationAction.create({
    data: {
      actorId: input.actorId,
      targetUserId: user.id,
      actionCode: "WARN",
      note: input.note,
      metadata: { reasonCode: input.reasonCode, warningId: warning.id },
    },
  });
  await transaction.auditLog.create({
    data: {
      actorType: AuditActorType.ADMIN,
      actorUserId: input.actorId,
      action: "admin.user.warned",
      resourceType: "user",
      resourceId: user.id,
      metadata: { reasonCode: input.reasonCode, warningId: warning.id },
    },
  });
  return { id: warning.id, message };
}

export async function loadReportDetail(
  database: PrismaClient,
  reportId: string,
  now = new Date(),
) {
  const report = await database.report.findUnique({
    where: { id: reportId },
    select: reportDetailSelect,
  });
  if (!report) return null;
  const warnings = await loadWarnings(database, report.reportedUserId);
  return presentDetail(report, warnings, now);
}

async function hideReportedContent(
  transaction: Prisma.TransactionClient,
  report: ReportDetailRow,
  message: string,
  now: Date,
): Promise<void> {
  if (report.postId) {
    await transaction.post.update({
      where: { id: report.postId },
      data: { isHidden: true },
    });
  }
  if (report.storyId) {
    await transaction.story.update({
      where: { id: report.storyId },
      data: { deletedAt: now },
    });
  }
  if (report.reelId) {
    await transaction.reel.update({
      where: { id: report.reelId },
      data: {
        deletedAt: now,
        status: ReelReviewStatus.REJECTED,
        rejectReason: message.slice(0, 300),
        reviewedAt: now,
      },
    });
  }
  if (report.commentId) {
    await transaction.comment.update({
      where: { id: report.commentId },
      data: { isHidden: true },
    });
  }
  if (report.messageId) {
    await transaction.message.update({
      where: { id: report.messageId },
      data: { deletedForEveryoneAt: now },
    });
  }
}

export async function moderateOpenReport(
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string;
    reportId: string;
    action: ModerateAction;
    reasonCode?: string | undefined;
    note: string | null;
    removeProfileMedia?: boolean | undefined;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const report = await transaction.report.findUnique({
    where: { id: input.reportId },
    select: reportDetailSelect,
  });
  if (!report) return null;
  if (
    report.status !== ReportStatus.OPEN &&
    report.status !== ReportStatus.UNDER_REVIEW
  ) {
    throw new AdminStateConflictError();
  }

  if (input.action === "DISMISS") {
    await transaction.report.update({
      where: { id: report.id },
      data: {
        status: ReportStatus.DISMISSED,
        resolvedAt: now,
        resolverNote: input.note,
      },
    });
    await transaction.moderationAction.create({
      data: {
        actorId: input.actorId,
        targetUserId: report.reportedUserId,
        reportId: report.id,
        actionCode: "REPORT_DISMISSED",
        note: input.note,
        metadata: { action: input.action },
      },
    });
    await transaction.auditLog.create({
      data: {
        actorType: AuditActorType.ADMIN,
        actorUserId: input.actorId,
        action: "admin.report.dismissed",
        resourceType: "report",
        resourceId: report.id,
        metadata: { action: input.action },
      },
    });
    const warnings = await loadWarnings(transaction, report.reportedUserId);
    const fresh = await transaction.report.findUniqueOrThrow({
      where: { id: report.id },
      select: reportDetailSelect,
    });
    return presentDetail(fresh, warnings, now);
  }

  if (!report.reportedUserId) {
    throw new ReportModerationError("NO_TARGET_USER");
  }
  const reasonCode = input.reasonCode?.trim() || report.reasonCode || "OTHER";
  const removing =
    input.action === "REMOVE" || input.action === "REMOVE_AND_WARN";
  if (removing && !hasContent(report)) {
    throw new ReportModerationError("NOTHING_TO_REMOVE");
  }

  const message = moderationMessage({
    action: input.action,
    reasonCode: reasonCode,
    targetType: report.targetType,
  });
  if (hidesContent(input.action) && hasContent(report)) {
    await hideReportedContent(transaction, report, message, now);
  }
  if (
    input.removeProfileMedia &&
    hidesContent(input.action) &&
    report.reportedUserId
  ) {
    const profileId = report.reportedUser?.profilePhotoMediaId;
    const coverId = report.reportedUser?.coverPhotoMediaId;
    const mediaIds = [
      ...(report.post?.media.map((item) => item.mediaAsset.id) ?? []),
      report.story?.mediaAsset?.id,
      report.reel?.posterAsset?.id,
    ].filter(
      (mediaId): mediaId is string =>
        typeof mediaId === "string" &&
        (mediaId === profileId || mediaId === coverId),
    );
    for (const mediaId of new Set(mediaIds)) {
      await removeOwnedPhoto(transaction, {
        actorId: input.actorId,
        userId: report.reportedUserId,
        mediaId,
        reason: message,
        now,
      });
    }
  }

  const warning = await transaction.profileWarning.create({
    data: {
      userId: report.reportedUserId,
      actorId: input.actorId,
      reportId: report.id,
      kind: warningKindFor(input.action),
      reasonCode: reasonCode,
      message,
      scoreDelta: scoreDeltaFor(input.action, reasonCode),
      restrictUntil: restrictUntilFor(input.action, now),
      postId: report.postId,
      storyId: report.storyId,
      reelId: report.reelId,
      commentId: report.commentId,
    },
    select: { id: true },
  });

  await transaction.outboxEvent.create({
    data: {
      eventType: "profile.warned",
      aggregateType: "profile_warning",
      aggregateId: warning.id,
      payload: {
        recipientId: report.reportedUserId,
        warningId: warning.id,
        message,
      },
      status: OutboxStatus.PENDING,
    },
  });

  if (input.action === "SUSPEND") {
    await transaction.user.update({
      where: { id: report.reportedUserId },
      data: { status: UserStatus.SUSPENDED },
    });
  }

  await transaction.report.update({
    where: { id: report.id },
    data: {
      status: ReportStatus.RESOLVED,
      resolvedAt: now,
      resolverNote: input.note,
    },
  });
  await transaction.moderationAction.create({
    data: {
      actorId: input.actorId,
      targetUserId: report.reportedUserId,
      reportId: report.id,
      actionCode: input.action,
      note: input.note,
      metadata: {
        action: input.action,
        reasonCode: reasonCode,
        warningId: warning.id,
      },
    },
  });
  await transaction.auditLog.create({
    data: {
      actorType: AuditActorType.ADMIN,
      actorUserId: input.actorId,
      action: "admin.report.moderated",
      resourceType: "report",
      resourceId: report.id,
      metadata: {
        action: input.action,
        reasonCode: reasonCode,
        warningId: warning.id,
      },
    },
  });

  const warnings = await loadWarnings(transaction, report.reportedUserId);
  const fresh = await transaction.report.findUniqueOrThrow({
    where: { id: report.id },
    select: reportDetailSelect,
  });
  return presentDetail(fresh, warnings, now);
}
