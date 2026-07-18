import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import { presentPublicAuthor } from "../../../posts/application/post-view.js";
import type {
  StoryRecord,
  StoryRepository,
} from "../ports/story-repository.js";

const STORY_TTL_HOURS = 24;
const MAX_ACTIVE_PER_USER = 20;

export class StoryService {
  constructor(
    private readonly repository: StoryRepository,
    private readonly config: AppConfig,
  ) {}

  async create(
    authorId: string,
    input: { mediaId: string; caption?: string | undefined },
  ): Promise<object> {
    const media = await this.repository.findOwnedMedia(
      input.mediaId,
      authorId,
    );
    if (!media || media.deletedAt) {
      throw new AppError("MEDIA_NOT_FOUND", "Media not found", 404);
    }
    if (media.kind !== "STORY_IMAGE" && media.kind !== "POST_IMAGE") {
      throw new AppError(
        "VALIDATION_ERROR",
        "Only story or post images can be attached to a story",
        422,
      );
    }
    const active = await this.repository.countActiveByAuthor(authorId);
    if (active >= MAX_ACTIVE_PER_USER) {
      throw new AppError(
        "LIMIT_REACHED",
        "You have reached the maximum number of active stories",
        429,
      );
    }
    const story = await this.repository.create({
      authorId,
      mediaAssetId: input.mediaId,
      caption: input.caption?.trim() || null,
      expiresAt: new Date(Date.now() + STORY_TTL_HOURS * 3600 * 1000),
    });
    return this.present(story);
  }

  async feed(viewerId: string): Promise<{ items: object[] }> {
    const stories = await this.repository.listActive(viewerId);

    const groups = new Map<
      string,
      { author: object; isSelf: boolean; stories: object[]; allViewed: boolean }
    >();
    for (const story of stories) {
      let group = groups.get(story.authorId);
      if (!group) {
        group = {
          author: presentPublicAuthor(story.author, this.config),
          isSelf: story.authorId === viewerId,
          stories: [],
          allViewed: true,
        };
        groups.set(story.authorId, group);
      }
      const viewed = story.views.length > 0 || story.authorId === viewerId;
      if (!viewed) group.allViewed = false;
      group.stories.push(this.present(story));
    }

    const items = [...groups.values()].sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      if (a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
      return 0;
    });
    return { items };
  }

  async markViewed(storyId: string, viewerId: string): Promise<void> {
    const story = await this.repository.findActiveById(storyId, viewerId);
    if (!story) {
      throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
    }
    if (story.authorId !== viewerId) {
      await this.repository.upsertView(storyId, viewerId);
    }
  }

  async remove(storyId: string, userId: string): Promise<void> {
    const deleted = await this.repository.softDelete(storyId, userId);
    if (!deleted) {
      throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
    }
  }

  private present(story: StoryRecord): object {
    return {
      id: story.id,
      caption: story.caption,
      mediaUrl: `${this.config.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/media/${story.mediaAssetId}`,
      viewed: story.views.length > 0,
      expiresAt: story.expiresAt.toISOString(),
      createdAt: story.createdAt.toISOString(),
    };
  }
}
