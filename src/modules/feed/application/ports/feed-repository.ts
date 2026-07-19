import type { PostAuthorViewRecord } from "../../../posts/application/post-view.js";
import type { PostViewRecord } from "../../../posts/application/post-view.js";
import type { FeedCursor } from "../services/feed-cursor.js";

export type FeedPostRecord = PostViewRecord;

export interface FeedQuery {
  viewerId?: string;
  limit: number;
  cursor?: FeedCursor;
}

export interface FeedRepository {
  getLatest(query: FeedQuery): Promise<FeedPostRecord[]>;
  getFollowing(query: FeedQuery & { viewerId: string }): Promise<FeedPostRecord[]>;
  getTrending(query: FeedQuery): Promise<FeedPostRecord[]>;
  getSuggested(
    query: FeedQuery & { viewerId: string },
  ): Promise<FeedPostRecord[]>;
  getDiscoverPeople(
    query: FeedQuery & { viewerId: string },
  ): Promise<PostAuthorViewRecord[]>;
  passProfile(viewerId: string, targetId: string): Promise<void>;
  getPassedProfileIds(viewerId: string): Promise<string[]>;
  userExists(userId: string): Promise<boolean>;
}
