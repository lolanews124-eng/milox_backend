import {
  AuditActorType,
  MediaKind,
  OutboxStatus,
  PostKind,
  type Prisma,
} from "@prisma/client";

export class PhotoReasonRequiredError extends Error {}

export interface RemovedUserPhoto {
  mediaId: string;
  clearedProfile: boolean;
  clearedCover: boolean;
  message: string;
}

export function photoRemovalMessage(input: {
  clearedProfile: boolean;
  clearedCover: boolean;
  reason: string;
}): string {
  const reason = input.reason.trim();
  if (input.clearedProfile && input.clearedCover) {
    return `Your profile photo and cover photo were removed: ${reason}`;
  }
  if (input.clearedProfile) {
    return `Your profile photo was removed: ${reason}`;
  }
  if (input.clearedCover) {
    return `Your cover photo was removed: ${reason}`;
  }
  return `A photo was removed from your account: ${reason}`;
}

export async function removeOwnedPhoto(
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string;
    userId: string;
    mediaId: string;
    reason: string;
    now?: Date;
  },
): Promise<RemovedUserPhoto | null> {
  const now = input.now ?? new Date();
  const media = await transaction.mediaAsset.findFirst({
    where: {
      id: input.mediaId,
      ownerUserId: input.userId,
      deletedAt: null,
      kind: { not: MediaKind.CHAT_IMAGE },
      mimeType: { startsWith: "image/" },
    },
    select: { id: true },
  });
  if (!media) return null;

  const user = await transaction.user.findUnique({
    where: { id: input.userId },
    select: { profilePhotoMediaId: true, coverPhotoMediaId: true },
  });
  if (!user) return null;

  const clearedProfile = user.profilePhotoMediaId === media.id;
  const clearedCover = user.coverPhotoMediaId === media.id;
  if (clearedProfile || clearedCover) {
    await transaction.user.update({
      where: { id: input.userId },
      data: {
        ...(clearedProfile ? { profilePhotoMediaId: null } : {}),
        ...(clearedCover ? { coverPhotoMediaId: null } : {}),
      },
    });
  }

  await transaction.mediaAsset.update({
    where: { id: media.id },
    data: { deletedAt: now },
  });

  const links = await transaction.postMedia.findMany({
    where: { mediaAssetId: media.id },
    select: {
      id: true,
      post: { select: { id: true, body: true, kind: true, deletedAt: true } },
    },
  });
  for (const link of links) {
    if (link.post.deletedAt) continue;
    const profileUpdate =
      link.post.kind === PostKind.PROFILE_PHOTO_UPDATE ||
      link.post.kind === PostKind.COVER_PHOTO_UPDATE;
    if (profileUpdate) {
      await transaction.post.update({
        where: { id: link.post.id },
        data: { deletedAt: now, isHidden: true },
      });
      continue;
    }
    await transaction.postMedia.delete({ where: { id: link.id } });
    const remaining = await transaction.postMedia.count({
      where: { postId: link.post.id },
    });
    if (remaining === 0 && !link.post.body?.trim()) {
      await transaction.post.update({
        where: { id: link.post.id },
        data: { deletedAt: now, isHidden: true },
      });
    }
  }

  await transaction.story.updateMany({
    where: { mediaAssetId: media.id, deletedAt: null },
    data: { deletedAt: now },
  });
  await transaction.reel.updateMany({
    where: { posterMediaId: media.id },
    data: { posterMediaId: null },
  });

  const message = photoRemovalMessage({
    clearedProfile,
    clearedCover,
    reason: input.reason,
  }).slice(0, 500);
  await transaction.outboxEvent.create({
    data: {
      eventType: "profile.warned",
      aggregateType: "media_asset",
      aggregateId: media.id,
      payload: {
        recipientId: input.userId,
        warningId: media.id,
        message,
      },
      status: OutboxStatus.PENDING,
    },
  });
  await transaction.moderationAction.create({
    data: {
      actorId: input.actorId,
      targetUserId: input.userId,
      actionCode: "PHOTO_REMOVED",
      note: input.reason,
      metadata: {
        mediaId: media.id,
        clearedProfile,
        clearedCover,
      },
    },
  });
  await transaction.auditLog.create({
    data: {
      actorType: AuditActorType.ADMIN,
      actorUserId: input.actorId,
      action: "admin.photo.removed",
      resourceType: "media_asset",
      resourceId: media.id,
      metadata: {
        userId: input.userId,
        clearedProfile,
        clearedCover,
      },
    },
  });

  return { mediaId: media.id, clearedProfile, clearedCover, message };
}
