import type { MediaKind, MediaVisibility } from "@prisma/client";

export interface CreateMediaData {
  id: string;
  ownerUserId: string;
  kind: MediaKind;
  visibility: MediaVisibility;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  checksumSha256: string;
}

export interface MediaRecord {
  id: string;
  ownerUserId: string | null;
  kind: MediaKind;
  visibility: MediaVisibility;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  checksumSha256: string | null;
  createdAt: Date;
}

export interface MediaRepository {
  create(data: CreateMediaData): Promise<MediaRecord>;
  findPublicById(mediaId: string): Promise<MediaRecord | null>;
}
