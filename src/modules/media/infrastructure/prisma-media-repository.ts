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
      select: {
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
      },
    });
  }

  findPublicById(mediaId: string): Promise<MediaRecord | null> {
    return this.database.mediaAsset.findFirst({
      where: {
        id: mediaId,
        visibility: "PUBLIC",
        deletedAt: null,
      },
      select: {
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
      },
    });
  }
}
