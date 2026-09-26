import type { PrismaClient } from "@prisma/client";

import type {
  CreateMediaData,
  MediaRecord,
  MediaRepository,
} from "../application/ports/media-repository.js";

export class PrismaMediaRepository implements MediaRepository {
  constructor(private readonly database: PrismaClient) {}

  create(data: CreateMediaData): Promise<MediaRecord> {
    return this.database.mediaAsset.create({
      data,
      select: mediaSelect,
    });
  }

  findPublicById(mediaId: string): Promise<MediaRecord | null> {
    return this.database.mediaAsset.findFirst({
      where: {
        id: mediaId,
        visibility: "PUBLIC",
        deletedAt: null,
      },
      select: mediaSelect,
    });
  }

  findOwnedById(
    mediaId: string,
    ownerUserId: string,
  ): Promise<MediaRecord | null> {
    return this.database.mediaAsset.findFirst({
      where: { id: mediaId, ownerUserId, deletedAt: null },
      select: mediaSelect,
    });
  }

  async hardDelete(mediaId: string): Promise<void> {
    await this.database.mediaAsset.delete({ where: { id: mediaId } });
  }
}

const mediaSelect = {
  id: true,
  ownerUserId: true,
  kind: true,
  visibility: true,
  storageKey: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  checksumSha256: true,
  createdAt: true,
} as const;
