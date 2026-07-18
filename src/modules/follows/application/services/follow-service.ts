import type { AppConfig } from "../../../../config/env.js";
import { AppError } from "../../../../shared/errors/app-error.js";
import type { FeedCursorCodec } from "../../../feed/application/services/feed-cursor.js";
import type {
  FollowPageQuery,
  FollowRepository,
  FollowState,
} from "../ports/follow-repository.js";
import {
  CannotFollowSelfError,
  FollowConflictError,
} from "../ports/follow-repository.js";
import {
  presentFollowRequest,
  presentFollowUser,
  type FollowListEntry,
} from "../follow-view.js";

export interface FollowPage {
  items: object[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class FollowService {
  constructor(
    private readonly repository: FollowRepository,
    private readonly cursors: FeedCursorCodec,
    private readonly config: AppConfig,
  ) {}

  follow(username: string, followerId: string): Promise<object> {
    return this.changeFollow("follow", username, followerId);
  }

  unfollow(username: string, followerId: string): Promise<object> {
    return this.changeFollow("unfollow", username, followerId);
  }

  async respond(
    followId: string,
    followeeId: string,
    action: "accept" | "reject",
  ): Promise<object> {
    if (!(await this.repository.respond(followId, followeeId, action))) {
      throw new AppError(
        "FOLLOW_REQUEST_NOT_FOUND",
        "Pending follow request not found",
        404,
      );
    }
    return {
      message:
        action === "accept"
          ? "Follow request accepted"
          : "Follow request rejected",
    };
  }

  listFollowers(
    username: string,
    options: { viewerId?: string; cursor?: string; limit: number },
  ): Promise<FollowPage> {
    return this.list(
      options,
      (query) =>
        this.repository.listFollowers(normalizeUsername(username), query),
      "users",
      true,
    );
  }

  listFollowing(
    username: string,
    options: { viewerId?: string; cursor?: string; limit: number },
  ): Promise<FollowPage> {
    return this.list(
      options,
      (query) =>
        this.repository.listFollowing(normalizeUsername(username), query),
      "users",
      true,
    );
  }

  listIncoming(
    followeeId: string,
    options: { cursor?: string; limit: number },
  ): Promise<FollowPage> {
    return this.list(
      options,
      (query) => this.repository.listIncoming(followeeId, query),
      "requests",
      false,
    );
  }

  private async changeFollow(
    action: "follow" | "unfollow",
    username: string,
    followerId: string,
  ): Promise<object> {
    try {
      const state = await this.repository[action](
        normalizeUsername(username),
        followerId,
      );
      if (!state) throw new AppError("NOT_FOUND", "User not found", 404);
      return mapState(state);
    } catch (error) {
      if (error instanceof CannotFollowSelfError) {
        throw new AppError(
          "CANNOT_FOLLOW_SELF",
          "You cannot follow yourself",
          422,
        );
      }
      if (error instanceof FollowConflictError) {
        const codeByReason: Record<string, string> = {
          already_following: "ALREADY_FOLLOWING",
          request_pending: "FOLLOW_REQUEST_PENDING",
          not_following: "NOT_FOLLOWING",
        };
        throw new AppError(
          codeByReason[error.message] ?? "CONFLICT",
          "The follow action conflicts with its current state",
          409,
        );
      }
      throw error;
    }
  }

  private async list(
    options: { viewerId?: string; cursor?: string; limit: number },
    fetch: (
      query: FollowPageQuery,
    ) => Promise<FollowListEntry[] | null>,
    kind: "users" | "requests",
    missingTargetIsNotFound: boolean,
  ): Promise<FollowPage> {
    const cursor = options.cursor
      ? this.cursors.decode(options.cursor)
      : undefined;
    if (cursor && cursor.kind !== "chronological") {
      throw new AppError(
        "INVALID_CURSOR",
        "This cursor cannot be used for follows",
        400,
      );
    }
    const rows = await fetch({
      limit: options.limit,
      ...(options.viewerId ? { viewerId: options.viewerId } : {}),
      ...(cursor
        ? {
            before: {
              id: cursor.id,
              createdAt: new Date(cursor.createdAt),
            },
          }
        : {}),
    });
    if (!rows && missingTargetIsNotFound) {
      throw new AppError("NOT_FOUND", "User not found", 404);
    }
    const safeRows = rows ?? [];
    const hasMore = safeRows.length > options.limit;
    const pageRows = safeRows.slice(0, options.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((entry) =>
        kind === "requests"
          ? presentFollowRequest(entry, this.config)
          : presentFollowUser(entry.user, this.config),
      ),
      nextCursor:
        hasMore && last
          ? this.cursors.encode({
              version: 1,
              kind: "chronological",
              id: last.id,
              createdAt: last.createdAt.toISOString(),
            })
          : null,
      hasMore,
    };
  }
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

function mapState(state: FollowState): object {
  return {
    isFollowing: state.isFollowing,
    followRequested: state.followRequested,
    followerCount: state.followerCount,
  };
}
