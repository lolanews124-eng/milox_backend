import type { FollowListEntry } from "../follow-view.js";

export interface FollowState {
  isFollowing: boolean;
  followRequested: boolean;
  followerCount: number;
}

export interface FollowPageQuery {
  viewerId?: string;
  limit: number;
  before?: { id: string; createdAt: Date };
}

export interface FollowRepository {
  follow(
    username: string,
    followerId: string,
  ): Promise<FollowState | null>;
  unfollow(
    username: string,
    followerId: string,
  ): Promise<FollowState | null>;
  respond(
    followId: string,
    followeeId: string,
    action: "accept" | "reject",
  ): Promise<boolean>;
  listFollowers(
    username: string,
    query: FollowPageQuery,
  ): Promise<FollowListEntry[] | null>;
  listFollowing(
    username: string,
    query: FollowPageQuery,
  ): Promise<FollowListEntry[] | null>;
  listIncoming(
    followeeId: string,
    query: FollowPageQuery,
  ): Promise<FollowListEntry[]>;
}

export class CannotFollowSelfError extends Error {}
export class FollowConflictError extends Error {}
