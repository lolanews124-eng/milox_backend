import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import { presentPost, presentPublicAuthor } from "../../../posts/application/post-view.js";
import type {
  FeedPostRecord,
  FeedRepository,
} from "../ports/feed-repository.js";
import type { PostAuthorViewRecord } from "../../../posts/application/post-view.js";
import type {
  FeedCursorCodec,
  FeedCursor,
} from "./feed-cursor.js";

export type FeedKind = "latest" | "following" | "trending" | "suggested";

export interface FeedPage {
  items: object[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class FeedService {
  constructor(
    private readonly repository: FeedRepository,
    private readonly cursors: FeedCursorCodec,
    private readonly config: AppConfig,
  ) {}

  async getPage(
    kind: FeedKind,
    options: { viewerId?: string; cursor?: string; limit: number },
  ): Promise<FeedPage> {
    const expectedCursorKind =
      kind === "latest" || kind === "following"
        ? "chronological"
        : "ranked";
    const cursor = options.cursor
      ? this.cursors.decode(options.cursor)
      : undefined;
    if (cursor && cursor.kind !== expectedCursorKind) {
      throw new AppError(
        "INVALID_CURSOR",
        "This cursor belongs to a different feed",
        400,
      );
    }

    let rows: FeedPostRecord[];
    const query = {
      limit: options.limit,
      ...(options.viewerId ? { viewerId: options.viewerId } : {}),
      ...(cursor ? { cursor } : {}),
    };
    switch (kind) {
      case "latest":
        rows = await this.repository.getLatest(query);
        break;
      case "trending":
        rows = await this.repository.getTrending(query);
        break;
      case "following":
        rows = await this.repository.getFollowing({
          ...query,
          viewerId: requireViewer(options.viewerId),
        });
        break;
      case "suggested":
        rows = await this.repository.getSuggested({
          ...query,
          viewerId: requireViewer(options.viewerId),
        });
        break;
    }

    const hasMore = rows.length > options.limit;
    const pageRows = rows.slice(0, options.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => presentPost(row, this.config)),
      nextCursor:
        hasMore && last
          ? this.cursors.encode(cursorForPost(last, expectedCursorKind))
          : null,
      hasMore,
    };
  }

  async passProfile(viewerId: string, targetId: string): Promise<void> {
    if (viewerId === targetId) {
      throw new AppError("INVALID_TARGET", "You cannot pass yourself", 400);
    }
    if (!(await this.repository.userExists(targetId))) {
      throw new AppError("USER_NOT_FOUND", "User not found", 404);
    }
    await this.repository.passProfile(viewerId, targetId);
  }

  async getPassedProfileIds(viewerId: string): Promise<string[]> {
    return this.repository.getPassedProfileIds(viewerId);
  }

  async getDiscoverPeople(
    options: { viewerId?: string; cursor?: string; limit: number },
  ): Promise<FeedPage> {
    const viewerId = requireViewer(options.viewerId);
    const cursor = options.cursor
      ? this.cursors.decode(options.cursor)
      : undefined;
    if (cursor && cursor.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "This cursor belongs to a different feed",
        400,
      );
    }

    const rows = await this.repository.getDiscoverPeople({
      viewerId,
      limit: options.limit,
      ...(cursor ? { cursor } : {}),
    });
    const hasMore = rows.length > options.limit;
    const pageRows = rows.slice(0, options.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => presentPublicAuthor(row, this.config)),
      nextCursor:
        hasMore && last
          ? this.cursors.encode(cursorForPerson(last))
          : null,
      hasMore,
    };
  }
}

function requireViewer(viewerId: string | undefined): string {
  if (!viewerId) {
    throw new AppError("UNAUTHENTICATED", "Authentication required", 401);
  }
  return viewerId;
}

function cursorForPost(
  post: FeedPostRecord,
  kind: FeedCursor["kind"],
): FeedCursor {
  if (kind === "chronological") {
    return {
      version: 1,
      kind,
      id: post.id,
      createdAt: post.createdAt.toISOString(),
    };
  }
  return {
    version: 1,
    kind,
    id: post.id,
    createdAt: post.createdAt.toISOString(),
    score: post.trendingScore,
  };
}

function cursorForPerson(person: PostAuthorViewRecord): FeedCursor {
  return {
    version: 1,
    kind: "chronological",
    id: person.id,
    createdAt: person.createdAt.toISOString(),
  };
}

