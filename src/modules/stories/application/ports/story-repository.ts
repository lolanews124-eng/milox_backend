import type { PostAuthorViewRecord } from "../../../posts/application/post-view.js";

export interface StoryMediaRecord {
  id: string;
  kind: string;
  deletedAt: Date | null;
}

export interface StoryRecord {
  id: string;
  authorId: string;
  mediaAssetId: string;
  caption: string | null;
  expiresAt: Date;
  createdAt: Date;
  author: PostAuthorViewRecord;
  views: Array<{ viewerId: string }>;
}

export interface StoryRepository {
  findOwnedMedia(
    mediaId: string,
    ownerUserId: string,
  ): Promise<StoryMediaRecord | null>;
  countActiveByAuthor(authorId: string): Promise<number>;
  create(data: {
    authorId: string;
    mediaAssetId: string;
    caption: string | null;
    expiresAt: Date;
  }): Promise<StoryRecord>;
  listActive(viewerId: string): Promise<StoryRecord[]>;
  findActiveById(
    storyId: string,
    viewerId: string,
  ): Promise<{ id: string; authorId: string } | null>;
  upsertView(storyId: string, viewerId: string): Promise<void>;
  softDelete(storyId: string, authorId: string): Promise<boolean>;
}
