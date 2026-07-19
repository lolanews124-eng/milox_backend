import type { PrismaClient } from "@prisma/client";

import {
  publicAuthorSelect,
  visibleAuthorWhere,
} from "../../posts/infrastructure/post-query-policy.js";
import type {
  StoryMediaRecord,
  StoryRecord,
  StoryRepository,
} from "../application/ports/story-repository.js";

const MAX_ACTIVE_STORIES = 200;

export class PrismaStoryRepository implements StoryRepository {
  constructor(private readonly database: PrismaClient) {}

  async findOwnedMedia(
    mediaId: string,
    ownerUserId: string,
  ): Promise<StoryMediaRecord | null> {
    return this.database.mediaAsset.findFirst({
      where: { id: mediaId, ownerUserId },
      select: { id: true, kind: true, deletedAt: true },
    });
  }

  async countActiveByAuthor(authorId: string): Promise<number> {
    return this.database.story.count({
      where: {
        authorId,
        deletedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  async create(data: {
    authorId: string;
    mediaAssetId: string;
    caption: string | null;
    expiresAt: Date;
  }): Promise<StoryRecord> {
    return this.database.story.create({
      data,
      select: this.storySelect(data.authorId),
    });
  }

  async listActive(viewerId: string): Promise<StoryRecord[]> {
    return this.database.story.findMany({
      where: {
        deletedAt: null,
        expiresAt: { gt: new Date() },
        author: { is: visibleAuthorWhere(viewerId) },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ACTIVE_STORIES,
      select: this.storySelect(viewerId),
    });
  }

  async findActiveById(
    storyId: string,
    viewerId: string,
  ): Promise<{ id: string; authorId: string } | null> {
    return this.database.story.findFirst({
      where: {
        id: storyId,
        deletedAt: null,
        expiresAt: { gt: new Date() },
        author: { is: visibleAuthorWhere(viewerId) },
      },
      select: { id: true, authorId: true },
    });
  }

  async upsertView(storyId: string, viewerId: string): Promise<void> {
    await this.database.storyView.upsert({
      where: { storyId_viewerId: { storyId, viewerId } },
      create: { storyId, viewerId },
      update: {},
    });
  }

  async softDelete(storyId: string, authorId: string): Promise<boolean> {
    const result = await this.database.story.updateMany({
      where: { id: storyId, authorId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  private storySelect(viewerId: string) {
    return {
      id: true,
      authorId: true,
      mediaAssetId: true,
      caption: true,
      expiresAt: true,
      createdAt: true,
      author: { select: publicAuthorSelect() },
      views: {
        where: { viewerId },
        select: { viewerId: true },
        take: 1,
      },
    } as const;
  }
}
